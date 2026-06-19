using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Win32;

namespace MiraVpn;

public partial class SetupWindow : Window
{
    private static readonly string _home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");
    private readonly bool _isReinstall;

    public SetupWindow()
    {
        InitializeComponent();
        PathBox.Text = _home;
        LogBox.Text = "";
        _isReinstall = App.IsInstalled;

        if (_isReinstall)
        {
            ReinstallWarning.Visibility = Visibility.Visible;
            SubtitleText.Text = "Reinstall the network driver and reset settings.";
            InstallBtn.Content = "Reinstall";
            Title = "Mira VPN — Reinstall";
            var prefs = Prefs.Load();
            AutoStartCheck.IsChecked = prefs.AutoStart;
            AutoConnectCheck.IsChecked = prefs.AutoConnect;
        }
    }

    private void BrowseBtn_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new System.Windows.Forms.FolderBrowserDialog { Description = "Choose where to install Mira VPN", InitialDirectory = _home };
        if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK) PathBox.Text = dlg.SelectedPath;
    }

    private void CancelBtn_Click(object sender, RoutedEventArgs e) { Close(); }

    private async void InstallBtn_Click(object sender, RoutedEventArgs e)
    {
        InstallBtn.IsEnabled = false; CancelBtn.IsEnabled = false; LogPlaceholder.Visibility = Visibility.Collapsed;
        var target = PathBox.Text;
        Log("Installing to: " + target);
        try
        {
            Directory.CreateDirectory(target);
            var myExe = Environment.ProcessPath ?? "";
            var targetExe = Path.Combine(target, "MiraVpn.exe");
            if (!string.Equals(myExe, targetExe, StringComparison.OrdinalIgnoreCase)) { File.Copy(myExe, targetExe, true); Log("Copied to install folder"); }

            // Save prefs
            var prefs = Prefs.Load();
            prefs.InstallPath = target;
            prefs.AutoStart = AutoStartCheck.IsChecked ?? true;
            prefs.AutoConnect = AutoConnectCheck.IsChecked ?? false;
            prefs.FirstRunComplete = true;
            prefs.Save();

            if (prefs.AutoStart) SetAutoStart(targetExe); else RemoveAutoStart();

            // Create shortcuts
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu) + @"\Programs\Mira VPN.lnk");
            CreateShortcut(targetExe, target, Environment.GetFolderPath(Environment.SpecialFolder.Desktop) + @"\Mira VPN.lnk");
            Log("Shortcuts created");

            File.WriteAllText(App.InstallMarkerPath, $"Installed: {System.DateTime.UtcNow:O}");
            Log(""); Log("Installation complete.");

            Process.Start(targetExe);
            await Task.Delay(1500);
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex) { Log("ERROR: " + ex.Message); InstallBtn.IsEnabled = true; CancelBtn.IsEnabled = true; }
    }

    private static void CreateShortcut(string target, string workDir, string path)
    {
        try
        {
            var dir = Path.GetDirectoryName(path); if (dir != null) Directory.CreateDirectory(dir);
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var lnk = shell.CreateShortcut(path);
            lnk.TargetPath = target; lnk.WorkingDirectory = workDir; lnk.Description = "Mira VPN"; lnk.Save();
        }
        catch { }
    }

    private static void SetAutoStart(string exePath)
    {
        try { using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true); k?.SetValue("MiraVPN", $"\"{exePath}\""); } catch { }
    }

    private static void RemoveAutoStart()
    {
        try { using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true); k?.DeleteValue("MiraVPN", false); } catch { }
    }

    private void Log(string msg) { Dispatcher.Invoke(() => { LogBox.AppendText(msg + "\n"); LogBox.ScrollToEnd(); }); }
}
