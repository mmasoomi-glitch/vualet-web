using System.Diagnostics;

namespace MiraVpn;

public static class KillSwitch
{
    private const string RULE_BLOCK = "MiraVPN-KillSwitch-BlockAll";
    private const string RULE_VPN   = "MiraVPN-KillSwitch-AllowVpnEndpoint";
    private const string RULE_LAN   = "MiraVPN-KillSwitch-AllowLAN";

    /// <summary>Block all outbound traffic except VPN endpoint UDP 51820 and LAN subnets.</summary>
    public static void Enable(string vpnEndpointIp)
    {
        // BlockAll — only add if not already present (prevents brief leak on re-enable)
        if (!RuleExists(RULE_BLOCK))
            RunNetsh($"advfirewall firewall add rule name=\"{RULE_BLOCK}\" dir=out action=block enable=yes");

        // VPN endpoint allow — refresh in case IP changed (safe: BlockAll still active)
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_VPN}\"");
        RunNetsh($"advfirewall firewall add rule name=\"{RULE_VPN}\" dir=out action=allow remoteip={vpnEndpointIp}/32 remoteport=51820 protocol=UDP enable=yes");

        // LAN allow — only add if not present
        if (!RuleExists(RULE_LAN))
            RunNetsh($"advfirewall firewall add rule name=\"{RULE_LAN}\" dir=out action=allow remoteip=10.0.0.0/8,192.168.0.0/16,172.16.0.0/12 enable=yes");

        Logger.Info("KillSwitch", $"Enabled — VPN={vpnEndpointIp}:51820, LAN allowed, all other outbound blocked");
    }

    /// <summary>Remove all kill-switch firewall rules, restoring normal outbound traffic.</summary>
    public static void Disable()
    {
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_BLOCK}\"");
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_VPN}\"");
        RunNetsh($"advfirewall firewall delete rule name=\"{RULE_LAN}\"");
        Logger.Info("KillSwitch", "Disabled");
    }

    public static bool IsEnabled => RuleExists(RULE_BLOCK);

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
        catch (Exception ex) { Logger.Warn("KillSwitch", $"netsh failed: {args} — {ex.Message}"); }
    }
}
