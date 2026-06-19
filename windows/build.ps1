# build.ps1 — Mira VPN Windows client production build
# Prerequisites: Go 1.23+, MinGW-w64 (gcc), .NET 8 SDK, Git
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Write-Host "Mira VPN — Build" -ForegroundColor Magenta

# 1. Check tools
foreach ($t in @(@("go","https://go.dev/dl/"), @("gcc","https://www.mingw-w64.org/"), @("dotnet","https://dotnet.microsoft.com/download/dotnet/8.0"), @("git","https://git-scm.com/download/win"))) {
    try { & $t[0] version 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw } } catch {
        Write-Host "ERROR: $($t[0]) not found. Install: $($t[1])" -ForegroundColor Red; exit 1
    }
}

# 2. Download wintun.dll
$assets = "$root\MiraVpn\Assets"
New-Item -ItemType Directory -Force $assets | Out-Null
if (!(Test-Path "$assets\wintun.dll")) {
    Write-Host "Downloading wintun.dll..." -ForegroundColor Cyan
    $zip = "$env:TEMP\wintun.zip"
    Invoke-WebRequest "https://www.wintun.net/builds/wintun-0.14.1.zip" -OutFile $zip
    Expand-Archive $zip "$env:TEMP\wintun-extract" -Force
    Copy-Item "$env:TEMP\wintun-extract\wintun\bin\amd64\wintun.dll" "$assets\wintun.dll" -Force
    Remove-Item $zip, "$env:TEMP\wintun-extract" -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "wintun.dll ready" -ForegroundColor Green

# 3. Clone + sanitize wireguard-go
$wgDir = "$root\mira-tunnel\vendor\wireguard"
if (!(Test-Path $wgDir)) {
    Write-Host "Cloning wireguard-go..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force "$wgDir" | Out-Null
    & git clone --depth 1 "https://git.zx2c4.com/wireguard-go" $wgDir 2>&1 | Out-Null
    Get-ChildItem $wgDir -Recurse -Filter "*.go" | ForEach-Object {
        $c = Get-Content $_.FullName -Raw
        $c = $c -replace 'WireGuard', 'Mira-Tun!' -replace 'wireguard-go', 'mira-tun!'
        Set-Content $_.FullName $c -NoNewline
    }
}

# 4. Build mira-tunnel.dll
Write-Host "Building mira-tunnel.dll..." -ForegroundColor Cyan
Push-Location "$root\mira-tunnel"
$env:CGO_ENABLED = "1"; $env:GOOS = "windows"; $env:GOARCH = "amd64"; $env:CC = "gcc"
& go mod edit -replace "golang.zx2c4.com/wireguard=./vendor/wireguard" 2>&1 | Out-Null
& go mod tidy 2>&1 | Out-Null
& go build -buildmode=c-shared -ldflags="-s -w" -o "mira-tunnel.dll" . 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "Go build FAILED" -ForegroundColor Red; Pop-Location; exit 1 }
Copy-Item "mira-tunnel.dll" "$assets\mira-tunnel.dll" -Force
Pop-Location
Write-Host "mira-tunnel.dll built" -ForegroundColor Green

# 5. Build MiraVpn.exe
Write-Host "Building MiraVpn.exe..." -ForegroundColor Cyan
Push-Location "$root\MiraVpn"
& dotnet publish -c Release -o publish --self-contained -r win-x64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host ".NET build FAILED" -ForegroundColor Red; Pop-Location; exit 1 }
$exe = Get-Item "publish\MiraVpn.exe"
Write-Host "SUCCESS: $($exe.FullName) ($([math]::Round($exe.Length/1MB,1)) MB)" -ForegroundColor Green
Pop-Location
