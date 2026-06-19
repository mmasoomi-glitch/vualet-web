using System.IO;
using System.Reflection;
using System.Windows;

namespace MiraVpn;

public partial class App : System.Windows.Application
{
    private TrayIcon? _tray;
    public static readonly string AppDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");
    private static readonly string _installConf = Path.Combine(AppDataDir, "install.conf");

    private void App_Startup(object sender, StartupEventArgs e)
    {
        Directory.CreateDirectory(AppDataDir);

        // Extract embedded native DLLs on first run
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in new[] { "mira-tunnel.dll", "wintun.dll" })
        {
            var target = Path.Combine(AppDataDir, name);
            if (!File.Exists(target))
            {
                using var s = asm.GetManifestResourceStream($"MiraVpn.Assets.{name}");
                if (s != null) { using var fs = File.Create(target); s.CopyTo(fs); }
            }
        }

        // Init P/Invoke bridge
        NativeBridge.Initialize(AppDataDir);

        // First launch → setup wizard
        if (!File.Exists(_installConf))
        {
            var wizard = new SetupWindow();
            wizard.Show();
            return;
        }

        StartTray();
    }

    public void StartTray()
    {
        _tray = new TrayIcon();
        _tray.ExitRequested += () => { _tray.Dispose(); Shutdown(); };
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }
}
