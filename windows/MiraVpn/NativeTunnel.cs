using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Principal;
using System.Text.Json;

namespace MiraVpn;

/// <summary>
/// Manages the in-house TUN tunnel. Uses wintun.dll (MIT kernel TUN driver)
/// and wireguard.exe (MIT protocol binary), both bundled as embedded resources
/// and extracted to the app directory on first setup.
///
/// No WireGuard branding is ever shown to the user. No external downloads.
/// </summary>
public static class NativeTunnel
{
    private static readonly string _home = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mira VPN");
    private static readonly string _wg = Path.Combine(_home, "wireguard.exe");
    private const string TunnelName = "MiraVPN";
    private static readonly HttpClient _api = new() { BaseAddress = new("http://178.104.251.30/v1/") };

    public static bool IsConnected { get; private set; }
    public static string? CurrentEndpoint { get; private set; }

    public static async Task<string> Connect(string endpoint)
    {
        CurrentEndpoint = endpoint;

        // Keygen
        var priv = Run("genkey").Trim();
        var pub = Run("pubkey", priv).Trim();
        if (string.IsNullOrEmpty(priv) || string.IsNullOrEmpty(pub))
            throw new Exception("Key generation failed. Is the network engine installed?");

        // Register with API
        var resp = await _api.PostAsJsonAsync("tunnel/issue-direct",
            new { public_key = pub, tier = "free" });
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Server rejected registration ({resp.StatusCode})");

        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var ip = json.GetProperty("ip").GetString()!;
        var configRaw = json.GetProperty("config").GetString()!;
        var config = configRaw.Replace("FILL_ME", priv)
                              .Replace("178.104.251.30:51820", endpoint);

        // Write config and install tunnel service (needs elevation once)
        var tmp = Path.GetTempFileName() + ".conf";
        File.WriteAllText(tmp, config);

        if (!IsAdmin())
        {
            var elevated = RunElevated($"/installtunnelservice \"{tmp}\"");
            if (elevated != 0)
                throw new Exception($"Driver registration failed (exit {elevated}). Administrator access is required for the first connection.");
        }
        else
        {
            Run($"/installtunnelservice \"{tmp}\"");
        }
        File.Delete(tmp);

        // Activate
        Run($"/activate \"{TunnelName}\"");

        IsConnected = true;
        return ip;
    }

    public static void Disconnect()
    {
        try { Run($"/uninstalltunnelservice \"{TunnelName}\""); } catch { }
        IsConnected = false;
        CurrentEndpoint = null;
    }

    private static string Run(string args, string? stdin = null)
    {
        if (!File.Exists(_wg))
            throw new Exception($"Network engine not found at {_wg}. Please reinstall Mira VPN.");
        var psi = new ProcessStartInfo(_wg, args)
        {
            RedirectStandardOutput = true,
            RedirectStandardInput = stdin != null,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi) ?? throw new Exception($"Cannot start {_wg}");
        if (stdin != null) { p.StandardInput.Write(stdin); p.StandardInput.Close(); }
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(10000);
        if (p.ExitCode != 0 && !args.Contains("genkey") && !args.Contains("pubkey"))
            throw new Exception($"Command failed (exit {p.ExitCode}): {output}");
        return output;
    }

    private static int RunElevated(string args)
    {
        var psi = new ProcessStartInfo(_wg, args)
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi) ?? throw new Exception("Cannot start elevated process");
        p.WaitForExit(120000);
        return p.ExitCode;
    }

    private static bool IsAdmin() =>
        new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
}
