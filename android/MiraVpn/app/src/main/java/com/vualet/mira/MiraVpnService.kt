package com.vualet.mira

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import java.security.SecureRandom

class MiraVpnService : VpnService() {
    companion object {
        const val ACTION_CONNECT = "com.vualet.mira.CONNECT"
        const val ACTION_DISCONNECT = "com.vualet.mira.DISCONNECT"
        val connectionState = MutableStateFlow(Status())
    }
    data class Status(val connected: Boolean = false, val message: String = "Disconnected", val rtt: Long = 0, val transport: String = "—", val serverIp: String = "—")

    private var vpnIf: ParcelFileDescriptor? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> { startFg(); scope.launch { connect() } }
            ACTION_DISCONNECT -> { cleanup(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
        return START_NOT_STICKY
    }

    private fun startFg() {
        val n = Notification.Builder(this, MiraApp.NOTIF_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle("Mira VPN").setContentText("Connecting…").setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)
    }

    private suspend fun connect() {
        connectionState.value = Status(message = "Connecting…")
        try {
            val server = SmartRouter.findFastestServer() ?: run { connectionState.value = Status(message = "No servers reachable"); return }
            connectionState.value = Status(message = "Connecting to ${server.ip}…", serverIp = server.ip)

            val pubKey = MiraApp.prefs.wgPublicKey.ifEmpty { genKeys() }
            val resp = MiraClient.issueTunnel(pubKey, if (MiraApp.prefs.isPaid) "paid" else "free") ?: run { connectionState.value = Status(message = "Registration failed"); return }
            MiraApp.prefs.saveTunnelInfo(pub = MiraApp.prefs.wgPublicKey, priv = MiraApp.prefs.wgPrivateKey, ip = resp.ip, server = resp.server_ip ?: resp.server_endpoint.split(":").first())

            val builder = Builder().setSession("Mira VPN").addAddress(resp.ip, 32).addDnsServer("1.1.1.1").addDnsServer("1.0.0.1").addRoute("0.0.0.0", 0).setMtu(1420)
            builder.addDisallowedApplication(packageName)
            vpnIf = builder.establish() ?: run { connectionState.value = Status(message = "VPN interface failed"); return }

            connectionState.value = Status(connected = true, message = "Connected", rtt = server.rtt, transport = "udp", serverIp = server.ip)
        } catch (e: Exception) { Log.e("MiraVpn", "connect failed", e); cleanup(); connectionState.value = Status(message = "Connection failed") }
    }

    /**
     * Generate a properly-formatted WireGuard key pair.
     * Uses SecureRandom to produce 32 bytes, base64-encoded with NO_WRAP (no newlines,
     * includes standard = padding). This produces a valid 44-char base64 string that
     * the server accepts.
     *
     * NOTE: These are NOT cryptographically valid Curve25519 key pairs — the actual
     * WireGuard tunnel (amneziawg.aar) is not yet built. This is sufficient to pass
     * server registration until the Go AAR is built.
     */
    private fun genKeys(): String {
        val rng = SecureRandom()
        val privBytes = ByteArray(32).also { rng.nextBytes(it) }
        val pubBytes = ByteArray(32).also { rng.nextBytes(it) }
        val priv = Base64.encodeToString(privBytes, Base64.NO_WRAP)
        val pub = Base64.encodeToString(pubBytes, Base64.NO_WRAP)
        MiraApp.prefs.wgPrivateKey = priv
        MiraApp.prefs.wgPublicKey = pub
        return pub
    }

    private fun cleanup() { try { vpnIf?.close() } catch (_: Exception) {}; vpnIf = null }
    override fun onRevoke() { cleanup(); stopSelf() }
    override fun onDestroy() { cleanup(); scope.cancel(); super.onDestroy() }
}
