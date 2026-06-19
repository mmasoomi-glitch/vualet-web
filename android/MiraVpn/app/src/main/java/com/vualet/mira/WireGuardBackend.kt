package com.vualet.mira

class WireGuardBackend {
    fun generatePrivateKey(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        return (1..44).map { chars[(Math.random() * 64).toInt()] }.joinToString("")
    }
    fun initialize() {}
}
