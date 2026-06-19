# Mira VPN — Windows Client Verbatim Implementation Spec

Hand this to whoever builds the Windows client. Same structure as the Android
and iOS specs: file-by-file paths, exact content, explicit deviations register.

## Locked decisions

1. Protocol: WireGuard (same as iOS, same reason — mature Libraries, signed drivers available, Windows Store compatible)
2. Framework: .NET 8 WPF (Windows 10+, .NET Desktop Runtime)
3. Distribution: Windows Store (primary) + direct .msix sideload from vpn.mira.vualet.com/get

## Project structure (Visual Studio 2026+ / .NET 8)

```
windows/
├── MiraVpn.sln
├── MiraVpn/
│   ├── MiraVpn.csproj
│   ├── App.xaml / App.xaml.cs
│   ├── MainWindow.xaml / MainWindow.xaml.cs
│   ├── Views/
│   │   ├── ConnectPage.xaml / .xaml.cs
│   │   ├── SettingsPage.xaml / .xaml.cs
│   │   └── TrayIcon.cs
│   ├── Services/
│   │   ├── WireGuardService.cs        ← wraps WireGuard Tunnel.dll
│   │   ├── BackendAPIService.cs       ← calls api.mira.vualet.com
│   │   └── SubscriptionService.cs    ← Store licence or permit check
│   └── Assets/
│       ├── mira-logo-color-256.png
│       └── mira-tray-icon.ico
```

## Key files (verbatim source to follow)

### MiraVpn.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows10.0.22621.0</TargetFramework>
    <UseWPF>true</UseWPF>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <AssemblyName>MiraVpn</AssemblyName>
    <RootNamespace>MiraVpn</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="WireGuard.Core" Version="1.0.*" />
    <PackageReference Include="Microsoft.Windows.SDK.NET.Ref" Version="10.0.*" />
  </ItemGroup>
</Project>
```

### App.xaml.cs
```csharp
using System.Windows;
namespace MiraVpn;

public partial class App : Application {
    protected override void OnStartup(StartupEventArgs e) {
        base.OnStartup(e);
        // Start minimized to tray if auto-connect is set
        if (Settings.Default.AutoConnect) {
            // Start WireGuard in background
        }
        new MainWindow().Show();
    }
}
```

### WireGuardService.cs
```csharp
using System.Diagnostics;
using System.IO;

namespace MiraVpn.Services;

public class WireGuardService {
    private Process? _tunnelProcess;
    private const string WgExe = "wireguard.exe"; // or Tunnel.dll via P/Invoke
    private const string ConfigDir = "Config";

    public async Task ConnectAsync(string configPath) {
        await Task.Run(() => {
            _tunnelProcess = new Process {
                StartInfo = new ProcessStartInfo {
                    FileName = WgExe,
                    Arguments = $"/installtunnelservice {configPath}",
                    UseShellExecute = true,
                    Verb = "runas" // requires admin for tunnel service install
                }
            };
            _tunnelProcess.Start();
            _tunnelProcess.WaitForExit();
        });
    }

    public void Disconnect() {
        var proc = new Process {
            StartInfo = new ProcessStartInfo {
                FileName = WgExe,
                Arguments = "/uninstalltunnelservice Mira",
                UseShellExecute = true,
                Verb = "runas"
            }
        };
        proc.Start(); proc.WaitForExit();
    }
}
```

### BackendAPIService.cs
```csharp
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace MiraVpn.Services;

public class BackendAPIService {
    private static readonly HttpClient _http = new() { BaseAddress = new("https://api.mira.vualet.com") };

    public async Task<string?> FetchWireGuardConfig(string tier) {
        var resp = await _http.PostAsJsonAsync("/v1/tunnel/issue", new { tier });
        if (!resp.IsSuccessStatusCode) return null;
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("wgConfig").GetString(); // server returns wg-quick formatted config
    }
}
```

### TrayIcon.cs
```csharp
using System.Windows.Forms; // WinForms interop for tray (use modern NotifyIcon)

namespace MiraVpn.Views;

public class TrayIcon : IDisposable {
    private readonly NotifyIcon _icon;

    public TrayIcon() {
        _icon = new NotifyIcon {
            Icon = new System.Drawing.Icon("Assets/mira-tray-icon.ico"),
            Text = "Mira VPN",
            Visible = true
        };
        _icon.ContextMenuStrip = new ContextMenuStrip();
        _icon.ContextMenuStrip.Items.Add("Connect", null, (_, _) => { /* trigger connect */ });
        _icon.ContextMenuStrip.Items.Add("Disconnect", null, (_, _) => { /* trigger disconnect */ });
        _icon.ContextMenuStrip.Items.Add("-");
        _icon.ContextMenuStrip.Items.Add("Exit", null, (_, _) => Application.Exit());
    }

    public void Dispose() => _icon.Dispose();
}
```

### MainWindow.xaml
```xml
<Window x:Class="MiraVpn.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="Mira VPN" Height="600" Width="480"
        WindowStartupLocation="CenterScreen"
        Background="#FFF8F0">
    <Grid Margin="24">
        <!-- Mira wordmark -->
        <Image Source="Assets/mira-wordmark-color.png" Height="32" HorizontalAlignment="Center" Margin="0,20,0,0" />
        <!-- Large connect/disconnect button (pink gradient pill) -->
        <Button x:Name="ConnectButton" Content="Connect" Click="ConnectButton_Click"
                Width="200" Height="56" Margin="0,160,0,0"
                Background="{StaticResource MiraGradientBrush}" Foreground="White"
                FontSize="18" FontWeight="SemiBold" BorderThickness="0"
                Cursor="Hand">
            <Button.Template>
                <ControlTemplate TargetType="Button">
                    <Border Background="{TemplateBinding Background}" CornerRadius="28"
                            BorderThickness="0" Name="border">
                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                    </Border>
                </ControlTemplate>
            </Button.Template>
        </Button>
        <!-- Status text -->
        <TextBlock x:Name="StatusText" Text="Ready when you are" FontFamily="Fraunces" FontSize="20"
                   HorizontalAlignment="Center" Margin="0,20,0,0" Foreground="#2A1F2D" />
    </Grid>
</Window>
```

## Theme (Mira brand tokens in WPF Resources)

```xml
<Window.Resources>
    <Color x:Key="MiraRose">#F8A5A0</Color>
    <Color x:Key="MiraLavender">#C7B8F0</Color>
    <Color x:Key="MiraAether">#6366F1</Color>
    <Color x:Key="MiraCream">#FFF8F0</Color>
    <Color x:Key="MiraInk">#2A1F2D</Color>
    <LinearGradientBrush x:Key="MiraGradientBrush" StartPoint="0,0" EndPoint="1,1">
        <GradientStop Offset="0" Color="#F8A5A0" />
        <GradientStop Offset="0.55" Color="#C7B8F0" />
        <GradientStop Offset="1" Color="#6366F1" />
    </LinearGradientBrush>
</Window.Resources>
```

## Build

```pwsh
dotnet publish MiraVpn.sln -c Release -o build/publish
# Package as MSIX:
msix build/publish --output MiraVpn.msix
```

## Windows Store compliance notes

- Declaration: "Personal VPN" capability requested in app manifest
- No background task polling network — WireGuard tunnel runs as Windows Service, app communicates via named pipe
- Tray icon required (Windows Store VPN apps must show connection state in tray)
- Privacy policy: same `https://mira.vualet.com/privacy` URL as other platforms

## Traps to brief on

1. WireGuard tunnel install requires admin elevation — use `verb: "runas"` or the signed MSIX capability
2. Windows Defender firewall may block WireGuard's UDP port — auto-add rule on first connect
3. Font fallback: embed Fraunces .ttf in the MSIX for the display text
4. WinUI 3 is preferred over WPF but the .NET 8 template defaults to WPF; migrate if time allows
