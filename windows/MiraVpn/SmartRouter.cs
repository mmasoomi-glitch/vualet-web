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
    private static readonly (string name, string endpoint, int port)[] _pool =
    [
        ("Nuremberg",   "178.104.251.30", 51820),
        ("Falkenstein", "116.203.0.0",    51820),  // placeholder until node2 provisioned
        ("Singapore",   "159.223.0.0",    51820),  // placeholder until node3 provisioned
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
                await tcp.ConnectAsync(s.name, s.port, cts.Token);
                sw.Stop();
                return (s.name, s.endpoint, rttMs: (int)sw.ElapsedMilliseconds);
            }
            catch
            {
                return (s.name, s.endpoint, rttMs: int.MaxValue);
            }
        });
        var results = await Task.WhenAll(tasks);
        return results.OrderBy(r => r.rttMs).First();
    }
}
