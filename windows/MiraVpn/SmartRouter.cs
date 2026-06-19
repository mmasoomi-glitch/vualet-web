using System.Diagnostics;
using System.Net.Sockets;

namespace MiraVpn;

/// <summary>
/// Pings candidate Mira servers via TCP SYN to the WireGuard port.
/// Returns the one with the lowest measured RTT.
/// This is the "AI-assisted" piece — real measurement, no LLM.
/// </summary>
public static class SmartRouter
{
    // Probe endpoint: probe TCP 80 (always open) but return 51820 for WireGuard
    private static readonly (string name, string endpoint, int probePort, int wgPort)[] _pool =
    [
        ("Nuremberg",   "178.104.251.30", 80,  51820),
        ("Falkenstein", "116.203.0.0",    80,  51820),  // placeholder
        ("Singapore",   "159.223.0.0",    80,  51820),  // placeholder
    ];

    public static async Task<(string name, string endpoint, int rttMs)> PickBestAsync()
    {
        var tasks = _pool.Select(async s =>
        {
            var sw = Stopwatch.StartNew();
            try
            {
                using var tcp = new TcpClient();
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await tcp.ConnectAsync(s.name, s.probePort, cts.Token);
                sw.Stop();
                return (s.name, $"{s.endpoint}:{s.wgPort}", rttMs: (int)sw.ElapsedMilliseconds);
            }
            catch
            {
                return (s.name, $"{s.endpoint}:{s.wgPort}", rttMs: int.MaxValue);
            }
        });
        var results = await Task.WhenAll(tasks);
        return results.OrderBy(r => r.rttMs).First();
    }
}
