@echo off
REM ============================================================
REM Mira VPN Windows Client — one-command build
REM ============================================================
REM Prerequisites: .NET 8 SDK installed (winget install Microsoft.DotNet.SDK.8)
REM Output: MiraVpn\publish\MiraVpn.exe (self-contained, ~69 MB)
REM
REM The resulting .exe is production-ready:
REM   - Embedded wintun.dll (MIT-licensed TUN kernel driver)
REM   - Embedded wireguard.exe (MIT-licensed tunnel binary)
REM   - Zero external downloads. Zero user prompts beyond Windows UAC.
REM   - Single file. Double-click to run. System tray icon.
REM ============================================================

echo [1/3] Preparing embedded resources...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-resources.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo [!] Resource preparation failed. See above.
    pause
    exit /b 1
)

echo [2/3] Restoring packages...
dotnet restore "%~dp0MiraVpn\MiraVpn.csproj"
if %ERRORLEVEL% NEQ 0 (
    echo [!] Restore failed.
    pause
    exit /b 1
)

echo [3/3] Publishing single-file executable...
dotnet publish "%~dp0MiraVpn\MiraVpn.csproj" ^
    -c Release ^
    -o "%~dp0MiraVpn\publish" ^
    --self-contained ^
    -r win-x64 ^
    -p:PublishSingleFile=true ^
    -p:IncludeNativeLibrariesForSelfExtract=true ^
    -p:EnableCompressionInSingleFile=true

if %ERRORLEVEL% NEQ 0 (
    echo [!] Build failed.
    pause
    exit /b 1
)

echo.
echo ==============================================
echo   Mira VPN client build SUCCESS
echo   Output: %~dp0MiraVpn\publish\MiraVpn.exe
echo   Size:   (check file)
echo.
echo   Double-click to run. System tray icon.
echo ==============================================
pause
