package com.vualet.mira

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class MiraApp : Application() {
    companion object {
        const val NOTIF_CHANNEL_ID = "mira_vpn"
        lateinit var prefs: Prefs
            private set
    }
    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(NOTIF_CHANNEL_ID, "Mira VPN", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }
}
