package com.vualet.mira

object XrayConfigBuilder {
    private const val SOCKS_PORT = 7890

    fun getSocksPort(): Int = SOCKS_PORT

    fun build(cfg: XrayConfig): String = """
{
  "log": {"loglevel": "warning"},
  "inbounds": [{
    "port": $SOCKS_PORT,
    "protocol": "socks",
    "settings": {"auth": "noauth", "udp": true},
    "sniffing": {"enabled": true, "destOverride": ["http","tls"]}
  }],
  "outbounds": [{
    "protocol": "vless",
    "settings": {
      "vnext": [{
        "address": "${cfg.serverAddr}",
        "port": ${cfg.serverPort},
        "users": [{"id": "${cfg.uuid}", "flow": "${cfg.flow}", "encryption": "none"}]
      }]
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "serverName": "${cfg.sni}",
        "fingerprint": "chrome",
        "publicKey": "${cfg.publicKey}",
        "shortId": "${cfg.shortId}",
        "spiderX": "/"
      }
    }
  },{
    "protocol": "freedom",
    "tag": "direct"
  }],
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      {"type": "field", "outboundTag": "direct", "ip": ["geoip:private"]},
      {"type": "field", "outboundTag": "direct", "domain": ["geosite:cn"]}
    ]
  }
}
""".trimIndent()
}