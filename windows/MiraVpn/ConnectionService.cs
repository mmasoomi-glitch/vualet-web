using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
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
    private bool _connected, _connecting;
    private string? _currentPrivKey, _currentPubKey, _connectedEndpoint, _connectedServerName;
    private long _connectedRtt;

    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    public event Action<ulong, ulong>? StatsUpdated;
    public event Action? ExitRequested;
    public event Action<string, string, ToolTipIcon>? BalloonRequested;

    public ConnectionState CurrentState { get; private set; } = ConnectionState.Disconnected;
    public bool IsConnected => _connected;
    public bool IsConnecting => _connecting;
    public string ConnectedEndpoint => _connectedEndpoint ?? "";
    public long ConnectedRtt => _connectedRtt;

    public ConnectionService()
    {
        _statusTimer.Elapsed += (_, _) => UpdateStatusFromTunnel();
        _statusTimer.AutoReset = true;
    }

    public void Connect()
    {
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

            var priv = MarshalPtr(NativeBridge.mira_genkey());
            var pub = MarshalPtr(NativeBridge.mira_pubkey(priv));
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub))
            {
                SetState(ConnectionState.Error, "Key generation failed"); _connecting = false; return;
            }
            _currentPrivKey = priv; _currentPubKey = pub;

            ct.ThrowIfCancellationRequested();
            var resp = await _http.PostAsJsonAsync("tunnel/issue-direct", new { public_key = pub, tier = "free" }, ct);
            if (!resp.IsSuccessStatusCode)
            {
                SetState(ConnectionState.Error, "Server registration failed");
                EmitLog($"x Registration failed (HTTP {resp.StatusCode})"); _connecting = false; return;
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
                await RemovePeer(); _connecting = false; return;
            }

            _connected = true; _connecting = false;
            _connectedEndpoint = server.IP; _connectedRtt = server.RttMs; _connectedServerName = server.Name;
            SetState(ConnectionState.Connected, $"Connected ({server.Name}, {server.RttMs}ms)");
            EmitLog($"OK Connected ({server.Name}, {server.RttMs}ms)");
            BalloonRequested?.Invoke("Mira VPN", $"Connected to {server.Name} ({server.RttMs}ms)", ToolTipIcon.Info);
            _statusTimer.Start();
        }
        catch (OperationCanceledException)
        {
            EmitLog("OK Connection cancelled");
            _connecting = false;
        }
        catch (Exception ex)
        {
            Logger.Error("TrayIcon", $"Connect: {ex.Message}");
            SetState(ConnectionState.Error, ex.Message);
            EmitLog($"x {ex.Message}");
            _connecting = false;
        }
    }

    public async Task Disconnect()
    {
        _cts?.Cancel();
        if (!_connected && !_connecting) return;
        SetState(ConnectionState.Disconnecting, "Disconnecting..."); EmitLog("Disconnecting...");
        _statusTimer.Stop();
        try { NativeBridge.mira_stop(); await RemovePeer(); }
        catch (Exception ex) { Logger.Error("TrayIcon", $"Disconnect: {ex.Message}"); }
        _connected = _connecting = false; _connectedEndpoint = null; _connectedRtt = 0;
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
            }
            else if (stats != null && stats.connected)
            {
                StatsUpdated?.Invoke(stats.rx_bytes, stats.tx_bytes);
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

    public void RaiseExitRequested() => ExitRequested?.Invoke();

    public void Dispose()
    {
        _cts?.Cancel(); _cts?.Dispose();
        _statusTimer.Stop(); _statusTimer.Dispose();
        _http.Dispose();
    }
}
