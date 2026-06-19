using System.IO;

namespace MiraVpn;

public static class Logger
{
    private static readonly object _lock = new();
    private static string _logDir = "";
    private static string _logFile = "";

    public static void Initialize()
    {
        _logDir = Path.Combine(App.AppDataDir, "logs");
        Directory.CreateDirectory(_logDir);
        _logFile = Path.Combine(_logDir, $"mira-{DateTime.Now:yyyy-MM-dd}.log");
    }

    public static void Info(string source, string message) { Write("INFO", source, message); }
    public static void Warn(string source, string message) { Write("WARN", source, message); }
    public static void Error(string source, string message) { Write("ERROR", source, message); }

    private static void Write(string level, string source, string message)
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss.fff");
        var line = $"[{timestamp}] [{level}] [{source}] {message}";
        try { lock (_lock) { File.AppendAllText(_logFile, line + Environment.NewLine); } } catch { }
        System.Diagnostics.Debug.WriteLine(line);
    }
}
