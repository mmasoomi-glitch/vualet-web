using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace MiraVpn;

public class ConnectionService : IDisposable
{
    private readonly HttpClient _http = new() { BaseAddress = new(AppConfig.API_BASE) };
    private CancellationTokenSource? _cts;
    private string? _currentPubKey;

    public ConnectionState State { get; private set; } = ConnectionState.Disconnected;
    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    public event Action? ExitRequested;

    public void Connect() => _ = ConnectAsync();

    private async Task ConnectAsync()
    {
        if (State is ConnectionState.Connecting or ConnectionState.Connected) return;
        _cts = new();
        var ct = _cts.Token;
        SetState(ConnectionState.Connecting, "Connecting...");

        try
        {
            Log("Generating keys...");
            var priv = FreePtr(NativeBridge.mira_genkey());
            var pub  = FreePtr(NativeBridge.mira_pubkey(priv));
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub))
                throw new Exception("Key generation failed");
            _currentPubKey = pub;

            Log("Requesting config from server...");
            ct.ThrowIfCancellationRequested();
            var resp = await _http.PostAsJsonAsync("tunnel/issue-direct",
                new { public_key = pub, tier = "free" }, ct);
            if (!resp.IsSuccessStatusCode)
                throw new Exception($"Server refused (HTTP {(int)resp.StatusCode})");
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
            var cfg  = json.GetProperty("config").GetString()!.Replace("FILL_ME", priv);

            Log("Starting WireGuard tunnel...");
            ct.ThrowIfCancellationRequested();
            int code = NativeBridge.mira_start(cfg);
            if (code != 0)
            {
                var detail = NativeBridge.TryGetLastError();
                throw new Exception(string.IsNullOrEmpty(detail)
                    ? $"Tunnel failed (code {code})"
                    : $"Tunnel failed: {detail}");
            }

            SetState(ConnectionState.Connected, "Connected");
            Log("Connected");
        }
        catch (OperationCanceledException)
        {
            SetState(ConnectionState.Disconnected, "Cancelled");
        }
        catch (Exception ex)
        {
            Log($"Error: {ex.Message}");
            SetState(ConnectionState.Error, ex.Message);
            _ = RemovePeer();
        }
    }

    public async Task Disconnect()
    {
        _cts?.Cancel();
        if (State == ConnectionState.Disconnected) return;
        Log("Disconnecting...");
        try { NativeBridge.mira_stop(); } catch { }
        await RemovePeer();
        SetState(ConnectionState.Disconnected, "Disconnected");
        Log("Disconnected");
    }

    private async Task RemovePeer()
    {
        if (_currentPubKey == null) return;
        try { await _http.PostAsJsonAsync("tunnel/remove", new { public_key = _currentPubKey }); }
        catch { }
        _currentPubKey = null;
    }

    private void SetState(ConnectionState s, string msg)
    {
        State = s;
        Logger.Info("VPN", $"State -> {s}: {msg}");
        StateChanged?.Invoke(s, msg);
    }

    private void Log(string msg) { Logger.Info("VPN", msg); LogMessage?.Invoke(msg); }

    private static string FreePtr(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero) return "";
        var s = Marshal.PtrToStringAnsi(ptr) ?? "";
        NativeBridge.mira_free(ptr);
        return s;
    }

    // Compat stubs for MainWindow
    public string ConnectedServerName => "";
    public string ConnectedEndpoint => "";
    public long ConnectedRtt => 0;
    public long LastHandshakeAge => 0;
    public bool IsConnected => State == ConnectionState.Connected;

    public void RaiseExitRequested() => ExitRequested?.Invoke();
    public void Dispose() { _cts?.Cancel(); _cts?.Dispose(); _http.Dispose(); }
}

