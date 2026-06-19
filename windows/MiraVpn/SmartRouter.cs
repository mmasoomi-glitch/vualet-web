using System.Diagnostics;
using System.Linq;
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
        var tasks = _pool.Select(async s =>
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
                    return new ServerProbe { IP = s.WgEndpoint.Split(':')[0], WgEndpointFull = s.WgEndpoint, Name = s.Name, RttMs = sw.ElapsedMilliseconds };
                }
            }
            catch { OnProbeResult?.Invoke($"  {s.Name}: unreachable"); }
            return null;
        });

        var results = await Task.WhenAll(tasks);
        return results.Where(r => r is not null).MinBy(r => r!.RttMs);
    }
}
