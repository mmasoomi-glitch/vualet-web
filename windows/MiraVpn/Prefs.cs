using System.IO;
using System.Text.Json;

namespace MiraVpn;

public class Prefs
{
    public string InstallPath { get; set; } = "";
    public bool AutoStart { get; set; } = true;
    public bool AutoConnect { get; set; } = false;
    public bool Notifications { get; set; } = true;
    public string Email { get; set; } = "";
    public bool FirstRunComplete { get; set; }

    private static readonly string PrefsPath = Path.Combine(App.AppDataDir, "prefs.json");

    public static Prefs Load()
    {
        try { if (File.Exists(PrefsPath)) return JsonSerializer.Deserialize<Prefs>(File.ReadAllText(PrefsPath)) ?? new Prefs(); }
        catch { }
        return new Prefs { InstallPath = App.AppDataDir };
    }

    public void Save()
    {
        var dir = Path.GetDirectoryName(PrefsPath);
        if (dir != null) Directory.CreateDirectory(dir);
        File.WriteAllText(PrefsPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
