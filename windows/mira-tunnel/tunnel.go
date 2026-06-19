package main

import (
    "fmt"
    "os/exec"
    "runtime"
    "strconv"
    "strings"
    "time"
    "golang.zx2c4.com/wireguard/conn"
    "golang.zx2c4.com/wireguard/device"
    "golang.zx2c4.com/wireguard/tun"
)

const (InterfaceName = "Mira"; MTU = 1420)

type Tunnel struct {
    dev     *device.Device
    cfg     *ParsedConfig
    started time.Time
}

type StatsResult struct {
    Connected, RxBytes, TxBytes uint64
    Endpoint string; LastHandshakeSec, UptimeSec int64
}

type StatusResult struct {
    Connected bool; Endpoint, InterfaceIP string
}

func NewTunnel(configINI string) (*Tunnel, error) {
    cfg, err := ParseConfig(configINI)
    if err != nil { return nil, fmt.Errorf("config parse: %w", err) }
    return &Tunnel{cfg: cfg}, nil
}

func (t *Tunnel) Start() error {
    runtime.LockOSThread()
    tunDev, err := tun.CreateTUN(InterfaceName, MTU)
    if err != nil { return fmt.Errorf("create adapter: %w", err) }
    logger := device.NewLogger(device.LogLevelError, "(Mira) ")
    t.dev = device.NewDevice(tunDev, conn.NewDefaultBind(), logger)
    if err := t.dev.IpcSet(t.cfg.ToIPC()); err != nil { t.dev.Close(); return fmt.Errorf("configure: %w", err) }
    if err := t.dev.Up(); err != nil { t.dev.Close(); return fmt.Errorf("bring up: %w", err) }

    // Retry setIP: wintun adapter may not be immediately visible to netsh after CreateTUN.
    // 5 attempts x 300ms = up to 1.5s grace period for the adapter to settle.
    var setIPErr error
    for i := 0; i < 5; i++ {
        time.Sleep(300 * time.Millisecond)
        if setIPErr = setIP(InterfaceName, t.cfg.InterfaceIP, t.cfg.InterfaceMask); setIPErr == nil {
            break
        }
    }
    if setIPErr != nil {
        t.dev.Close(); return fmt.Errorf("set ip: %w", setIPErr)
    }

    for _, dns := range t.cfg.DNS { _ = setDNS(InterfaceName, dns) }
    _ = setMetric(InterfaceName, 1)
    gw, _ := defaultGateway()
    _ = addRoute("0.0.0.0", "128.0.0.0", t.cfg.InterfaceIP, 1)
    _ = addRoute("128.0.0.0", "128.0.0.0", t.cfg.InterfaceIP, 1)
    if gw != "" && t.cfg.ServerIP != "" { _ = addRoute(t.cfg.ServerIP, "255.255.255.255", gw, 1) }
    t.started = time.Now()
    return nil
}

func (t *Tunnel) Stop() {
    if t.dev == nil { return }
    tunIP := t.cfg.InterfaceIP
    _ = deleteRoute("0.0.0.0", "128.0.0.0", tunIP)
    _ = deleteRoute("128.0.0.0", "128.0.0.0", tunIP)
    if t.cfg.ServerIP != "" { _ = deleteRoute(t.cfg.ServerIP, "255.255.255.255", tunIP) }
    t.dev.Down(); t.dev.Close(); t.dev = nil
}

func (t *Tunnel) Stats() map[string]interface{} {
    r := map[string]interface{}{"connected": false, "endpoint": t.cfg.Endpoint, "uptime_seconds": int64(time.Since(t.started).Seconds())}
    if t.dev == nil { return r }
    ipcOut, _ := t.dev.IpcGet()
    lines := strings.Split(ipcOut, "\n")
    var rx, tx uint64; var lh int64
    for _, l := range lines {
        if v, ok := strings.CutPrefix(l, "rx_bytes="); ok { rx, _ = strconv.ParseUint(v, 10, 64) }
        if v, ok := strings.CutPrefix(l, "tx_bytes="); ok { tx, _ = strconv.ParseUint(v, 10, 64) }
        if v, ok := strings.CutPrefix(l, "last_handshake_time_sec="); ok { lh, _ = strconv.ParseInt(v, 10, 64) }
    }
    r["rx_bytes"], r["tx_bytes"], r["last_handshake_sec"] = rx, tx, lh
    if lh > 0 && time.Since(time.Unix(lh, 0)) < 3*time.Minute { r["connected"] = true }
    return r
}

func (t *Tunnel) Status() map[string]interface{} {
    s := t.Stats()
    s["interface_ip"] = t.cfg.InterfaceIP
    return s
}

// --- netsh/route helpers ---
func shell(cmd string, args ...string) error {
    out, err := exec.Command(cmd, args...).CombinedOutput()
    if err != nil { return fmt.Errorf("%s: %s: %w", cmd, string(out), err) }
    return nil
}

func setIP(name, ip, mask string) error {
    return shell("netsh", "interface", "ip", "set", "address", "name="+name, "source=static", "address="+ip, "mask="+mask)
}
func setDNS(name, dns string) error {
    return shell("netsh", "interface", "ip", "add", "dns", "name="+name, "address="+dns)
}
func setMetric(name string, metric int) error {
    return shell("netsh", "interface", "ipv4", "set", "interface", "name="+name, "metric="+strconv.Itoa(metric))
}
func defaultGateway() (string, error) {
    out, err := exec.Command("route", "print", "0.0.0.0").CombinedOutput()
    if err != nil { return "", err }
    for _, line := range strings.Split(string(out), "\n") {
        f := strings.Fields(line)
        if len(f) >= 5 && f[0] == "0.0.0.0" && f[1] == "0.0.0.0" && f[2] != "0.0.0.0" { return f[2], nil }
    }
    return "", fmt.Errorf("no default gateway")
}
func addRoute(dest, mask, gateway string, metric int) error {
    return shell("route", "add", dest, "mask", mask, gateway, "metric", strconv.Itoa(metric))
}
func deleteRoute(dest, mask, gateway string) error {
    _ = shell("route", "delete", dest, "mask", mask, gateway); return nil
}