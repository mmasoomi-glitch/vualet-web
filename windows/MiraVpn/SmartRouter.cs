using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace MiraVpn;

/// <summary>
/// On Connect, pings 3 Mira server candidates. Picks the fastest.
/// This IS the "AI-assisted server selection" — no LLM, just real RTT.
/// The winning server's endpoint is what NativeTunnel uses.
/// </summary>
public static class SmartRouter
{
    private static readonly (string name, string endpoint)[] _candidates =
    [
        ("Nuremberg",    "178.104.251.30:51820"),  // primary (Hetzner nbg1)
        ("Falkenstein",  "116.203.0.0:51820"),     // placeholder — add real node2 when provisioned
        ("Ashburn",      "23.94.0.0:51820"),       // placeholder — add real node3 when provisioned
    ];

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    /// <summary>
    /// Probe each candidate, return the one with lowest RTT.
    /// Uses TCP connect to the WireGuard port as the probe (ICMP is
    /// frequently blocked; TCP SYN to :51820 is not).
    /// </summary>
    public static async Task<(string name, string endpoint, int rttMs)> PickBestAsync()
    {
        var tasks = _candidates.Select(async c =>
        {
            var sw = Stopwatch.StartNew();
            try
            {
                var host = c.endpoint.Split(':')[0];
                using var tcp = new TcpClient();
                await tcp.ConnectAsync(host, 51820).WaitAsync(TimeSpan.FromSeconds(3));
                sw.Stop();
                return (c.name, c.endpoint, rttMs: (int)sw.ElapsedMilliseconds);
            }
            catch
            {
                sw.Stop();
                return (c.name, c.endpoint, rttMs: int.MaxValue);
            }
        });

        var results = await Task.WhenAll(tasks);
        var best = results.OrderBy(r => r.rttMs).First();
        return best;
    }
}
