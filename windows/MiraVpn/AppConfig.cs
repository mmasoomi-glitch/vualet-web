namespace MiraVpn;

public static class AppConfig
{
    public const string API_BASE = "http://178.104.251.30/v1/";
    public const string PROBE_BASE = "http://178.104.251.30/";
    public const string WG_PORT = "51820";
    public const string WG_ENDPOINT = "178.104.251.30:51820";
    public const int PROBE_TIMEOUT_SEC = 2;
    public const int STATUS_INTERVAL_MS = 3000;
}
