package com.vualet.mira

import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object VpnController {
    private const val TAG = "VpnController"
    private const val BASE_URL = "http://178.104.251.30:5103"
    private val gson = Gson()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    data class LookupResp(@SerializedName("user_id") val userId: Int)
    data class VerifyResp(
        @SerializedName("session_token") val sessionToken: String,
        @SerializedName("days_remaining") val daysRemaining: Int,
        val username: String,
        @SerializedName("xray_uuid") val xrayUuid: String
    )
    data class TunnelConfigResp(
        val type: String, val server: String, val port: Int, val uuid: String,
        val encryption: String, val flow: String, val network: String,
        val security: String, val sni: String,
        @SerializedName("publicKey") val publicKey: String,
        @SerializedName("shortId") val shortId: String,
        @SerializedName("spiderX") val spiderX: String
    )

    suspend fun authenticate(ctx: Context, username: String, code: String): Result<MiraSession> {
        return try {
            // Step 1: lookup
            val lookupBody = gson.toJson(mapOf("username" to username)).toRequestBody(JSON)
            val lookupReq = Request.Builder().url("$BASE_URL/v1/auth/lookup").post(lookupBody).build()
            val lookupResp = http.newCall(lookupReq).execute()
            if (!lookupResp.isSuccessful) {
                val err = lookupResp.body?.string() ?: "Lookup failed"
                return Result.failure(Exception(err))
            }
            val lookup = gson.fromJson(lookupResp.body!!.string(), LookupResp::class.java)

            // Step 2: verify TOTP
            val fp = android.provider.Settings.Secure.getString(
                ctx.contentResolver, android.provider.Settings.Secure.ANDROID_ID) ?: "unknown"
            val verifyBody = gson.toJson(mapOf(
                "user_id" to lookup.userId, "code" to code, "device_fingerprint" to fp
            )).toRequestBody(JSON)
            val verifyReq = Request.Builder().url("$BASE_URL/v1/auth/verify").post(verifyBody).build()
            val verifyResp = http.newCall(verifyReq).execute()
            if (!verifyResp.isSuccessful) {
                val err = verifyResp.body?.string() ?: "Auth failed"
                return Result.failure(Exception(err))
            }
            val verify = gson.fromJson(verifyResp.body!!.string(), VerifyResp::class.java)

            // Step 3: get Xray tunnel config
            val cfgReq = Request.Builder()
                .url("$BASE_URL/v1/tunnel/config")
                .addHeader("X-Session-Token", verify.sessionToken)
                .get().build()
            val cfgResp = http.newCall(cfgReq).execute()
            if (!cfgResp.isSuccessful) {
                return Result.failure(Exception("Tunnel config fetch failed"))
            }
            val cfg = gson.fromJson(cfgResp.body!!.string(), TunnelConfigResp::class.java)
            val xrayCfg = XrayConfig(cfg.server, cfg.port, cfg.uuid, cfg.sni, cfg.publicKey, cfg.shortId, cfg.flow)
            val session = MiraSession(verify.sessionToken, verify.username, xrayCfg, verify.daysRemaining)
            SessionManager.saveSession(ctx, session)
            Result.success(session)
        } catch (e: Exception) {
            Log.e(TAG, "authenticate error: ${e.message}", e)
            Result.failure(e)
        }
    }

    suspend fun validateSession(ctx: Context): Boolean {
        val session = SessionManager.getSession(ctx) ?: return false
        return try {
            val req = Request.Builder()
                .url("$BASE_URL/v1/auth/me")
                .addHeader("X-Session-Token", session.sessionToken)
                .get().build()
            val resp = http.newCall(req).execute()
            resp.isSuccessful
        } catch (e: Exception) { false }
    }

    fun startVPN(ctx: Context) {
        ctx.startService(Intent(ctx, MiraVpnService::class.java).apply {
            action = MiraVpnService.ACTION_START
        })
    }

    fun stopVPN(ctx: Context) {
        ctx.startService(Intent(ctx, MiraVpnService::class.java).apply {
            action = MiraVpnService.ACTION_STOP
        })
    }
}