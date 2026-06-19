namespace MiraVpn;

public static class AppConfig
{
    public const string API_BASE = "http://178.104.251.30/v1/";
    public const string PROBE_BASE = "http://178.104.251.30/";
    public const string WG_PORT = "51820";
    public const string WG_ENDPOINT = "178.104.251.30:51820";
    public const int PROBE_TIMEOUT_SEC = 2;
    public const int STATUS_INTERVAL_MS = 3000;
    public const string DNS_PRIMARY = "10.66.66.1";
    public const string DNS_SECONDARY = "1.1.1.1";
    public const string WG_ADAPTER_NAME = "MiraVPN";
    public const int STALE_HANDSHAKE_SEC = 180;
    public const int RECONNECT_BASE_DELAY_MS = 2000;
    public const int RECONNECT_MAX_DELAY_MS = 60000;
    public const int RECONNECT_MAX_ATTEMPTS = 10;
    public const int NETWORK_RECONNECT_DELAY_MS = 1500;
}
