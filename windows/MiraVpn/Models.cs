namespace MiraVpn;

public class IssueResponse { public string? Ip { get; set; } public string? ServerEndpoint { get; set; } public string? ServerPublicKey { get; set; } public string? Config { get; set; } }
public class TunnelStats { public bool connected { get; set; } public ulong rx_bytes { get; set; } public ulong tx_bytes { get; set; } public string? endpoint { get; set; } public long last_handshake_sec { get; set; } public long uptime_seconds { get; set; } }

public class ServerProbe
{
    public string IP { get; set; } = "";
    public string WgEndpointFull { get; set; } = "";
    public string Name { get; set; } = "";
    public long RttMs { get; set; }
}

public record LogEntry(string Timestamp, string Message, string ColorKey)
{
    public string DisplayText => $"{Timestamp}  {Message}";
}
