using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows;
using System.Windows.Forms;
using Microsoft.Win32;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;
using MessageBoxResult = System.Windows.MessageBoxResult;

namespace MiraVpn;

public enum ConnectionState { Disconnected, Probing, Connecting, Connected, Disconnecting, Reconnecting, Error }

public class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ConnectionService _svc;
    private MainWindow? _mainWindow;
    private readonly Icon[] _animIcons;
    private readonly System.Windows.Forms.Timer _animTimer;
    private int _animFrame;
    private readonly Icon _staticIcon;

    public ConnectionService Service => _svc;

    // Forwarded events for external subscribers (MainWindow, App)
    public event Action<ConnectionState, string>? StateChanged;
    public event Action<string>? LogMessage;
    public event Action<ulong, ulong, long>? StatsUpdated;
    public event Action? ExitRequested;

    // Forwarded properties
    public bool IsConnected => _svc.IsConnected;
    public string ConnectedEndpoint => _svc.ConnectedEndpoint;
    public long ConnectedRtt => _svc.ConnectedRtt;

    public TrayIcon()
    {
        _svc = new ConnectionService();
        _staticIcon = LoadMiraIcon();
        _animIcons = GenerateAnimFrames();

        _animTimer = new System.Windows.Forms.Timer { Interval = 250 };
        _animTimer.Tick += (_, _) =>
        {
            _animFrame = (_animFrame + 1) % _animIcons.Length;
            _icon.Icon = _animIcons[_animFrame];
        };

        _icon = new NotifyIcon
        {
            Icon = _staticIcon,
            Text = "Mira VPN — Disconnected",
            Visible = false,
            ContextMenuStrip = BuildMenu()
        };
        _icon.DoubleClick += (_, _) => ShowMainWindow();

        // Reflect connection state in the tray icon text and menu, and animate icon
        _svc.StateChanged += (state, msg) =>
        {
            if (_icon.ContextMenuStrip?.Items[0] is ToolStripMenuItem si)
                si.Text = "Status: " + msg;
            _icon.Text = $"Mira VPN — {msg}"[..Math.Min(63, $"Mira VPN — {msg}".Length)];
            StateChanged?.Invoke(state, msg);

            // Animate tray icon during Connecting/Probing/Reconnecting, static otherwise
            switch (state)
            {
                case ConnectionState.Probing:
                case ConnectionState.Connecting:
                case ConnectionState.Reconnecting:
                    _animFrame = 0;
                    _animTimer.Start();
                    break;
                default:
                    _animTimer.Stop();
                    _icon.Icon = _staticIcon;
                    break;
            }
        };

        // Forward balloon requests from the service to the tray icon
        _svc.BalloonRequested += (title, text, icon) => _icon.ShowBalloonTip(3000, title, text, icon);

        // Forward log messages, stats, and exit to external subscribers
        _svc.LogMessage += msg => LogMessage?.Invoke(msg);
        _svc.StatsUpdated += (rx, tx, h) => StatsUpdated?.Invoke(rx, tx, h);
        _svc.ExitRequested += () => ExitRequested?.Invoke();
    }

    public void Show() { _icon.Visible = true; }
    public void SetMainWindow(MainWindow w) { _mainWindow = w; }

    public void Connect() => _svc.Connect();
    public async Task Disconnect() => await _svc.Disconnect();

    private ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        m.Items.Add(new ToolStripMenuItem("Status: Disconnected") { Enabled = false });
        m.Items.Add(new ToolStripSeparator());
        var cn = new ToolStripMenuItem("Connect", null, (_, _) => { ShowMainWindow(); _svc.Connect(); })
        {
            Font = new System.Drawing.Font("Segoe UI", 9, System.Drawing.FontStyle.Bold)
        };
        m.Items.Add(cn);
        m.Items.Add(new ToolStripMenuItem("Disconnect", null, (_, _) => { ShowMainWindow(); _ = _svc.Disconnect(); }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Show Mira VPN", null, (_, _) => ShowMainWindow()));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Uninstall Mira VPN", null, (_, _) => Uninstall()));
        m.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => { _ = _svc.Disconnect(); _svc.RaiseExitRequested(); }));
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

    private void Uninstall()
    {
        if (MessageBox.Show(
            "Remove Mira VPN from your computer?\n\nAll settings, logs, and network configuration will be deleted.",
            "Uninstall Mira VPN", MessageBoxButton.OKCancel, MessageBoxImage.Warning) != MessageBoxResult.OK)
            return;

        Logger.Info("TrayIcon", "Uninstall initiated");
        if (_svc.IsConnected) { try { NativeBridge.mira_stop(); } catch { } }
        try { FirewallHelper.RemoveRules(); } catch { }
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true);
            k?.DeleteValue("MiraVPN", false);
        }
        catch { }
        try
        {
            File.Delete(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs", "Mira VPN.lnk"));
            File.Delete(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                "Mira VPN.lnk"));
        }
        catch { }
        var batch = Path.Combine(Path.GetTempPath(), "mira-uninstall-cleanup.bat");
        File.WriteAllText(batch,
            $"@echo off\r\ntimeout /t 3 /nobreak >nul\r\nrd /s /q \"{App.AppDataDir}\" 2>nul\r\ndel \"%~f0\" 2>nul\r\n");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = batch, UseShellExecute = true,
                CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch { }
        _icon.Visible = false;
        _svc.RaiseExitRequested();
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

    /// <summary>
    /// Generate 4 animation frames — 16×16 icons with a small rotating arc (GDI+).
    /// Frame 0: arc at top (0°), Frame 1: right (90°), Frame 2: bottom (180°), Frame 3: left (270°).
    /// </summary>
    private static Icon[] GenerateAnimFrames()
    {
        var frames = new Icon[4];
        for (int i = 0; i < 4; i++)
        {
            using var bmp = new Bitmap(16, 16);
            using var g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Draw the static icon small as background
            using var fg = new System.Drawing.Font("Segoe UI", 7, System.Drawing.FontStyle.Bold);
            using var bg = new SolidBrush(System.Drawing.Color.FromArgb(200, 200, 220));
            g.DrawString("M", fg, bg, new System.Drawing.PointF(-1, 0));

            // Draw rotating arc indicator
            float startAngle = i * 90f;
            float sweepAngle = 60f;
            using var arcPen = new System.Drawing.Pen(System.Drawing.Color.FromArgb(248, 165, 160), 1.5f);
            // Draw a small arc ring at the edge
            var rect = new System.Drawing.RectangleF(10, 1, 5, 5);
            g.DrawArc(arcPen, rect, startAngle, sweepAngle);

            frames[i] = Icon.FromHandle(bmp.GetHicon());
        }
        return frames;
    }

    public void Dispose()
    {
        _animTimer.Stop(); _animTimer.Dispose();
        if (_svc.IsConnected) _ = _svc.Disconnect();
        _icon.Visible = false; _icon.Dispose();
        _svc.Dispose();
    }
}
