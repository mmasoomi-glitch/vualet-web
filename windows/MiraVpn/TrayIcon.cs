using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows.Forms;

namespace MiraVpn;

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly HttpClient _http = new() { BaseAddress = new("http://178.104.251.30/v1/") };
    private readonly string _wgExe = @"C:\Program Files\WireGuard\wireguard.exe";
    private const string TunnelName = "MiraVPN";
    private bool _connected;

    public event Action? ExitRequested;

    public TrayIcon()
    {
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Text = "Mira VPN - disconnected",
            Visible = true
        };
        _icon.ContextMenuStrip = BuildMenu();
        _icon.DoubleClick += (_, _) => Toggle();
    }

    public void Show() { _icon.Visible = true; }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Connect", null, (_, _) => Connect());
        menu.Items.Add("Disconnect", null, (_, _) => Disconnect());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => { Disconnect(); ExitRequested?.Invoke(); });
        return menu;
    }

    private void Toggle()
    {
        if (_connected) Disconnect(); else Connect();
    }

    private async void Connect()
    {
        SetState("Connecting...");
        try
        {
            var wgPath = FindWireGuard();
            if (wgPath == null)
            {
                MessageBox.Show("WireGuard is not installed.\n\nPlease install from https://www.wireguard.com/install/",
                    "Mira VPN", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                SetState("Disconnected");
                return;
            }

            var priv = RunWg(wgPath, "genkey");
            var pub = RunWg(wgPath, "pubkey", priv);
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub))
            {
                SetState("Keygen failed");
                return;
            }

            var resp = await _http.PostAsJsonAsync("tunnel/issue", new { public_key = pub.Trim(), tier = "free" });
            if (!resp.IsSuccessStatusCode)
            {
                SetState("Registration failed");
                return;
            }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
            var ip = json.GetProperty("ip").GetString()!;
            var config = json.GetProperty("config").GetString()!;
            config = config.Replace("FILL_ME", priv.Trim());

            var tmp = Path.GetTempFileName() + ".conf";
            File.WriteAllText(tmp, config);
            RunWg(wgPath, "/installtunnelservice \"" + tmp + "\"");
            File.Delete(tmp);

            RunWg(wgPath, "/activate \"" + TunnelName + "\"");

            _connected = true;
            _icon.Text = "Mira VPN - Connected (" + ip + ")";
            SetState("Connected (" + ip + ")");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Connection failed: " + ex.Message, "Mira VPN", MessageBoxButtons.OK, MessageBoxIcon.Error);
            SetState("Disconnected");
        }
    }

    private void Disconnect()
    {
        try
        {
            var wg = FindWireGuard();
            if (wg != null) { RunWg(wg, "/uninstalltunnelservice \"" + TunnelName + "\""); }
        }
        catch { }
        _connected = false;
        _icon.Text = "Mira VPN - disconnected";
        SetState("Disconnected");
    }

    private string? FindWireGuard()
    {
        if (File.Exists(_wgExe)) return _wgExe;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            var full = Path.Combine(dir.Trim(), "wireguard.exe");
            if (File.Exists(full)) return full;
        }
        return null;
    }

    private static string RunWg(string exe, string args, string? stdin = null)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            RedirectStandardOutput = true,
            RedirectStandardInput = stdin != null,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi)!;
        if (stdin != null) { p.StandardInput.Write(stdin); p.StandardInput.Close(); }
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(5000);
        return output;
    }

    private void SetState(string state)
    {
        var items = _icon.ContextMenuStrip?.Items;
        if (items != null && items.Count > 0 && items[0] is ToolStripMenuItem c)
            c.Text = "Status: " + state;
    }

    public void Dispose() => _icon.Dispose();
}
