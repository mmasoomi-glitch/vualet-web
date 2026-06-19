using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows;

namespace MiraVpn;

public partial class App : System.Windows.Application
{
    private static Mutex? _mutex;
    private TrayIcon? _tray;
    private MainWindow? _mainWindow;

    public static readonly string AppDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");
    public static readonly string InstallMarkerPath = Path.Combine(AppDataDir, "install.conf");
    public static bool IsInstalled => File.Exists(InstallMarkerPath);

    private void App_Startup(object sender, StartupEventArgs e)
    {
        _mutex = new Mutex(true, @"Global\MiraVpn_SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            System.Windows.MessageBox.Show("Mira VPN is already running in your system tray.\n\nRight-click the tray icon to control it.",
                "Mira VPN", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Information);
            Environment.Exit(0);
            return;
        }

        Directory.CreateDirectory(AppDataDir);
        Directory.CreateDirectory(Path.Combine(AppDataDir, "logs"));
        Directory.CreateDirectory(Path.Combine(AppDataDir, "Assets"));

        Logger.Initialize();
        Logger.Info("App", "Mira VPN starting up");

        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in new[] { "mira-tunnel.dll", "wintun.dll" })
        {
            var target = Path.Combine(AppDataDir, name);
            if (!File.Exists(target) || new FileInfo(target).Length < 1000)
            {
                using var s = asm.GetManifestResourceStream($"MiraVpn.Assets.{name}");
                if (s != null) { using var fs = File.Create(target); s.CopyTo(fs); }
            }
        }

        NativeBridge.Initialize(AppDataDir);
        Logger.Info("App", "Native libraries loaded");

        try
        {
            var exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName ?? "";
            if (!string.IsNullOrEmpty(exePath)) { FirewallHelper.EnsureRules(exePath); Logger.Info("App", "Firewall rules verified"); }
        }
        catch (Exception ex) { Logger.Error("App", $"Firewall setup failed: {ex.Message}"); }

        _tray = new TrayIcon();
        _tray.ExitRequested += () => { _tray.Dispose(); Shutdown(); };
        _tray.Show();
        Logger.Info("App", "Tray icon created");

        _mainWindow = new MainWindow(_tray);
        _tray.SetMainWindow(_mainWindow);

        if (!IsInstalled)
        {
            Logger.Info("App", "First launch — showing setup wizard");
            var wizard = new SetupWindow();
            wizard.ShowDialog();
            File.WriteAllText(InstallMarkerPath, $"Installed: {DateTime.UtcNow:O}");
            Logger.Info("App", "Installation marked complete");
        }

        _mainWindow.Show();
        Logger.Info("App", "Main window displayed");

        var prefs = Prefs.Load();
        if (prefs.AutoConnect)
        {
            Logger.Info("App", "Auto-connect enabled — starting connection");
            _mainWindow.Dispatcher.Invoke(() => _tray.Connect());
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Logger.Info("App", "Mira VPN shutting down");
        _tray?.Dispose();
        base.OnExit(e);
    }
}
