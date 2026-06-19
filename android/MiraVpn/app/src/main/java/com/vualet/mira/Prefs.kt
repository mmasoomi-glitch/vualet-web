package com.vualet.mira

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson

class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("mira_prefs", Context.MODE_PRIVATE)

    var email: String get() = sp.getString("email", "") ?: ""; set(v) = sp.edit().putString("email", v).apply()
    var tier: String get() = sp.getString("tier", "free") ?: "free"; set(v) = sp.edit().putString("tier", v).apply()
    var subscriptionExpires: Long get() = sp.getLong("sub_expires", 0); set(v) = sp.edit().putLong("sub_expires", v).apply()
    var transportMode: String get() = sp.getString("transport", "auto") ?: "auto"; set(v) = sp.edit().putString("transport", v).apply()
    var wgPublicKey: String get() = sp.getString("wg_pubkey", "") ?: ""; set(v) = sp.edit().putString("wg_pubkey", v).apply()
    var wgPrivateKey: String get() = sp.getString("wg_privkey", "") ?: ""; set(v) = sp.edit().putString("wg_privkey", v).apply()
    var assignedIp: String get() = sp.getString("assigned_ip", "") ?: ""; set(v) = sp.edit().putString("assigned_ip", v).apply()
    var serverIp: String get() = sp.getString("server_ip", "") ?: ""; set(v) = sp.edit().putString("server_ip", v).apply()

    val isPaid: Boolean get() = tier == "paid" && subscriptionExpires > System.currentTimeMillis()

    fun setPaid(days: Int) { tier = "paid"; subscriptionExpires = System.currentTimeMillis() + days * 86400000L }

    fun saveTunnelInfo(pub: String, priv: String, ip: String, server: String) {
        sp.edit().putString("wg_pubkey", pub).putString("wg_privkey", priv)
            .putString("assigned_ip", ip).putString("server_ip", server).apply()
    }
}
