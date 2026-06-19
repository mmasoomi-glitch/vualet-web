using System.Diagnostics;
using System.Net.Http;

namespace MiraVpn;

public class SmartRouter
{
    private static readonly (string Name, string ApiBase, string WgEndpoint)[] _pool =
    [
        ("Nuremberg", AppConfig.PROBE_BASE, AppConfig.WG_ENDPOINT),
    ];

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(AppConfig.PROBE_TIMEOUT_SEC) };
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
