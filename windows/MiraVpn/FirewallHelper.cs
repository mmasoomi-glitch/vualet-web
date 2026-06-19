using System.Diagnostics;

namespace MiraVpn;

public static class FirewallHelper
{
    private const string RULE_PROG = "Mira VPN";
    private const string RULE_TUN = "Mira VPN Tunnel";

    public static void EnsureRules(string exePath)
    {
        if (!RuleExists(RULE_PROG))
            RunNetsh($"advfirewall firewall add rule name=\"{RULE_PROG}\" dir=in action=allow program=\"{exePath}\" enable=yes");
        if (!RuleExists(RULE_TUN))
            RunNetsh($"advfirewall firewall add rule name=\"{RULE_TUN}\" dir=in action=allow protocol=UDP localport=51820,51821,53,443");
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_TUN} Out\" protocol=UDP dir=out");
        RunNetsh($"advfirewall firewall add rule name=\"{RULE_TUN} Out\" dir=out action=allow protocol=UDP localport=51820,51821,53,443");
    }

    public static void RemoveRules()
    {
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_PROG}\"");
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_TUN}\"");
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_TUN} Out\"");
    }

    private static bool RuleExists(string name)
    {
        try
        {
            var psi = new ProcessStartInfo("netsh", $"advfirewall firewall show rule name=\"{name}\"")
            { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            return output.Contains(name);
        }
        catch { return false; }
    }

    private static void RunNetsh(string args)
    {
        try
        {
            var psi = new ProcessStartInfo("netsh", args)
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi);
            p?.WaitForExit(10000);
        }
        catch (Exception ex) { Logger.Warn("Firewall", $"netsh failed: {args} — {ex.Message}"); }
    }
}
