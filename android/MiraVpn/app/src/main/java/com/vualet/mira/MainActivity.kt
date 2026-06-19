package com.vualet.mira

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity() {

    private lateinit var connectBtn: Button
    private lateinit var statusText: TextView
    private lateinit var serverText: TextView
    private lateinit var rttText: TextView
    private lateinit var adContainer: FrameLayout
    private var state = "disconnected"
    private var currentRtt = 0L
    private var currentServer = "—"

    private val vpnLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) {
            startService(Intent(this, MiraVpnService::class.java).apply { action = MiraVpnService.ACTION_CONNECT })
            startPolling() // Fix: must start polling after permission granted via dialog
        } else {
            statusText.text = "VPN permission needed"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        connectBtn = findViewById(R.id.connectButton)
        statusText = findViewById(R.id.statusText)
        serverText = findViewById(R.id.serverText)
        rttText = findViewById(R.id.rttText)
        adContainer = findViewById(R.id.adContainer)

        connectBtn.setOnClickListener {
            if (state == "connected") { stopService(); statusText.text = "Disconnecting…"; state = "disconnected"; updateUI() }
            else {
                val prep = VpnService.prepare(this)
                if (prep != null) vpnLauncher.launch(prep)
                else { startService(Intent(this, MiraVpnService::class.java).apply { action = MiraVpnService.ACTION_CONNECT }); startPolling() }
            }
        }

        if (MiraApp.prefs.isPaid) adContainer.visibility = View.GONE
        else adContainer.visibility = View.VISIBLE
    }

    override fun onResume() {
        super.onResume()
        // Resume polling whenever the activity becomes visible — handles the case
        // where the service is already running (e.g. after returning from VPN dialog).
        startPolling()
    }

    override fun onPause() {
        super.onPause()
        pollJob?.cancel()
    }

    private fun stopService() { startService(Intent(this, MiraVpnService::class.java).apply { action = MiraVpnService.ACTION_DISCONNECT }) }

    private var pollJob: Job? = null

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = lifecycleScope.launch {
            MiraVpnService.connectionState.collect { cs ->
                runOnUiThread {
                    if (cs.connected) {
                        state = "connected"
                        serverText.text = "Server: ${cs.serverIp}"
                        rttText.text = if (cs.rtt > 0) "Latency: ${cs.rtt}ms" else "—"
                    } else {
                        state = "disconnected"
                        serverText.text = "Server: —"
                        rttText.text = "Latency: —"
                    }
                    statusText.text = cs.message
                    currentRtt = cs.rtt; currentServer = cs.serverIp
                    updateUI()
                }
            }
        }
    }

    private fun updateUI() {
        when (state) {
            "connected" -> { connectBtn.text = "Disconnect"; connectBtn.setBackgroundResource(R.drawable.btn_mira_connected) }
            else -> { connectBtn.text = "Connect"; connectBtn.setBackgroundResource(R.drawable.btn_mira_gradient) }
        }
    }
}
