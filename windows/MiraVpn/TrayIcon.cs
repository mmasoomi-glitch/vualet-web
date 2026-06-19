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
    private string _wgExe => Path.Combine(_wgDir, "wireguard.exe");
    private string _wgDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Mira VPN", "WireGuard");
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

    // --- silent WireGuard bootstrap ---

    private bool EnsureWireGuard()
    {
        if (File.Exists(_wgExe)) return true;
        SetState("Installing WireGuard...");
        try
        {
            Directory.CreateDirectory(_wgDir);
            var msi = Path.Combine(Path.GetTempPath(), "wireguard-installer.msi");
            if (!File.Exists(msi) || new FileInfo(msi).Length < 1_000_000)
            {
                using var client = new HttpClient();
                var data = client.GetByteArrayAsync("https://download.wireguard.com/windows-client/wireguard-installer.exe").Result;
                File.WriteAllBytes(msi, data);
            }
            // msiexec /i with /quiet — fully silent, no UI, no reboot
            var psi = new ProcessStartInfo("msiexec.exe", $"/i \"{msi}\" /quiet /norestart DO_NOT_LAUNCH=1")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden
            };
            var p = Process.Start(psi)!;
            p.WaitForExit(120_000);
            if (File.Exists(_wgExe)) return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine("WireGuard silent install failed: " + ex.Message);
        }
        SetState("Setup failed");
        return false;
    }

    // --- connect / disconnect ---

    private async void Connect()
    {
        SetState("Connecting...");
        try
        {
            if (!EnsureWireGuard())
            {
                _icon.Text = "Mira VPN - setup failed";
                SetState("Setup failed - try again");
                return;
            }

            var priv = RunWg("genkey");
            var pub = RunWg("pubkey", priv);
            if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub)) { SetState("Keygen failed"); return; }

            var resp = await _http.PostAsJsonAsync("tunnel/issue", new { public_key = pub.Trim(), tier = "free" });
            if (!resp.IsSuccessStatusCode) { SetState("Registration failed"); return; }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
            var ip = json.GetProperty("ip").GetString()!;
            var config = json.GetProperty("config").GetString()!.Replace("FILL_ME", priv.Trim());

            var tmp = Path.GetTempFileName() + ".conf";
            File.WriteAllText(tmp, config);
            RunWg("/installtunnelservice \"" + tmp + "\"");
            File.Delete(tmp);
            RunWg("/activate \"" + TunnelName + "\"");

            _connected = true;
            _icon.Text = "Mira VPN - Connected (" + ip + ")";
            SetState("Connected (" + ip + ")");
        }
        catch (Exception ex)
        {
            Debug.WriteLine("Mira connect failed: " + ex.Message);
            SetState("Connection failed");
        }
    }

    private void Disconnect()
    {
        try { if (File.Exists(_wgExe)) RunWg("/uninstalltunnelservice \"" + TunnelName + "\""); }
        catch { }
        _connected = false;
        _icon.Text = "Mira VPN - disconnected";
        SetState("Disconnected");
    }

    private string RunWg(string args, string? stdin = null)
    {
        var psi = new ProcessStartInfo(_wgExe, args)
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
