using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Forms;
using Microsoft.Win32;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;
using MessageBoxResult = System.Windows.MessageBoxResult;

namespace MiraVpn;

public enum ConnectionState { Disconnected, Probing, Connecting, Connected, Disconnecting, Error }

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly HttpClient _http = new() { BaseAddress = new("http://178.104.251.30/v1/") };
    private readonly SmartRouter _router = new();
    private readonly System.Timers.Timer _statusTimer = new(3000);
    private MainWindow? _mainWindow;
    private bool _connected, _connecting;
    private string? _currentPrivKey, _currentPubKey, _connectedEndpoint, _connectedServerName;
    private long _connectedRtt;

    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    public event Action<ulong, ulong>? StatsUpdated;
    public event Action? ExitRequested;

    public ConnectionState CurrentState { get; private set; } = ConnectionState.Disconnected;
    public bool IsConnected => _connected;
    public bool IsConnecting => _connecting;
    public string ConnectedEndpoint => _connectedEndpoint ?? "";
    public long ConnectedRtt => _connectedRtt;

    public TrayIcon()
    {
        _icon = new NotifyIcon { Icon = LoadMiraIcon(), Text = "Mira VPN — Disconnected", Visible = false, ContextMenuStrip = BuildMenu() };
        _icon.DoubleClick += (_, _) => ShowMainWindow();
        _statusTimer.Elapsed += (_, _) => UpdateStatusFromTunnel();
        _statusTimer.AutoReset = true;
    }

    public void Show() { _icon.Visible = true; }
    public void SetMainWindow(MainWindow w) { _mainWindow = w; }

    private ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        m.Items.Add(new ToolStripMenuItem("Status: Disconnected") { Enabled = false });
        m.Items.Add(new ToolStripSeparator());
        var cn = new ToolStripMenuItem("Connect", null, (_, _) => { ShowMainWindow(); Connect(); }) { Font = new System.Drawing.Font("Segoe UI", 9, System.Drawing.FontStyle.Bold) };
        m.Items.Add(cn);
        m.Items.Add(new ToolStripMenuItem("Disconnect", null, (_, _) => { ShowMainWindow(); _ = Disconnect(); }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Show Mira VPN", null, (_, _) => ShowMainWindow()));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Uninstall Mira VPN", null, (_, _) => Uninstall()));
        m.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => { _ = Disconnect(); ExitRequested?.Invoke(); }));
        return m;
    }

    public async void Connect()
    {
        if (_connecting || _connected) return;
        _connecting = true;
        SetState(ConnectionState.Probing, "Probing servers…"); EmitLog("Probing servers…");
        try
        {
            _router.OnProbeResult = EmitLog;
            var server = await _router.FindFastestAsync();
            if (server == null) { SetState(ConnectionState.Error, "No servers reachable"); EmitLog("x No servers reachable"); Balloon("Could not connect", "Could not reach Mira servers. Check your internet connection.", ToolTipIcon.Error); _connecting = false; return; }
            EmitLog($"OK Found {server.Name} ({server.RttMs}ms)");
            SetState(ConnectionState.Connecting, $"Connecting to {server.Name}…");

            var priv = MarshalPtr(NativeBridge.mira_genkey());
            var pub = MarshalPtr(NativeBridge.mira_pubkey(priv));
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub)) { SetState(ConnectionState.Error, "Key generation failed"); _connecting = false; return; }
            _currentPrivKey = priv; _currentPubKey = pub;

            var resp = await _http.PostAsJsonAsync("tunnel/issue-direct", new { public_key = pub, tier = "free" });
            if (!resp.IsSuccessStatusCode) { SetState(ConnectionState.Error, "Server registration failed"); EmitLog($"x Registration failed (HTTP {resp.StatusCode})"); _connecting = false; return; }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
            var cfg = json.GetProperty("config").GetString()!.Replace("FILL_ME", priv).Replace("178.104.251.30:51820", $"{server.IP}:51820");

            EmitLog($"Starting tunnel to {server.IP}:51820…");
            int result = NativeBridge.mira_start(cfg);
            if (result != 0)
            {
                string reason = result switch { -1 => "Network driver failed. Run as Administrator.", -2 => "Administrator access required. Right-click MiraVpn.exe → Run as Administrator.", _ => $"Tunnel error (code {result})" };
                SetState(ConnectionState.Error, reason); EmitLog($"x {reason}"); Balloon("Could not connect", reason, ToolTipIcon.Error); await RemovePeer(); _connecting = false; return;
            }

            _connected = true; _connecting = false; _connectedEndpoint = server.IP; _connectedRtt = server.RttMs; _connectedServerName = server.Name;
            SetState(ConnectionState.Connected, $"Connected ({server.Name}, {server.RttMs}ms)");
            EmitLog($"OK Connected ({server.Name}, {server.RttMs}ms)"); Balloon("Mira VPN", $"Connected to {server.Name} ({server.RttMs}ms)", ToolTipIcon.Info);
            _statusTimer.Start();
        }
        catch (Exception ex) { Logger.Error("TrayIcon", $"Connect: {ex.Message}"); SetState(ConnectionState.Error, ex.Message); EmitLog($"x {ex.Message}"); _connecting = false; }
    }

    public async Task Disconnect()
    {
        if (!_connected && !_connecting) return;
        SetState(ConnectionState.Disconnecting, "Disconnecting…"); EmitLog("Disconnecting…"); _statusTimer.Stop();
        try { NativeBridge.mira_stop(); await RemovePeer(); } catch (Exception ex) { Logger.Error("TrayIcon", $"Disconnect: {ex.Message}"); }
        _connected = _connecting = false; _connectedEndpoint = null; _connectedRtt = 0;
        SetState(ConnectionState.Disconnected, "Disconnected"); EmitLog("OK Disconnected"); Balloon("Mira VPN", "Disconnected", ToolTipIcon.Info);
    }

    private async Task RemovePeer() { if (_currentPubKey == null) return; try { await _http.PostAsJsonAsync("tunnel/remove", new { public_key = _currentPubKey }); } catch { } _currentPrivKey = _currentPubKey = null; }

    private void UpdateStatusFromTunnel()
    {
        if (!_connected) return;
        try
        {
            var ptr = NativeBridge.mira_stats(); var s = Marshal.PtrToStringAnsi(ptr); NativeBridge.mira_free(ptr);
            var stats = JsonSerializer.Deserialize<TunnelStats>(s);
            if (stats != null && !stats.connected) { _connected = false; SetState(ConnectionState.Disconnected, "Disconnected (tunnel lost)"); EmitLog("x Tunnel lost"); Balloon("Mira VPN", "Connection lost", ToolTipIcon.Warning); }
            else if (stats != null && stats.connected) { StatsUpdated?.Invoke(stats.rx_bytes, stats.tx_bytes); }
        }
        catch { }
    }

    private void SetState(ConnectionState s, string msg) { CurrentState = s; Logger.Info("TrayIcon", $"State -> {s}: {msg}"); if (_icon.ContextMenuStrip?.Items[0] is ToolStripMenuItem si) si.Text = "Status: " + msg; _icon.Text = $"Mira VPN — {msg}"[..Math.Min(63, $"Mira VPN — {msg}".Length)]; StateChanged?.Invoke(s, msg); }
    private void EmitLog(string msg) { Logger.Info("Connection", msg); LogMessage?.Invoke(msg); }
    private void Balloon(string title, string text, ToolTipIcon icon) { _icon.ShowBalloonTip(3000, title, text, icon); }

    private void ShowMainWindow()
    {
        if (_mainWindow == null) return;
        _mainWindow.Dispatcher.Invoke(() => { _mainWindow.Show(); _mainWindow.WindowState = WindowState.Normal; _mainWindow.Activate(); });
    }

    private void Uninstall()
    {
        if (MessageBox.Show("Remove Mira VPN from your computer?\n\nAll settings, logs, and network configuration will be deleted.", "Uninstall Mira VPN", MessageBoxButton.OKCancel, MessageBoxImage.Warning) != MessageBoxResult.OK) return;
        Logger.Info("TrayIcon", "Uninstall initiated");
        if (_connected) { try { NativeBridge.mira_stop(); } catch { } }
        try { FirewallHelper.RemoveRules(); } catch { }
        try { using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true); k?.DeleteValue("MiraVPN", false); } catch { }
        try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Mira VPN.lnk")); File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "Mira VPN.lnk")); } catch { }
        var batch = Path.Combine(Path.GetTempPath(), "mira-uninstall-cleanup.bat");
        File.WriteAllText(batch, $"@echo off\r\ntimeout /t 3 /nobreak >nul\r\nrd /s /q \"{App.AppDataDir}\" 2>nul\r\ndel \"%~f0\" 2>nul\r\n");
        try { Process.Start(new ProcessStartInfo { FileName = batch, UseShellExecute = true, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
        _icon.Visible = false; ExitRequested?.Invoke();
    }

    private static string MarshalPtr(IntPtr ptr) { if (ptr == IntPtr.Zero) return ""; var s = Marshal.PtrToStringAnsi(ptr); NativeBridge.mira_free(ptr); return s ?? ""; }

    private static Icon LoadMiraIcon()
    {
        try { using var s = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("MiraVpn.Resources.mira-icon-32.png"); if (s != null) { using var bmp = new Bitmap(s); return Icon.FromHandle(bmp.GetHicon()); } }
        catch { }
        return SystemIcons.Shield;
    }

    public void Dispose() { if (_connected) _ = Disconnect(); _icon.Visible = false; _icon.Dispose(); }
}

public class IssueResponse { public string? Ip { get; set; } public string? ServerEndpoint { get; set; } public string? ServerPublicKey { get; set; } public string? Config { get; set; } }
public class TunnelStats { public bool connected { get; set; } public ulong rx_bytes { get; set; } public ulong tx_bytes { get; set; } public string? endpoint { get; set; } public long last_handshake_sec { get; set; } public long uptime_seconds { get; set; } }
