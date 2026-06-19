using System.Diagnostics;
using System.Drawing;
using System.IO;
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
    private readonly ConnectionService _svc;
    private MainWindow? _mainWindow;

    public ConnectionService Service => _svc;

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

        // Reflect connection state in the tray icon text and menu
        _svc.StateChanged += (_, msg) =>
        {
            if (_icon.ContextMenuStrip?.Items[0] is ToolStripMenuItem si)
                si.Text = "Status: " + msg;
            _icon.Text = $"Mira VPN — {msg}"[..Math.Min(63, $"Mira VPN — {msg}".Length)];
        };

        // Forward balloon requests from the service to the tray icon
        _svc.BalloonRequested += (title, text, icon) => _icon.ShowBalloonTip(3000, title, text, icon);
    }

    public void Show() { _icon.Visible = true; }
    public void SetMainWindow(MainWindow w) { _mainWindow = w; }

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

    public void Dispose()
    {
        if (_svc.IsConnected) _ = _svc.Disconnect();
        _icon.Visible = false; _icon.Dispose();
        _svc.Dispose();
    }
}
