using System.Drawing;
using System.Reflection;
using System.Windows.Forms;

namespace MiraVpn;

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;

    public event Action? ExitRequested;

    public TrayIcon()
    {
        _icon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "Mira VPN — Disconnected",
            Visible = true
        };
        _icon.ContextMenuStrip = BuildMenu();
        _icon.DoubleClick += (_, _) => Toggle();
    }

    private static Icon LoadIcon()
    {
        try
        {
            using var s = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("MiraVpn.Resources.mira-icon-32.png");
            if (s == null) return SystemIcons.Shield;
            using var bmp = new Bitmap(s);
            return Icon.FromHandle(bmp.GetHicon());
        }
        catch { return SystemIcons.Shield; }
    }

    private ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        m.Items.Add("Connect", null, (_, _) => Toggle());
        m.Items.Add("Disconnect", null, (_, _) => Toggle());
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("Exit Mira VPN", null, (_, _) => { ExitRequested?.Invoke(); });
        return m;
    }

    private async void Toggle()
    {
        if (NativeTunnel.IsConnected)
        {
            NativeTunnel.Disconnect();
            _icon.Text = "Mira VPN — Disconnected";
            UpdateMenu(0, "Connect");
        }
        else
        {
            UpdateMenu(0, "Connecting...");
            _icon.Text = "Mira VPN — Connecting...";
            try
            {
                var best = await SmartRouter.PickBestAsync();
                var ip = await NativeTunnel.Connect(best.endpoint);
                _icon.Text = $"Mira VPN — Connected ({best.name}, {best.rttMs}ms)";
                UpdateMenu(0, "Disconnect");
            }
            catch (Exception ex)
            {
                _icon.Text = "Mira VPN — Connection failed";
                _icon.ShowBalloonTip(3000, "Mira VPN", $"Connection failed: {ex.Message}", ToolTipIcon.Error);
                UpdateMenu(0, "Connect (retry)");
            }
        }
    }

    private void UpdateMenu(int idx, string text)
    {
        var items = _icon.ContextMenuStrip?.Items;
        if (items != null && items.Count > idx)
            items[idx]!.Text = text;
    }

    public void Dispose() => _icon.Dispose();
}
