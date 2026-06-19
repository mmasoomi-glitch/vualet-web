package com.vualet.mira

import android.content.Context

object ConnectionManager {
    fun isServiceRunning(ctx: Context): Boolean {
        val mgr = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        return mgr.getRunningServices(Int.MAX_VALUE).any { MiraVpnService::class.java.name == it.service.className }
    }
}
