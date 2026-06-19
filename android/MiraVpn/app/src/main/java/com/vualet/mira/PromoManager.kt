package com.vualet.mira

import com.google.gson.Gson
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object PromoManager {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).build()
    private val jsonType = "application/json".toMediaType()
    data class Result(val success: Boolean, val days: Int, val reason: String?)

    suspend fun redeem(code: String): Result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val body = Gson().toJson(mapOf("code" to code.uppercase())).toRequestBody(jsonType)
        try {
            val r = client.newCall(Request.Builder().url("http://178.104.251.30/v1/promo/redeem").post(body).build()).execute()
            if (r.isSuccessful) Result(true, 30, null) else Result(false, 0, r.message)
        } catch (e: Exception) { Result(false, 0, e.message) }
    }
}
