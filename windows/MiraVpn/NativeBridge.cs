using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

namespace MiraVpn;

internal static class NativeBridge
{
    private static bool _init;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetDllDirectory(string lpPathName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    public static void Initialize(string dllDir)
    {
        if (_init) return;
        SetDllDirectory(dllDir);
        var dll = Path.Combine(dllDir, "mira-tunnel.dll");
        if (!File.Exists(dll)) throw new FileNotFoundException("mira-tunnel.dll not found. Run build script first.", dll);
        if (LoadLibrary(dll) == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Failed to load mira-tunnel.dll");
        _init = true;
    }

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int mira_start(string config);

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int mira_stop();

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr mira_stats();

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr mira_genkey();

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr mira_pubkey(string privKey);

    [DllImport("mira-tunnel.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern void mira_free(IntPtr ptr);
}
