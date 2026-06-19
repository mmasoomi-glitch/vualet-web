# Mira VPN for Windows — one-click installer
# Prerequisite: WireGuard must be installed (the script checks + installs via winget)
# Run as Administrator (required for tunnel service registration)

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$API = "http://178.104.251.30:5103"
$WG_PATH = "C:\Program Files\WireGuard\wireguard.exe"
$CONF_NAME = "MiraVPN"
$CONF_PATH = "C:\Program Files\WireGuard\Configurations\$CONF_NAME.conf.dpapi"
$SHORTCUT = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Mira VPN.lnk"
$DESKTOP = "$env:USERPROFILE\Desktop\Mira VPN.lnk"

function Require-Admin {
    if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        exit
    }
}

function Ensure-WireGuard {
    if (Test-Path $WG_PATH) {
        Write-Host "[✓] WireGuard found" -ForegroundColor Green
        return
    }
    Write-Host "[...] Installing WireGuard..." -ForegroundColor Yellow
    $msi = "$env:TEMP\wireguard-installer.msi"
    Invoke-WebRequest "https://download.wireguard.com/windows-client/wireguard-installer.exe" -OutFile $msi
    Start-Process -Wait -FilePath msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart"
    Remove-Item $msi
    if (-not (Test-Path $WG_PATH)) {
        Write-Host "[!] WireGuard install failed. Install manually: https://www.wireguard.com/install/" -ForegroundColor Red
        exit 1
    }
    Write-Host "[✓] WireGuard installed" -ForegroundColor Green
}

function Connect-Mira {
    Write-Host "[...] Generating keys..." -ForegroundColor Yellow
    $priv = & $WG_PATH genkey 2>$null
    $pub  = & $WG_PATH pubkey 2>$null
    if (-not $priv -or -not $pub) {
        Write-Host "[!] WireGuard keygen failed. Is WireGuard installed at $WG_PATH ?" -ForegroundColor Red
        exit 1
    }

    Write-Host "[...] Registering with Mira server at $API..." -ForegroundColor Yellow
    $body = @{public_key=$pub; tier="free"} | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$API/v1/tunnel/issue" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
    Write-Host "[✓] Server assigned IP: $($resp.ip)" -ForegroundColor Green

    $config = $resp.config -replace "FILL_ME", $priv
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $config)

    Write-Host "[...] Importing tunnel configuration..." -ForegroundColor Yellow
    $p = Start-Process -FilePath $WG_PATH -ArgumentList "/installtunnelservice `"$tmp`"" -PassThru -Wait -WindowStyle Hidden
    Remove-Item $tmp
    if ($p.ExitCode -ne 0) {
        Write-Host "[!] Tunnel install failed (exit $($p.ExitCode)). Run as Administrator." -ForegroundColor Red
        exit 1
    }
    Write-Host "[✓] Tunnel imported as '$CONF_NAME'" -ForegroundColor Green

    # Create shortcuts
    $ws = New-Object -ComObject WScript.Shell
    foreach ($path in @($SHORTCUT, $DESKTOP)) {
        $lnk = $ws.CreateShortcut($path)
        $lnk.TargetPath = $WG_PATH
        $lnk.Arguments = "/activate `"$CONF_NAME`""
        $lnk.WorkingDirectory = "C:\Program Files\WireGuard"
        $lnk.IconLocation = "C:\Program Files\WireGuard\wireguard.exe,0"
        $lnk.Description = "Mira VPN — tap to connect"
        $lnk.Save()
    }
    Write-Host "[✓] Shortcuts created (Start Menu + Desktop)" -ForegroundColor Green
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "  Mira VPN is ready." -ForegroundColor Cyan
    Write-Host "  Double-click 'Mira VPN' on your desktop or" -ForegroundColor Cyan
    Write-Host "  Start Menu to connect." -ForegroundColor Cyan
    Write-Host "  Or open the WireGuard tray icon and click Activate." -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
}

function Disconnect-Mira {
    $p = Start-Process -FilePath $WG_PATH -ArgumentList "/uninstalltunnelservice `"$CONF_NAME`"" -PassThru -Wait -WindowStyle Hidden
    if ($p.ExitCode -ne 0) {
        Write-Host "[!] Could not deactivate (exit $($p.ExitCode))" -ForegroundColor Red
    } else {
        Write-Host "[✓] Tunnel removed" -ForegroundColor Green
    }
    Remove-Item $SHORTCUT, $DESKTOP -Force -ErrorAction SilentlyContinue
    Write-Host "[✓] Shortcuts removed" -ForegroundColor Green
}

Require-Admin
if ($Uninstall) { Disconnect-Mira; exit 0 }
Ensure-WireGuard
Connect-Mira
