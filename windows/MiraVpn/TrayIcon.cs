using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace MiraVpn;

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly HttpClient _api = new() { BaseAddress = new("http://178.104.251.30/v1/") };
    private string? _currentPubKey;
    private bool _connected;

    public event Action? ExitRequested;

    public TrayIcon()
    {
        _icon = new NotifyIcon { Icon = LoadIcon(), Text = "Mira VPN — Disconnected", Visible = true };
        _icon.ContextMenuStrip = BuildMenu();
        _icon.DoubleClick += (_, _) => Toggle();
    }

    private static Icon LoadIcon()
    {
        try { using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MiraVpn.Resources.mira-icon-32.png"); if (s != null) { using var bmp = new Bitmap(s); return Icon.FromHandle(bmp.GetHicon()); } }
        catch { }
        return SystemIcons.Shield;
    }

    private ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        m.Items.Add("Connect", null, (_, _) => Toggle());
        m.Items.Add("Disconnect", null, (_, _) => Toggle());
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("Exit Mira VPN", null, (_, _) => { _ = Disconnect(); ExitRequested?.Invoke(); });
        return m;
    }

    private async void Toggle()
    {
        if (_connected) { await Disconnect(); return; }
        await Connect();
    }

    private async Task Connect()
    {
        SetMenuText(0, "Connecting...");
        _icon.Text = "Mira VPN — Connecting...";
        try
        {
            var (name, endpoint, rttMs) = await SmartRouter.PickBestAsync();
            if (rttMs == int.MaxValue) { _icon.Text = "Mira VPN — No servers"; SetMenuText(0, "Connect (retry)"); return; }

            var priv = MarshalPtr(NativeBridge.mira_genkey());
            var pub = MarshalPtr(NativeBridge.mira_pubkey(priv));
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub)) { _icon.Text = "Mira VPN — Key error"; SetMenuText(0, "Connect (retry)"); return; }
            _currentPubKey = pub;

            var resp = await _api.PostAsJsonAsync("tunnel/issue-direct", new { public_key = pub, tier = "free" });
            if (!resp.IsSuccessStatusCode) { _icon.Text = "Mira VPN — Registration failed"; SetMenuText(0, "Connect (retry)"); return; }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
            var cfg = json.GetProperty("config").GetString()!.Replace("FILL_ME", priv)
                         .Replace("178.104.251.30:51820", $"{endpoint}:51820");

            int result = NativeBridge.mira_start(cfg);
            if (result != 0) { _icon.Text = $"Mira VPN — Error ({result})"; SetMenuText(0, "Connect (retry)"); await RemovePeer(); return; }

            _connected = true;
            _icon.Text = $"Mira VPN — Connected ({name}, {rttMs}ms)";
            SetMenuText(0, "Disconnect");
        }
        catch (Exception ex) { Debug.WriteLine($"Mira: {ex.Message}"); _icon.Text = "Mira VPN — Failed"; SetMenuText(0, "Connect (retry)"); }
    }

    private async Task Disconnect()
    {
        NativeBridge.mira_stop();
        await RemovePeer();
        _connected = false;
        _icon.Text = "Mira VPN — Disconnected";
        SetMenuText(0, "Connect");
    }

    private async Task RemovePeer()
    {
        if (_currentPubKey == null) return;
        try { await _api.PostAsJsonAsync("tunnel/remove", new { public_key = _currentPubKey }); } catch { }
        _currentPubKey = null;
    }

    private void SetMenuText(int idx, string text) { var items = _icon.ContextMenuStrip?.Items; if (items != null && items.Count > idx) items[idx]!.Text = text; }

    private static string MarshalPtr(IntPtr ptr) { if (ptr == IntPtr.Zero) return ""; var s = Marshal.PtrToStringAnsi(ptr); NativeBridge.mira_free(ptr); return s ?? ""; }

    public void Dispose() { if (_connected) _ = Disconnect(); _icon.Visible = false; _icon.Dispose(); }
}
