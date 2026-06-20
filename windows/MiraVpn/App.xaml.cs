using System.IO;
using System.Reflection;
using System.Threading;
using System.Diagnostics;
using System.Security.Principal;
using System.Windows;
using MessageBox = System.Windows.MessageBox;

namespace MiraVpn;

public partial class App : System.Windows.Application
{
    private static Mutex? _mutex;
    private TrayIcon? _tray;
    private MainWindow? _mainWindow;

    public static readonly string AppDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");

    // Kept for SetupWindow compat (SetupWindow is never shown in v2, but still compiles)
    public static readonly string InstallMarkerPath = Path.Combine(AppDataDir, "install.conf");
    public static bool IsInstalled => File.Exists(InstallMarkerPath);

    private void App_Startup(object sender, StartupEventArgs e)
    {
        var principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            try { Process.Start(new ProcessStartInfo(
                Process.GetCurrentProcess().MainModule!.FileName)
                { Verb = "runas", UseShellExecute = true }); }
            catch { }
            Environment.Exit(0);
            return;
        }

        _mutex = new Mutex(true, @"Global\MiraVpn_SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            MessageBox.Show("Mira VPN is already running in your system tray.",
                "Mira VPN", MessageBoxButton.OK, MessageBoxImage.Information);
            Environment.Exit(0);
            return;
        }

        Directory.CreateDirectory(AppDataDir);
        Directory.CreateDirectory(Path.Combine(AppDataDir, "logs"));

        Logger.Initialize();
        Logger.Info("App", "Mira VPN v2 starting");

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

        _tray = new TrayIcon();
        _tray.Service.ExitRequested += () => { _tray.Dispose(); Shutdown(); };
        _tray.Show();

        _mainWindow = new MainWindow(_tray);
        _tray.SetMainWindow(_mainWindow);
        _mainWindow.Show();

        Logger.Info("App", "Ready");
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Logger.Info("App", "Shutting down");
        _tray?.Dispose();
        base.OnExit(e);
    }
}
