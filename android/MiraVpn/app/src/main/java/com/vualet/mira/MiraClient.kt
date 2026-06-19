package com.vualet.mira

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object MiraClient {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val gson = Gson()
    private val jsonType = "application/json".toMediaType()
    private const val BASE = "http://178.104.251.30/v1"

    data class TunnelResponse(val ip: String, val server_endpoint: String, val server_public_key: String, val config: String, val server_ip: String)

    fun issueTunnel(pubKey: String, tier: String): TunnelResponse? {
        val body = gson.toJson(mapOf("public_key" to pubKey, "tier" to tier)).toRequestBody(jsonType)
        return try {
            val r = client.newCall(Request.Builder().url("$BASE/tunnel/issue-direct").post(body).build()).execute()
            if (!r.isSuccessful) null
            else gson.fromJson(r.body?.string(), TunnelResponse::class.java)
        } catch (_: Exception) { null }
    }

    fun removePeer(pubKey: String): Boolean {
        val body = gson.toJson(mapOf("public_key" to pubKey)).toRequestBody(jsonType)
        return try { client.newCall(Request.Builder().url("$BASE/tunnel/remove").post(body).build()).execute().isSuccessful } catch (_: Exception) { false }
    }
}
