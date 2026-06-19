package com.vualet.mira

class TransportManager(private val backend: WireGuardBackend) {
    var currentMode = "none"
    fun connect(port: Int): Boolean { currentMode = "udp"; return true }
    fun stop() { currentMode = "none" }
}
