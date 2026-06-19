package com.vualet.mira

import kotlinx.coroutines.*
import java.net.InetSocketAddress
import java.net.Socket

object SmartRouter {
    data class ServerResult(val ip: String, val name: String, val rtt: Long, val reachable: Boolean)

    private val pool = listOf(
        "178.104.251.30" to "Nuremberg"
    )

    suspend fun findFastestServer(): ServerResult? = withContext(Dispatchers.IO) {
        val results = coroutineScope {
            pool.map { (ip, name) -> async { probe(ip, name) } }.awaitAll()
        }
        results.filter { it.reachable }.minByOrNull { it.rtt }
    }

    private fun probe(ip: String, name: String): ServerResult {
        for (port in listOf(443, 80, 8443)) {
            try {
                val start = System.currentTimeMillis()
                val s = Socket(); s.connect(InetSocketAddress(ip, port), 3000)
                val rtt = System.currentTimeMillis() - start
                s.close()
                return ServerResult(ip, name, rtt, true)
            } catch (_: Exception) {}
        }
        return ServerResult(ip, name, 0, false)
    }
}
