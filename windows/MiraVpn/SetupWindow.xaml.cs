using System.Diagnostics;
using System.IO;
using System.Reflection;
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

    private void CancelBtn_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private async void InstallBtn_Click(object sender, RoutedEventArgs e)
    {
        InstallBtn.IsEnabled = false;
        CancelBtn.IsEnabled = false;
        LogPlaceholder.Visibility = Visibility.Collapsed;

        var target = PathBox.Text;
        Log("Installing to: " + target);

        try
        {
            Directory.CreateDirectory(target);

            // 1) Extract wintun.dll (the kernel TUN driver — MIT license)
            Log("Extracting network driver...");
            Extract("MiraVpn.Resources.wintun.dll", Path.Combine(target, "wintun.dll"));

            // 2) Extract and install WireGuard MSI silently
            var msi = Path.Combine(Path.GetTempPath(), "wireguard.msi");
            if (!File.Exists(msi) || new FileInfo(msi).Length < 1_000_000)
            {
                Log("Extracting network engine...");
                Extract("MiraVpn.Resources.wireguard.msi", msi);
            }
            Log("Installing network engine (one-time)...");
            var psi = new ProcessStartInfo("msiexec.exe", $"/i \"{msi}\" /quiet /norestart DO_NOT_LAUNCH=1")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden
            };
            var p = Process.Start(psi)!;
            await Task.Run(() => p.WaitForExit(120_000));
            Log(p.ExitCode == 0 ? "Engine installed" : "Engine may already be installed");

            // 3) Copy wireguard.exe from Program Files to our directory
            var wgSrc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "WireGuard", "wireguard.exe");
            var wgDst = Path.Combine(target, "wireguard.exe");
            if (File.Exists(wgSrc))
            {
                File.Copy(wgSrc, wgDst, true);
                Log("Network engine ready");
            }
            else
            {
                Log("WARNING: engine binary not found. Setup may need Administrator.");
            }

            // 4) Copy ourselves to target (or note we're already there)
            var myExe = Environment.ProcessPath ?? "";
            var targetExe = Path.Combine(target, "MiraVpn.exe");
            if (!string.Equals(myExe, targetExe, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(myExe, targetExe, true);
                Log("Mira VPN copied to install folder");
            }

            // 5) Create shortcuts
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu) + @"\Programs\Mira VPN.lnk");
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.Desktop) + @"\Mira VPN.lnk");
            Log("Shortcuts created (Start Menu + Desktop)");

            // 6) Mark as installed
            File.WriteAllText(Path.Combine(target, "install.conf"), DateTime.UtcNow.ToString("O"));
            Log("");
            Log("Installation complete.");

            // 7) Launch tray mode
            Process.Start(targetExe);

            // 8) Exit setup
            await Task.Delay(1500);
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            Log("ERROR: " + ex.Message);
            InstallBtn.IsEnabled = true;
            CancelBtn.IsEnabled = true;
        }
    }

    private static void Extract(string resourceName, string dest)
    {
        if (File.Exists(dest)) return;
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
        if (s == null) throw new Exception($"Resource '{resourceName}' not found in assembly");
        using var fs = File.Create(dest);
        s.CopyTo(fs);
    }

    private static void CreateShortcut(string target, string workDir, string shortcutPath)
    {
        try
        {
            var dir = Path.GetDirectoryName(shortcutPath);
            if (dir != null) Directory.CreateDirectory(dir);
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var lnk = shell.CreateShortcut(shortcutPath);
            lnk.TargetPath = target;
            lnk.WorkingDirectory = workDir;
            lnk.Description = "Mira VPN";
            lnk.Save();
        }
        catch { /* non-critical */ }
    }

    private void Log(string msg)
    {
        Dispatcher.Invoke(() =>
        {
            LogBox.AppendText(msg + "\n");
            LogBox.ScrollToEnd();
        });
    }
}
