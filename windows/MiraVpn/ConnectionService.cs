using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace MiraVpn;

public class ConnectionService : IDisposable
{
    private readonly HttpClient _http = new() { BaseAddress = new(AppConfig.API_BASE) };
    private readonly SmartRouter _router = new();
    private readonly System.Timers.Timer _statusTimer = new(AppConfig.STATUS_INTERVAL_MS);
    private CancellationTokenSource? _cts;
    private bool _connected, _connecting, _killSwitchActive;
    private int _reconnectAttempts;
    private bool _userDisconnected, _isReconnecting, _wasConnected;
    private string? _currentPrivKey, _currentPubKey, _connectedEndpoint, _connectedServerName;
    private long _connectedRtt;

    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    public event Action<ulong, ulong, long>? StatsUpdated;
    public event Action? ExitRequested;
    public event Action<string, string, ToolTipIcon>? BalloonRequested;

    public ConnectionState CurrentState { get; private set; } = ConnectionState.Disconnected;
    public bool IsConnected => _connected;
    public bool IsConnecting => _connecting;
    public string ConnectedEndpoint => _connectedEndpoint ?? "";
    public string ConnectedServerName => _connectedServerName ?? "";
    public long ConnectedRtt => _connectedRtt;
    public long LastHandshakeAge { get; private set; }

    public ConnectionService()
    {
        _statusTimer.Elapsed += (_, _) => UpdateStatusFromTunnel();
        _statusTimer.AutoReset = true;
        NetworkChange.NetworkAvailabilityChanged += OnNetworkAvailabilityChanged;
        NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;
    }

    public void Connect()
    {
        _userDisconnected = false;
        _isReconnecting = false;
        _reconnectAttempts = 0;
        _ = ConnectAsync();
    }

    private async Task ConnectAsync()
    {
        if (_connecting || _connected) return;
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;
        _connecting = true;

        SetState(ConnectionState.Probing, "Probing servers..."); EmitLog("Probing servers...");
        try
        {
            ct.ThrowIfCancellationRequested();
            _router.OnProbeResult = EmitLog;
            var server = await _router.FindFastestAsync();
            if (server == null)
            {
                SetState(ConnectionState.Error, "No servers reachable");
                EmitLog("x No servers reachable");
                BalloonRequested?.Invoke("Could not connect", "Could not reach Mira servers. Check your internet connection.", ToolTipIcon.Error);
                _connecting = false; return;
            }
            EmitLog($"OK Found {server.Name} ({server.RttMs}ms)");
            ct.ThrowIfCancellationRequested();
            SetState(ConnectionState.Connecting, $"Connecting to {server.Name}...");

            if (Prefs.Load().KillSwitchEnabled)
            {
                KillSwitch.Enable(server.IP);
                _killSwitchActive = true;
                EmitLog("OK Kill switch engaged");
            }

            var priv = MarshalPtr(NativeBridge.mira_genkey());
            var pub = MarshalPtr(NativeBridge.mira_pubkey(priv));
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub))
            {
                SetState(ConnectionState.Error, "Key generation failed"); DisableKillSwitch(); _connecting = false; return;
            }
            _currentPrivKey = priv; _currentPubKey = pub;

            ct.ThrowIfCancellationRequested();
            var resp = await _http.PostAsJsonAsync("tunnel/issue-direct", new { public_key = pub, tier = "free" }, ct);
            if (!resp.IsSuccessStatusCode)
            {
                SetState(ConnectionState.Error, "Server registration failed");
                EmitLog($"x Registration failed (HTTP {resp.StatusCode})"); DisableKillSwitch(); _connecting = false; return;
            }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
            var cfg = json.GetProperty("config").GetString()!
                .Replace("FILL_ME", priv)
                .Replace("178.104.251.30:51820", $"{server.IP}:51820");

            ct.ThrowIfCancellationRequested();
            EmitLog($"Starting tunnel to {server.IP}:51820...");
            CleanupStaleWintun();
            int result = NativeBridge.mira_start(cfg);
            Logger.Info("Connection", $"mira_start returned {result}");
            if (result != 0)
            {
                string reason = result switch
                {
                    -1 => "Network driver failed. Run as Administrator.",
                    -2 => "IP assignment failed (netsh error). Try reconnecting -- this usually clears itself.",
                    _ => $"Tunnel error (code {result})"
                };
                SetState(ConnectionState.Error, reason); EmitLog($"x {reason}");
                BalloonRequested?.Invoke("Could not connect", reason, ToolTipIcon.Error);
                DisableKillSwitch(); await RemovePeer(); _connecting = false; return;
            }

            _connected = true; _connecting = false;
            _reconnectAttempts = 0; _isReconnecting = false;
            _connectedEndpoint = server.IP; _connectedRtt = server.RttMs; _connectedServerName = server.Name;
            SetState(ConnectionState.Connected, $"Connected ({server.Name}, {server.RttMs}ms)");
            EmitLog($"OK Connected ({server.Name}, {server.RttMs}ms)");
            BalloonRequested?.Invoke("Mira VPN", $"Connected to {server.Name} ({server.RttMs}ms)", ToolTipIcon.Info);
            DnsGuard.Enable(new[] { AppConfig.DNS_PRIMARY, AppConfig.DNS_SECONDARY });
            _statusTimer.Start();
        }
        catch (OperationCanceledException)
        {
            EmitLog("OK Connection cancelled");
            DisableKillSwitch();
            _connecting = false;
        }
        catch (Exception ex)
        {
            Logger.Error("TrayIcon", $"Connect: {ex.Message}");
            SetState(ConnectionState.Error, ex.Message);
            EmitLog($"x {ex.Message}");
            DisableKillSwitch();
            _connecting = false;
            if (!_userDisconnected && !_isReconnecting)
                _ = ReconnectAsync();
        }
    }

    public async Task Disconnect()
    {
        _userDisconnected = true;
        _isReconnecting = false;
        _cts?.Cancel();
        if (!_connected && !_connecting)
        {
            DisableKillSwitch();
            return;
        }
        SetState(ConnectionState.Disconnecting, "Disconnecting..."); EmitLog("Disconnecting...");
        _statusTimer.Stop();
        DnsGuard.Disable();
        try { NativeBridge.mira_stop(); await RemovePeer(); }
        catch (Exception ex) { Logger.Error("TrayIcon", $"Disconnect: {ex.Message}"); }
        _connected = _connecting = false; _connectedEndpoint = null; _connectedRtt = 0;
        DisableKillSwitch();
        SetState(ConnectionState.Disconnected, "Disconnected");
        EmitLog("OK Disconnected");
        BalloonRequested?.Invoke("Mira VPN", "Disconnected", ToolTipIcon.Info);
    }

    private async Task RemovePeer()
    {
        if (_currentPubKey == null) return;
        try { await _http.PostAsJsonAsync("tunnel/remove", new { public_key = _currentPubKey }); }
        catch { }
        _currentPrivKey = _currentPubKey = null;
    }

    private void UpdateStatusFromTunnel()
    {
        if (!_connected) return;
        try
        {
            var ptr = NativeBridge.mira_stats();
            var s = Marshal.PtrToStringAnsi(ptr);
            NativeBridge.mira_free(ptr);
            var stats = JsonSerializer.Deserialize<TunnelStats>(s);
            if (stats != null && !stats.connected)
            {
                _connected = false;
                SetState(ConnectionState.Disconnected, "Disconnected (tunnel lost)");
                EmitLog("x Tunnel lost");
                BalloonRequested?.Invoke("Mira VPN", "Connection lost", ToolTipIcon.Warning);
                if (!_userDisconnected && !_isReconnecting)
                    _ = ReconnectAsync();
            }
            else if (stats != null && stats.connected)
            {
                long age = stats.last_handshake_sec > 0
                    ? DateTimeOffset.UtcNow.ToUnixTimeSeconds() - stats.last_handshake_sec
                    : 0;
                LastHandshakeAge = age;
                StatsUpdated?.Invoke(stats.rx_bytes, stats.tx_bytes, stats.last_handshake_sec);

                // Detect stale tunnel: no handshake in 180s (WireGuard standard interval)
                if (stats.last_handshake_sec > 0 && age > AppConfig.STALE_HANDSHAKE_SEC)
                {
                    EmitLog($"x Tunnel stale (no handshake for {age}s) - reconnecting");
                    _connected = false;
                    _statusTimer.Stop();
                    try { NativeBridge.mira_stop(); } catch { }
                    DnsGuard.Disable();
                    if (!_userDisconnected && !_isReconnecting)
                        _ = ReconnectAsync();
                    return;
                }
            }
        }
        catch { }
    }

    private void SetState(ConnectionState s, string msg)
    {
        CurrentState = s;
        Logger.Info("TrayIcon", $"State -> {s}: {msg}");
        StateChanged?.Invoke(s, msg);
    }

    private void EmitLog(string msg)
    {
        Logger.Info("Connection", msg);
        LogMessage?.Invoke(msg);
    }

    private void DisableKillSwitch()
    {
        if (!_killSwitchActive) return;
        try { KillSwitch.Disable(); EmitLog("OK Kill switch disengaged"); }
        catch (Exception ex) { Logger.Error("KillSwitch", $"Disable: {ex.Message}"); }
        _killSwitchActive = false;
    }

    private static void CleanupStaleWintun()
    {
        try
        {
            using var query = Process.Start(new ProcessStartInfo("sc.exe", "query wintun")
                { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true });
            if (query == null) return;
            var output = query.StandardOutput.ReadToEnd();
            query.WaitForExit(3000);

            bool isStopped = output.Contains("STOPPED");
            bool hasError31 = output.Contains(" 31 ") || output.Contains("(0x1f)");

            if (isStopped && hasError31)
            {
                Logger.Info("Wintun", "Stale wintun service (error 31) detected -- deleting for clean reinstall");
                using var del = Process.Start(new ProcessStartInfo("sc.exe", "delete wintun")
                    { UseShellExecute = false, CreateNoWindow = true });
                del?.WaitForExit(3000);
                System.Threading.Thread.Sleep(500);
                Logger.Info("Wintun", "Stale service deleted -- wintun.dll will reinstall driver on next CreateAdapter call");
            }
            else if (isStopped)
            {
                Logger.Info("Wintun", $"wintun service stopped (not error 31) -- skipping delete. Output: {output.Trim()}");
            }
        }
        catch (Exception ex) { Logger.Error("Wintun", $"CleanupStaleWintun: {ex.Message}"); }
    }

    private static string MarshalPtr(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero) return "";
        var s = Marshal.PtrToStringAnsi(ptr);
        NativeBridge.mira_free(ptr);
        return s ?? "";
    }

    private async Task ReconnectAsync()
    {
        if (_isReconnecting) return;
        _isReconnecting = true;
        try
        {
            while (_reconnectAttempts < AppConfig.RECONNECT_MAX_ATTEMPTS)
            {
                if (_userDisconnected) break;
                _reconnectAttempts++;
                var delayMs = Math.Min(
                    AppConfig.RECONNECT_BASE_DELAY_MS * (1 << (_reconnectAttempts - 1)),
                    AppConfig.RECONNECT_MAX_DELAY_MS);
                SetState(ConnectionState.Connecting, $"Reconnecting... attempt {_reconnectAttempts}");
                EmitLog($"Reconnecting... attempt {_reconnectAttempts}/{AppConfig.RECONNECT_MAX_ATTEMPTS}");
                await Task.Delay(delayMs);
                if (_userDisconnected) break;
                await ConnectAsync();
                if (_connected) break;
            }
            if (!_connected && !_userDisconnected)
            {
                SetState(ConnectionState.Error, "Reconnect failed after max attempts");
                EmitLog("x Reconnect failed after max attempts");
                BalloonRequested?.Invoke("Mira VPN", "Could not reconnect after several attempts.", ToolTipIcon.Error);
            }
        }
        finally { _isReconnecting = false; }
    }

    private void OnNetworkAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e)
    {
        if (e.IsAvailable)
        {
            // Network came up
            if (_wasConnected && !_userDisconnected)
            {
                EmitLog("Network restored — reconnecting...");
                Task.Delay(AppConfig.NETWORK_RECONNECT_DELAY_MS).ContinueWith(_ =>
                {
                    _ = ReconnectAsync();
                });
            }
        }
        else
        {
            // Network went down
            if (_connected)
            {
                _wasConnected = true;
                _connected = false;
                try { NativeBridge.mira_stop(); } catch { }
                SetState(ConnectionState.Reconnecting, "Network lost, reconnecting...");
                EmitLog("x Network lost — will reconnect when available");
            }
        }
    }

    private void OnNetworkAddressChanged(object? sender, EventArgs e)
    {
        // Network interface changed — if we were connected, probe for reconnection
        if (_connected && !_userDisconnected)
        {
            EmitLog("Network change detected while connected");
        }
    }

    public void RaiseExitRequested() => ExitRequested?.Invoke();

    public void Dispose()
    {
        _cts?.Cancel(); _cts?.Dispose();
        _statusTimer.Stop(); _statusTimer.Dispose();
        _http.Dispose();
    }
}
