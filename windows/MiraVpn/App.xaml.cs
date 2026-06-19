using System.IO;
using System.Windows;

namespace MiraVpn;

public partial class App : System.Windows.Application
{
    private static readonly string _installConf = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Mira VPN", "install.conf");

    private TrayIcon? _tray;

    private void App_Startup(object sender, StartupEventArgs e)
    {
        // If never installed, show branded graphical setup
        if (!File.Exists(_installConf))
        {
            var setup = new SetupWindow();
            setup.Show();
            return;
        }

        // Already installed — go straight to tray
        StartTray();
    }

    private void StartTray()
    {
        _tray = new TrayIcon();
        _tray.ExitRequested += () =>
        {
            _tray.Dispose();
            Shutdown();
        };
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }
}
