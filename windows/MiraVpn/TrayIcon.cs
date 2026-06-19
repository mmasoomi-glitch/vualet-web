using System.Windows.Forms;

namespace MiraVpn;

/// <summary>
/// System-tray icon with Connect/Disconnect/Exit. Double-click toggles
/// the tunnel. All WireGuard branding is hidden — the user sees only
/// "Mira VPN — Connected (Nuremberg, 42ms)".
/// </summary>
public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private bool _connected;

    public event Action? ExitRequested;

    public TrayIcon()
    {
        _icon = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "Mira VPN — Disconnected",
            Visible = true
        };
        _icon.ContextMenuStrip = BuildMenu();
        _icon.DoubleClick += (_, _) => Toggle();
        _icon.BalloonTipTitle = "Mira VPN";
        _icon.BalloonTipText = "Mira VPN is running in the system tray. Right-click to connect.";
        _icon.BalloonTipIcon = ToolTipIcon.Info;
        _icon.ShowBalloonTip(5000);
    }

    public bool Connected => _connected;

    private static Icon LoadTrayIcon()
    {
        try
        {
            using var stream = System.Reflection.Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("MiraVpn.Resources.mira-tray.ico");
            if (stream != null) return new Icon(stream);
        }
        catch { }
        return SystemIcons.Shield; // fallback
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        var connectItem = new ToolStripMenuItem("Connect", null, (_, _) => Toggle()) { Font = new System.Drawing.Font(menu.Font!, System.Drawing.FontStyle.Bold) };
        var disconnectItem = new ToolStripMenuItem("Disconnect", null, (_, _) => Toggle());
        menu.Items.Add(connectItem);
        menu.Items.Add(disconnectItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit Mira VPN", null, (_, _) => { Dispose(); ExitRequested?.Invoke(); });
        return menu;
    }

    private async void Toggle()
    {
        if (_connected)
        {
            NativeTunnel.Disconnect();
            _connected = false;
            _icon.Text = "Mira VPN — Disconnected";
            UpdateMenu("Connect", "Disconnect");
        }
        else
        {
            UpdateMenu("Connecting...", "Disconnect");
            _icon.Text = "Mira VPN — Connecting...";
            try
            {
                var ip = await NativeTunnel.Connect();
                _connected = true;
                var label = NativeTunnel.Endpoint ?? "Mira server";
                var rttStr = SmartRouter.PickBestAsync().Result.rttMs > 0
                    ? $" ({SmartRouter.PickBestAsync().Result.rttMs}ms)"
                    : "";
                _icon.Text = $"Mira VPN — Connected ({label}{rttStr})";
                UpdateMenu("Disconnect", "Connect");
            }
            catch (Exception ex)
            {
                _icon.Text = "Mira VPN — Connection failed";
                UpdateMenu("Connect (retry)", "Disconnect");
                _icon.ShowBalloonTip(3000, "Mira VPN", $"Connection failed: {ex.Message}", ToolTipIcon.Error);
            }
        }
    }

    private void UpdateMenu(string item0, string item1)
    {
        var items = _icon.ContextMenuStrip?.Items;
        if (items == null || items.Count < 2) return;
        items[0]!.Text = item0;
        items[1]!.Text = item1;
    }

    public void Dispose() => _icon.Dispose();
}
