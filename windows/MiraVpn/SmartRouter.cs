using System.Diagnostics;
using System.Net.Http;

namespace MiraVpn;

public class SmartRouter
{
    private static readonly (string Name, string ApiBase, string WgEndpoint)[] _pool =
    [
        ("Nuremberg", "http://178.104.251.30/", "178.104.251.30:51820"),
    ];

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    public Action<string>? OnProbeResult;

    public async Task<ServerProbe?> FindFastestAsync()
    {
        ServerProbe? best = null;
        foreach (var s in _pool)
        {
            OnProbeResult?.Invoke($"Probing {s.Name} ({s.WgEndpoint})...");
            var sw = Stopwatch.StartNew();
            try
            {
                var resp = await _http.GetAsync(s.ApiBase);
                sw.Stop();
                if (resp.IsSuccessStatusCode)
                {
                    OnProbeResult?.Invoke($"  {s.Name} OK ({sw.ElapsedMilliseconds}ms)");
                    if (best == null || sw.ElapsedMilliseconds < best.RttMs)
                        best = new ServerProbe { IP = s.WgEndpoint.Split(':')[0], WgEndpointFull = s.WgEndpoint, Name = s.Name, RttMs = sw.ElapsedMilliseconds };
                }
            }
            catch { OnProbeResult?.Invoke($"  {s.Name}: unreachable"); }
        }
        return best;
    }
}

public class ServerProbe
{
    public string IP { get; set; } = "";
    public string WgEndpointFull { get; set; } = "";
    public string Name { get; set; } = "";
    public long RttMs { get; set; }
}
