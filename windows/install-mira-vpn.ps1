# Mira VPN for Windows -- one-click installer
# Run as Administrator (required for tunnel service registration)

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$API = "http://178.104.251.30/v1"
$WG_PATH = "C:\Program Files\WireGuard\wireguard.exe"
$CONF_NAME = "MiraVPN"
$SHORTCUT = [Environment]::GetFolderPath("StartMenu") + "\Programs\Mira VPN.lnk"
$DESKTOP = [Environment]::GetFolderPath("Desktop") + "\Mira VPN.lnk"

function Require-Admin {
    if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        exit
    }
}

function Ensure-WireGuard {
    if (Test-Path $WG_PATH) {
        Write-Host "[OK] WireGuard found" -ForegroundColor Green
        return
    }
    Write-Host "[...] Installing WireGuard..." -ForegroundColor Yellow
    $msi = "$env:TEMP\wireguard-installer.msi"
    Invoke-WebRequest "https://download.wireguard.com/windows-client/wireguard-installer.exe" -OutFile $msi
    Start-Process -Wait -FilePath msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart"
    Remove-Item $msi
    if (Test-Path $WG_PATH) {
        Write-Host "[OK] WireGuard installed" -ForegroundColor Green
        return
    }
    Write-Host "[FAIL] WireGuard install failed. Install manually: https://www.wireguard.com/install/" -ForegroundColor Red
    exit 1
}

function Connect-Mira {
    Write-Host "[...] Generating keys..." -ForegroundColor Yellow
    $priv = & $WG_PATH genkey 2>$null
    $pub  = & $WG_PATH pubkey 2>$null
    if (-not $priv -or -not $pub) {
        Write-Host "[FAIL] Keygen failed. Is WireGuard at $WG_PATH?" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Keys generated" -ForegroundColor Green

    Write-Host "[...] Registering with Mira server..." -ForegroundColor Yellow
    $body = @{public_key=$pub; tier="free"} | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$API/tunnel/issue" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
    if (-not $resp.ip) {
        Write-Host "[FAIL] Server rejected registration: $($resp.error)" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Server assigned IP: $($resp.ip)" -ForegroundColor Green

    $config = $resp.config -replace "FILL_ME", $priv
    $tmp = [System.IO.Path]::GetTempFileName() + ".conf"
    [System.IO.File]::WriteAllText($tmp, $config)

    Write-Host "[...] Importing tunnel config..." -ForegroundColor Yellow
    $p = Start-Process -FilePath $WG_PATH -ArgumentList "/installtunnelservice `"$tmp`"" -PassThru -Wait -WindowStyle Hidden
    Remove-Item $tmp
    if ($p.ExitCode -ne 0) {
        Write-Host "[FAIL] Tunnel install failed (exit $($p.ExitCode)). Must run as Administrator." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Tunnel imported" -ForegroundColor Green

    # Create shortcuts
    $ws = New-Object -ComObject WScript.Shell
    foreach ($path in @($SHORTCUT, $DESKTOP)) {
        $lnk = $ws.CreateShortcut($path)
        $lnk.TargetPath = $WG_PATH
        $lnk.Arguments = "/activate `"$CONF_NAME`""
        $lnk.WorkingDirectory = "C:\Program Files\WireGuard"
        $lnk.IconLocation = "C:\Program Files\WireGuard\wireguard.exe,0"
        $lnk.Description = "Mira VPN -- tap to connect"
        $lnk.Save()
    }
    Write-Host "[OK] Shortcuts created (Start Menu + Desktop)" -ForegroundColor Green
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "  Mira VPN is ready." -ForegroundColor Cyan
    Write-Host "  Double-click 'Mira VPN' on your Desktop or" -ForegroundColor Cyan
    Write-Host "  Start Menu to connect." -ForegroundColor Cyan
    Write-Host "  Or open WireGuard tray icon and click Activate." -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
}

function Disconnect-Mira {
    $p = Start-Process -FilePath $WG_PATH -ArgumentList "/uninstalltunnelservice `"$CONF_NAME`"" -PassThru -Wait -WindowStyle Hidden
    if ($p.ExitCode -eq 0) {
        Write-Host "[OK] Tunnel removed" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Could not deactivate" -ForegroundColor Yellow
    }
    Remove-Item $SHORTCUT, $DESKTOP -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Shortcuts removed" -ForegroundColor Green
}

Require-Admin
if ($Uninstall) { Disconnect-Mira; exit 0 }
Ensure-WireGuard
Connect-Mira
