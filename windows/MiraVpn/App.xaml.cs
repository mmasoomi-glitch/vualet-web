using System.Windows;

namespace MiraVpn;

public partial class App : System.Windows.Application
{
    private TrayIcon? _tray;

    private void App_Startup(object sender, StartupEventArgs e)
    {
        _tray = new TrayIcon();
        _tray.ExitRequested += () => Shutdown();
        _tray.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }
}
