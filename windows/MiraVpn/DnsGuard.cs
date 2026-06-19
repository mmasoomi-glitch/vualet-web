using System.Diagnostics;
using System.Net.NetworkInformation;

namespace MiraVpn;

public static class DnsGuard
{
    private static string? _savedDns;

    /// <summary>
    /// Sets DNS servers on the VPN adapter to prevent DNS leaks.
    /// First saves current DNS, then applies the specified servers.
    /// </summary>
    public static void Enable(string[] dnsServers, string adapterName = AppConfig.WG_ADAPTER_NAME)
    {
        if (dnsServers == null || dnsServers.Length == 0) return;

        try
        {
            // Save current DNS before changing
            _savedDns = GetCurrentPrimaryDns();
            Logger.Info("DnsGuard", $"Saved current DNS: {_savedDns ?? "none"}");
        }
        catch (Exception ex)
        {
            Logger.Error("DnsGuard", $"Failed to save current DNS: {ex.Message}");
        }

        try
        {
            bool adapterFound = AdapterExists(adapterName);
            string targetAdapter = adapterFound ? adapterName : FindFirstNonLoopbackAdapter();

            if (string.IsNullOrEmpty(targetAdapter))
            {
                Logger.Error("DnsGuard", "No suitable adapter found for DNS configuration");
                return;
            }

            if (!adapterFound)
            {
                Logger.Info("DnsGuard", $"Adapter '{adapterName}' not found — setting DNS on '{targetAdapter}' instead");
            }

            // Set primary DNS
            var psi = new ProcessStartInfo("netsh", $"interface ip set dns name=\"{targetAdapter}\" static {dnsServers[0]} primary")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(5000);
            var output = proc?.StandardOutput.ReadToEnd() ?? "";
            var err = proc?.StandardError.ReadToEnd() ?? "";
            if (proc?.ExitCode != 0)
                Logger.Error("DnsGuard", $"Primary DNS set failed (exit {proc?.ExitCode}): {err.Trim()}");
            else
                Logger.Info("DnsGuard", $"Primary DNS set to {dnsServers[0]} on '{targetAdapter}'");

            // Set secondary DNS
            if (dnsServers.Length > 1)
            {
                var psi2 = new ProcessStartInfo("netsh", $"interface ip add dns name=\"{targetAdapter}\" {dnsServers[1]} index=2")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc2 = Process.Start(psi2);
                proc2?.WaitForExit(5000);
                var err2 = proc2?.StandardError.ReadToEnd() ?? "";
                if (proc2?.ExitCode != 0)
                    Logger.Error("DnsGuard", $"Secondary DNS add failed (exit {proc2?.ExitCode}): {err2.Trim()}");
                else
                    Logger.Info("DnsGuard", $"Secondary DNS set to {dnsServers[1]} on '{targetAdapter}'");
            }
        }
        catch (Exception ex)
        {
            Logger.Error("DnsGuard", $"Enable failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Restores the original DNS server that was saved during Enable().
    /// Falls back to 1.1.1.1 if restoration fails.
    /// </summary>
    public static void Disable()
    {
        try
        {
            string restoreDns = _savedDns ?? "1.1.1.1";
            Logger.Info("DnsGuard", $"Restoring DNS to: {restoreDns}");

            string adapter = FindFirstNonLoopbackAdapter();
            if (string.IsNullOrEmpty(adapter))
            {
                Logger.Error("DnsGuard", "No adapter found to restore DNS");
                return;
            }

            var psi = new ProcessStartInfo("netsh", $"interface ip set dns name=\"{adapter}\" static {restoreDns} primary")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(5000);
            var err = proc?.StandardError.ReadToEnd() ?? "";

            if (proc?.ExitCode != 0)
            {
                Logger.Error("DnsGuard", $"DNS restore failed (exit {proc?.ExitCode}): {err.Trim()} — falling back to 1.1.1.1");
                // Safe fallback
                var fb = new ProcessStartInfo("netsh", $"interface ip set dns name=\"{adapter}\" static 1.1.1.1 primary")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var fbProc = Process.Start(fb);
                fbProc?.WaitForExit(5000);
                Logger.Info("DnsGuard", $"DNS fallback to 1.1.1.1 (exit {fbProc?.ExitCode})");
            }
            else
            {
                Logger.Info("DnsGuard", $"DNS restored to {restoreDns}");
            }

            _savedDns = null;
        }
        catch (Exception ex)
        {
            Logger.Error("DnsGuard", $"Disable failed: {ex.Message}");
        }
    }

    private static string GetCurrentPrimaryDns()
    {
        try
        {
            var psi = new ProcessStartInfo("netsh", "interface ip show dns")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(5000);
            var output = proc?.StandardOutput.ReadToEnd() ?? "";

            // Parse lines looking for the first DNS server entry
            // Format: "    DNS servers configured through DHCP:  1.2.3.4" or similar
            foreach (var line in output.Split('\n'))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("DNS servers", StringComparison.OrdinalIgnoreCase))
                {
                    // Extract last token which should be an IP
                    var parts = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 0)
                    {
                        var candidate = parts[^1];
                        if (System.Net.IPAddress.TryParse(candidate, out _))
                            return candidate;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Logger.Error("DnsGuard", $"GetCurrentPrimaryDns failed: {ex.Message}");
        }
        return "";
    }

    private static bool AdapterExists(string name)
    {
        foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    private static string FindFirstNonLoopbackAdapter()
    {
        foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.NetworkInterfaceType != NetworkInterfaceType.Loopback &&
                ni.OperationalStatus == OperationalStatus.Up)
                return ni.Name;
        }
        return "";
    }
}
