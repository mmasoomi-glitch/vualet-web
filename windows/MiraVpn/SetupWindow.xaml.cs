using System.Diagnostics;
using System.IO;
using System.Windows;

namespace MiraVpn;

public partial class SetupWindow : Window
{
    private static readonly string _home = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");

    public SetupWindow()
    {
        InitializeComponent();
        PathBox.Text = _home;
        LogBox.Text = "";
    }

    private void BrowseBtn_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "Choose where to install Mira VPN",
            InitialDirectory = _home
        };
        if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
            PathBox.Text = dlg.SelectedPath;
    }

    private void CancelBtn_Click(object sender, RoutedEventArgs e) { Close(); }

    private async void InstallBtn_Click(object sender, RoutedEventArgs e)
    {
        InstallBtn.IsEnabled = false; CancelBtn.IsEnabled = false;
        LogPlaceholder.Visibility = Visibility.Collapsed;
        var target = PathBox.Text;
        Log("Installing to: " + target);

        try
        {
            Directory.CreateDirectory(target);

            // Copy the current exe to install location
            var myExe = Environment.ProcessPath ?? "";
            var targetExe = Path.Combine(target, "MiraVpn.exe");
            if (!string.Equals(myExe, targetExe, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(myExe, targetExe, true);
                Log("Mira VPN copied to install folder");
            }

            // Network driver is already extracted to AppData by App.xaml.cs startup
            var appDataDir = App.AppDataDir;
            Log("Network driver ready (" + appDataDir + ")");

            // Create shortcuts
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu) + @"\Programs\Mira VPN.lnk");
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.Desktop) + @"\Mira VPN.lnk");
            Log("Shortcuts created (Start Menu + Desktop)");

            // Mark installed
            File.WriteAllText(Path.Combine(target, "install.conf"), DateTime.UtcNow.ToString("O"));
            Log(""); Log("Installation complete.");

            // Launch tray mode
            Process.Start(targetExe);
            await Task.Delay(1500);
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            Log("ERROR: " + ex.Message);
            InstallBtn.IsEnabled = true; CancelBtn.IsEnabled = true;
        }
    }

    private static void CreateShortcut(string target, string workDir, string path)
    {
        try
        {
            var dir = Path.GetDirectoryName(path);
            if (dir != null) Directory.CreateDirectory(dir);
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var lnk = shell.CreateShortcut(path);
            lnk.TargetPath = target; lnk.WorkingDirectory = workDir; lnk.Description = "Mira VPN"; lnk.Save();
        }
        catch { /* non-critical */ }
    }

    private void Log(string msg) { Dispatcher.Invoke(() => { LogBox.AppendText(msg + "\n"); LogBox.ScrollToEnd(); }); }
}
