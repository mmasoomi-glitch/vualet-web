using System.Windows;

namespace MiraVpn;

/// <summary>
/// Entry point. Bootstraps the embedded TUN driver on first launch
/// (extracts wintun.dll from resources — no download, no user prompt),
/// then starts the tray icon. Exits cleanly with Dispose.
/// </summary>
public partial class App : System.Windows.Application
{
    private TrayIcon? _tray;

    private async void App_Startup(object sender, StartupEventArgs e)
    {
        if (!NativeTunnel.Bootstrap())
        {
            MessageBox.Show(
                "Mira VPN could not install its network driver.\n\n" +
                "Please ensure you have Administrator privileges and try again.",
                "Mira VPN — Setup Error",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            Shutdown();
            return;
        }

        _tray = new TrayIcon();
        _tray.ExitRequested += () =>
        {
            if (_tray.Connected) NativeTunnel.Disconnect();
            Shutdown();
        };
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }
}
