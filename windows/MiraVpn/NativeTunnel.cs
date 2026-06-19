using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Principal;
using System.Text.Json;

namespace MiraVpn;

/// <summary>
/// In-house TUN driver manager. Bundles wintun.dll (MIT-licensed kernel TUN
/// driver, same one NordVPN/Psiphon use) and wireguard.exe as embedded
/// resources. Extracts both to AppData on first run — zero external
/// downloads, zero user-visible "WireGuard" branding. The user sees only
/// "Mira VPN — Connected."
/// </summary>
public static class NativeTunnel
{
    private static readonly string _home = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Mira VPN");

    private static readonly string _tunDriver = Path.Combine(_home, "wintun.dll");
    private static readonly string _tunnelBinary = Path.Combine(_home, "wireguard.exe");
    private const string TunnelName = "MiraVPN";

    private static readonly HttpClient _api = new() { BaseAddress = new("http://178.104.251.30/v1/") };

    /// <summary>True after a successful Connect, false after Disconnect.</summary>
    public static bool IsConnected { get; private set; }

    /// <summary>The assigned WireGuard IP after connect, e.g. "10.66.66.2".</summary>
    public static string? AssignedIP { get; private set; }

    /// <summary>Selected server endpoint from the SmartRouter.</summary>
    public static string? Endpoint { get; private set; }

    // --- Bootstrap ---

    /// <summary>
    /// Extract the embedded TUN driver and tunnel binary on first launch.
    /// Returns true if both are ready (either already existed or freshly extracted).
    /// </summary>
    public static bool Bootstrap()
    {
        try
        {
            Directory.CreateDirectory(_home);
            ExtractResource("MiraVpn.Resources.wintun.dll", _tunDriver);
            ExtractResource("MiraVpn.Resources.wireguard.exe", _tunnelBinary);
            return File.Exists(_tunDriver) && File.Exists(_tunnelBinary);
        }
        catch
        {
            return false;
        }
    }

    private static void ExtractResource(string name, string dest)
    {
        if (File.Exists(dest)) return;
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream == null) throw new FileNotFoundException($"Embedded resource '{name}' not found. Ensure wintun.dll and wireguard.exe are in Resources/ and marked EmbeddedResource in the csproj.");
        using var fs = File.Create(dest);
        stream.CopyTo(fs);
    }

    // --- Connect ---

    /// <summary>
    /// Full connect flow: SmartRouter → keygen → API registration →
    /// install tunnel service → activate. First time needs UAC (kernel
    /// driver registration). Subsequent times are instant.
    /// </summary>
    public static async Task<string> Connect(string tier = "free")
    {
        var wg = _tunnelBinary;

        // 1. Smart router: pick the fastest server
        var best = await SmartRouter.PickBestAsync();
        Endpoint = best.endpoint;

        // 2. Generate keypair
        var priv = Run(wg, "genkey").Trim();
        var pub = Run(wg, "pubkey", priv).Trim();

        // 3. Register with Mira API
        var resp = await _api.PostAsJsonAsync("tunnel/issue",
            new { public_key = pub, tier, endpoint = best.endpoint });
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Server rejected registration: {resp.StatusCode}");

        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var ip = json.GetProperty("ip").GetString()!;
        var configRaw = json.GetProperty("config").GetString()!;
        var config = configRaw.Replace("FILL_ME", priv)
                              .Replace("178.104.251.30:51820", best.endpoint);

        // 4. Write config + install tunnel (needs UAC once)
        var tmp = Path.GetTempFileName() + ".conf";
        File.WriteAllText(tmp, config);

        bool needsElevation = !IsAdmin();
        if (needsElevation)
        {
            // Re-run ourselves elevated for the install step
            var elevated = RunElevated("/installtunnelservice", tmp);
            if (elevated != 0)
                throw new Exception($"Tunnel service install failed (exit {elevated}). Must be Administrator.");
        }
        else
        {
            Run(wg, $"/installtunnelservice \"{tmp}\"");
        }
        File.Delete(tmp);

        // 5. Activate (no elevation needed)
        Run(wg, $"/activate \"{TunnelName}\"");

        IsConnected = true;
        AssignedIP = ip;
        return ip;
    }

    // --- Disconnect ---

    public static void Disconnect()
    {
        try { Run(_tunnelBinary, $"/uninstalltunnelservice \"{TunnelName}\""); }
        catch { /* best-effort */ }
        IsConnected = false;
        AssignedIP = null;
        Endpoint = null;
    }

    // --- Helpers ---

    private static string Run(string exe, string args, string? stdin = null)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            RedirectStandardOutput = true,
            RedirectStandardInput = stdin != null,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi) ?? throw new Exception($"Cannot start {exe}");
        if (stdin != null) { p.StandardInput.Write(stdin); p.StandardInput.Close(); }
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(10000);
        if (p.ExitCode != 0 && !args.Contains("genkey") && !args.Contains("pubkey"))
            throw new Exception($"Command failed (exit {p.ExitCode}): {exe} {args}\n{output}");
        return output;
    }

    private static int RunElevated(string args, string configPath)
    {
        var psi = new ProcessStartInfo(_tunnelBinary, $"{args} \"{configPath}\"")
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi) ?? throw new Exception("Cannot start elevated process");
        p.WaitForExit(120000); // kernel driver install can take up to 2 minutes
        return p.ExitCode;
    }

    private static bool IsAdmin()
    {
        if (OperatingSystem.IsWindows())
        {
#pragma warning disable CA1416 // Windows-only guard
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
#pragma warning restore CA1416
        }
        return false;
    }
}
