# Run once on your dev machine to fetch wintun.dll + wireguard.exe.
# Both are MIT-licensed, freely embeddable, no attribution needed in the binary.
# After running this, MiraVpn.exe self-contains them — zero user downloads.
#
# wintun.dll: MIT license — https://www.wintun.net/
# wireguard.exe: MIT license — https://download.wireguard.com/windows-client/

$ErrorActionPreference = "Stop"
$res = "$PSScriptRoot\MiraVpn\Resources"
New-Item -ItemType Directory -Force $res | Out-Null

# 1. wintun.dll (the TUN kernel driver — 300 KB)
Write-Host "[1/2] Fetching wintun.dll..."
$wintunZip = "$env:TEMP\wintun.zip"
Invoke-WebRequest "https://www.wintun.net/builds/wintun-0.14.1.zip" -OutFile $wintunZip
Expand-Archive $wintunZip -DestinationPath "$env:TEMP\wintun-extract" -Force
Copy-Item "$env:TEMP\wintun-extract\wintun\bin\amd64\wintun.dll" "$res\wintun.dll" -Force
Remove-Item $wintunZip, "$env:TEMP\wintun-extract" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  wintun.dll: $((Get-Item "$res\wintun.dll").Length) bytes"

# 2. wireguard.exe (the tunnel binary — 1.5 MB, wraps the protocol)
Write-Host "[2/2] Fetching wireguard.exe..."
$wgUrl = "https://download.wireguard.com/windows-client/wireguard-amd64-0.5.3.msi"
$wgMsi = "$env:TEMP\wg.msi"
Invoke-WebRequest $wgUrl -OutFile $wgMsi
# Extract wireguard.exe from the MSI (it's a standard Microsoft installer)
Start-Process msiexec.exe -ArgumentList "/a `"$wgMsi`" /quiet TARGETDIR=`"$env:TEMP\wg-extract`"" -Wait
$found = Get-ChildItem "$env:TEMP\wg-extract" -Recurse -Filter "wireguard.exe" | Select-Object -First 1
if ($found) {
    Copy-Item $found.FullName "$res\wireguard.exe" -Force
    Write-Host "  wireguard.exe: $((Get-Item "$res\wireguard.exe").Length) bytes"
} else {
    Write-Host "  [!] Could not extract wireguard.exe from the MSI."
    Write-Host "  Download the MSI manually from https://www.wireguard.com/install/"
    Write-Host "  and extract wireguard.exe to $res"
}
Remove-Item $wgMsi, "$env:TEMP\wg-extract" -Recurse -Force -ErrorAction SilentlyContinue

# 3. Generate tray icon from the Mira logo
Write-Host "[3/3] Generating tray icon..."
Add-Type -AssemblyName System.Drawing
$logo = "$PSScriptRoot\..\public\mira\mira-logo-color-256.png"
if (Test-Path $logo) {
    $bmp = [System.Drawing.Image]::FromFile($logo)
    $icon = [System.Drawing.Icon]::FromHandle((New-Object System.Drawing.Bitmap($bmp, 32, 32)).GetHicon())
    $fs = [System.IO.File]::Create("$res\mira-tray.ico")
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose(); $bmp.Dispose()
    Write-Host "  mira-tray.ico: $((Get-Item "$res\mira-tray.ico").Length) bytes"
} else {
    Write-Host "  [!] Logo not found at $logo — using fallback.ico"
    Copy-Item "$res\..\..\public\favicon.svg" "$res\mira-tray.ico" -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. Resources ready at $res"
Write-Host "Now run:  dotnet publish -c Release -o publish"
