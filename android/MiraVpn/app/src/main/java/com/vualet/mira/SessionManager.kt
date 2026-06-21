package com.vualet.mira

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson

data class XrayConfig(
    val serverAddr: String,
    val serverPort: Int,
    val uuid: String,
    val sni: String,
    val publicKey: String,
    val shortId: String = "",
    val flow: String = "xtls-rprx-vision"
)

data class MiraSession(
    val sessionToken: String,
    val username: String,
    val xrayConfig: XrayConfig,
    val daysRemaining: Int
)

object SessionManager {
    private const val PREFS_FILE = "mira_session"
    private const val KEY_SESSION = "session_json"
    private const val KEY_ASSETS_COPIED = "assets_copied"
    private val gson = Gson()

    private fun prefs(ctx: Context): SharedPreferences {
        return try {
            val mk = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(ctx, PREFS_FILE, mk,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
        } catch (e: Exception) {
            ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        }
    }

    fun getSession(ctx: Context): MiraSession? {
        val json = prefs(ctx).getString(KEY_SESSION, null) ?: return null
        return try { gson.fromJson(json, MiraSession::class.java) } catch (e: Exception) { null }
    }

    fun saveSession(ctx: Context, session: MiraSession) {
        prefs(ctx).edit().putString(KEY_SESSION, gson.toJson(session)).apply()
    }

    fun clearSession(ctx: Context) {
        prefs(ctx).edit().remove(KEY_SESSION).apply()
    }

    fun areAssetsCopied(ctx: Context): Boolean =
        prefs(ctx).getBoolean(KEY_ASSETS_COPIED, false)

    fun setAssetsCopied(ctx: Context) {
        prefs(ctx).edit().putBoolean(KEY_ASSETS_COPIED, true).apply()
    }
}