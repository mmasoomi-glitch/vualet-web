package main

import (
    "bufio"
    "encoding/base64"
    "encoding/hex"
    "fmt"
    "strings"
)

type ParsedConfig struct {
    PrivateKey, PublicKey, InterfaceIP, InterfaceMask, Endpoint, ServerIP string
    DNS []string
    AllowedIPs []string
    PersistentKeepalive int
}

func ParseConfig(ini string) (*ParsedConfig, error) {
    cfg := &ParsedConfig{PersistentKeepalive: 25, InterfaceMask: "255.255.255.255"}
    var inPeer bool
    scanner := bufio.NewScanner(strings.NewReader(ini))
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") { continue }
        if strings.HasPrefix(line, "[") { inPeer = strings.Contains(line, "[Peer]"); continue }
        parts := strings.SplitN(line, "=", 2)
        if len(parts) != 2 { continue }
        key, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
        if inPeer {
            switch key {
            case "PublicKey": cfg.PublicKey = value
            case "Endpoint":
                cfg.Endpoint = value
                if idx := strings.LastIndex(value, ":"); idx > 0 { cfg.ServerIP = value[:idx] }
            case "AllowedIPs":
                for _, ip := range strings.Split(value, ",") {
                    if ip = strings.TrimSpace(ip); ip != "" { cfg.AllowedIPs = append(cfg.AllowedIPs, ip) }
                }
            case "PersistentKeepalive": fmt.Sscanf(value, "%d", &cfg.PersistentKeepalive)
            }
        } else {
            switch key {
            case "PrivateKey": if value != "FILL_ME" { cfg.PrivateKey = value }
            case "Address":
                if idx := strings.Index(value, "/"); idx > 0 {
                    cfg.InterfaceIP = value[:idx]
                    var prefix int; fmt.Sscanf(value[idx+1:], "%d", &prefix)
                    cfg.InterfaceMask = prefixToMask(prefix)
                } else { cfg.InterfaceIP = value }
            case "DNS":
                for _, dns := range strings.Split(value, ",") {
                    if dns = strings.TrimSpace(dns); dns != "" { cfg.DNS = append(cfg.DNS, dns) }
                }
            }
        }
    }
    if cfg.PrivateKey == "" { return nil, fmt.Errorf("missing PrivateKey") }
    if cfg.PublicKey == "" { return nil, fmt.Errorf("missing PublicKey") }
    if cfg.Endpoint == "" { return nil, fmt.Errorf("missing Endpoint") }
    return cfg, nil
}

func (c *ParsedConfig) ToIPC() string {
    var sb strings.Builder
    if h, err := base64ToHex(c.PrivateKey); err == nil { sb.WriteString("private_key=" + h + "\n") }
    sb.WriteString("listen_port=0\nreplace_peers=true\n")
    if h, err := base64ToHex(c.PublicKey); err == nil { sb.WriteString("public_key=" + h + "\n") }
    sb.WriteString(fmt.Sprintf("endpoint=%s\npersistent_keepalive_interval=%d\nreplace_allowed_ips=true\n", c.Endpoint, c.PersistentKeepalive))
    for _, ip := range c.AllowedIPs { sb.WriteString("allowed_ip=" + ip + "\n") }
    return sb.String()
}

func base64ToHex(b64 string) (string, error) {
    bytes, err := base64.StdEncoding.DecodeString(b64)
    if err != nil { return "", err }
    return hex.EncodeToString(bytes), nil
}

func prefixToMask(prefix int) string {
    mask := uint32(0xFFFFFFFF << (32 - prefix))
    return fmt.Sprintf("%d.%d.%d.%d", (mask>>24)&0xFF, (mask>>16)&0xFF, (mask>>8)&0xFF, mask&0xFF)
}
