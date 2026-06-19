using System.Diagnostics;
using System.Net.Http;

namespace MiraVpn;

/// <summary>
/// Measures RTT to Mira servers by sending a quick HTTP GET to the API.
/// HTTP always works (port 80, nginx) — no ISP UDP blocking issues.
/// Returns the fastest endpoint for WireGuard connection.
/// </summary>
public static class SmartRouter
{
    private static readonly (string name, string apiBase, string wgEndpoint)[] _pool =
    [
        ("Nuremberg", "http://178.104.251.30/v1/stats", "178.104.251.30:51820"),
    ];

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    /// <summary>
    /// Probes each server via HTTP GET and returns the fastest.
    /// If the probe fails (rttMs == MaxValue), returns null.
    /// </summary>
    public static async Task<(string name, string endpoint, int rttMs)?> PickBestAsync()
    {
        (string name, string endpoint, int rttMs)? best = null;

        foreach (var s in _pool)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                var resp = await _http.GetAsync(s.apiBase);
                sw.Stop();
                if (resp.IsSuccessStatusCode)
                {
                    var rtt = (int)sw.ElapsedMilliseconds;
                    if (best == null || rtt < best.Value.rttMs)
                        best = (s.name, s.wgEndpoint, rtt);
                }
            }
            catch
            {
                // server unreachable — skip
            }
        }

        return best;
    }
}
