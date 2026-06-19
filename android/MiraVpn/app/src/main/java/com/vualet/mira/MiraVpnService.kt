package com.vualet.mira

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow

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

            val resp = MiraClient.issueTunnel(MiraApp.prefs.wgPublicKey.ifEmpty { genKeys() }, if (MiraApp.prefs.isPaid) "paid" else "free") ?: run { connectionState.value = Status(message = "Registration failed"); return }
            MiraApp.prefs.saveTunnelInfo(pub = MiraApp.prefs.wgPublicKey, priv = MiraApp.prefs.wgPrivateKey, ip = resp.ip, server = resp.server_ip)

            val builder = Builder().setSession("Mira VPN").addAddress(resp.ip, 32).addDnsServer("1.1.1.1").addDnsServer("1.0.0.1").addRoute("0.0.0.0", 0).setMtu(1420)
            builder.addDisallowedApplication(packageName)
            vpnIf = builder.establish() ?: run { connectionState.value = Status(message = "VPN interface failed"); return }

            connectionState.value = Status(connected = true, message = "Connected", rtt = server.rtt, transport = "udp", serverIp = server.ip)
        } catch (e: Exception) { Log.e("MiraVpn", "connect failed", e); cleanup() }
    }

    private fun genKeys(): String { val priv = (1..44).map { "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(Math.random() * 64).toInt()] }.joinToString(""); val pub = priv.reversed(); MiraApp.prefs.wgPrivateKey = priv; MiraApp.prefs.wgPublicKey = pub; return pub }

    private fun cleanup() { try { vpnIf?.close() } catch (_: Exception) {}; vpnIf = null }
    override fun onRevoke() { cleanup(); stopSelf() }
    override fun onDestroy() { cleanup(); scope.cancel(); super.onDestroy() }
}
