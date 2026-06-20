using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Forms;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace MiraVpn;

// Kept full enum so MainWindow.xaml.cs switch compiles unchanged
public enum ConnectionState { Disconnected, Probing, Connecting, Connected, Disconnecting, Reconnecting, Error }

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ConnectionService _svc;
    private MainWindow? _mainWindow;
    private ToolStripMenuItem? _statusItem;

    public ConnectionService Service => _svc;
    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    // Stub: MainWindow subscribes to this; we never fire it (stats panel shows "--")
    public event Action<ulong, ulong, long>? StatsUpdated;

    public TrayIcon()
    {
        _svc = new ConnectionService();

        _icon = new NotifyIcon
        {
            Icon = LoadMiraIcon(),
            Text = "Mira VPN — Disconnected",
            Visible = false,
            ContextMenuStrip = BuildMenu()
        };
        _icon.DoubleClick += (_, _) => ShowMainWindow();

        _svc.StateChanged += (state, msg) =>
        {
            var label = $"Mira VPN — {msg}";
            _icon.Text = label.Length > 63 ? label[..63] : label;
            if (_statusItem != null) _statusItem.Text = "Status: " + msg;

            if (state == ConnectionState.Connected)
                _icon.ShowBalloonTip(3000, "Mira VPN", "Connected", ToolTipIcon.Info);
            else if (state == ConnectionState.Error)
                _icon.ShowBalloonTip(4000, "Mira VPN", msg, ToolTipIcon.Error);

            StateChanged?.Invoke(state, msg);
        };

        _svc.LogMessage += msg => LogMessage?.Invoke(msg);
    }

    public void Show() { _icon.Visible = true; }
    public void SetMainWindow(MainWindow w) { _mainWindow = w; }
    public void Connect() => _svc.Connect();
    public async Task Disconnect() => await _svc.Disconnect();

    private ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        _statusItem = new ToolStripMenuItem("Status: Disconnected") { Enabled = false };
        m.Items.Add(_statusItem);
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Connect", null,
            (_, _) => { ShowMainWindow(); _svc.Connect(); })
        { Font = new Font("Segoe UI", 9, System.Drawing.FontStyle.Bold) });
        m.Items.Add(new ToolStripMenuItem("Disconnect", null,
            (_, _) => _ = _svc.Disconnect()));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Show Window", null, (_, _) => ShowMainWindow()));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) =>
        {
            _ = _svc.Disconnect();
            _svc.RaiseExitRequested();
        }));
        return m;
    }

    private void ShowMainWindow()
    {
        if (_mainWindow == null) return;
        _mainWindow.Dispatcher.Invoke(() =>
        {
            _mainWindow.Show();
            _mainWindow.WindowState = WindowState.Normal;
            _mainWindow.Activate();
        });
    }

    private static Icon LoadMiraIcon()
    {
        try
        {
            using var s = System.Reflection.Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("MiraVpn.Resources.mira-icon-32.png");
            if (s != null) { using var bmp = new Bitmap(s); return Icon.FromHandle(bmp.GetHicon()); }
        }
        catch { }
        return SystemIcons.Shield;
    }

    public void Dispose()
    {
        if (_svc.State == ConnectionState.Connected) _ = _svc.Disconnect();
        _icon.Visible = false;
        _icon.Dispose();
        _svc.Dispose();
    }
}
