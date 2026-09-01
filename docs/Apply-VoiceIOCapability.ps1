<#
  Apply-VoiceIOCapability.ps1

  STOPS MIRA DENYING SHE CAN HEAR YOU.

  THE DEFECT. Her capability brief is a CLOSED list - it ends with "you can only do what is
  listed here" - so anything missing from it becomes an ACTIVE DENIAL to the customer. The
  file already records this trap in a comment above the append block:

      "Because the capability list is CLOSED ... every gap in the brief converted into an
       ACTIVE DENIAL to the customer - which is exactly why she kept saying she could not
       remember."

  The list says she can SEND voice notes. It says NOTHING about RECEIVING them. But the
  gateway does transcribe inbound voice - it imports stt() from src/voice.mjs specifically
  for that. So she was told she can talk but never told she can listen, and being forbidden
  to claim unlisted capabilities, she denied hearing the customer and improvised a support
  script about enabling text-to-speech and the browser not passing audio. None of it true.

  THE FIX - two additions, no rewrites:
    1. VOICE_IO_CAPABILITY_MARKER + VOICE_IO_CAPABILITY constants, beside BUILD_CAPABILITY,
       following the file's established ADDITIVE-ONLY pattern for the jury-fixed string.
    2. One idempotent guarded append, so no persona variant can drop it - the same defence
       already used for CAPABILITY_AWARENESS and GROUNDING.

  It also forbids her from ever telling a customer to change a client setting, because she
  has no visibility into their device and that advice is always invention.

  Authored by the code-author MCP (DeepSeek v4 Pro), judge-approved. Not written by me.

      .\Apply-VoiceIOCapability.ps1
      .\Apply-VoiceIOCapability.ps1 -WhatIf     # dry run
#>
[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$Root  = 'C:\Ballerina-Motasadea-V1'
$Rel   = 'apps\engine\src\mira.mjs'
$File  = Join-Path $Root $Rel
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Good ($m) { Write-Host "  OK    $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "  STOP  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Inbound-voice capability -> $Rel" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------"
if ($WhatIf) { Warn "DRY RUN - nothing will be written." }
Write-Host ""

if (-not (Test-Path $File)) { Die "$File not found." }

# ---------------------------------------------------------------- the edits --

$constAnchor = @'
instead of pretending you cannot build at all.';
'@

$constNew = @'
instead of pretending you cannot build at all.';

// ADDITIVE ONLY, same reason as BUILD_CAPABILITY above. The list covered SENDING voice and
// never RECEIVING it, so a closed list turned the omission into a denial: she told the owner
// she could not hear him and invented client-side settings advice to explain it.
export const VOICE_IO_CAPABILITY_MARKER = 'You can HEAR AND UNDERSTAND VOICE NOTES';
export const VOICE_IO_CAPABILITY =
  '\n- ' + VOICE_IO_CAPABILITY_MARKER + ' - you receive voice notes, they are transcribed for you automatically, and you understand them. You are not limited by the customer\'s app or browser; audio reaches you normally. Never tell a customer to enable text-to-speech, change a client setting, or claim their app or browser is not passing audio - you have no visibility into their device and such advice is always invention. If a voice note ever fails to arrive, say plainly that you did not receive it and ask them to resend it rather than explaining why.';
'@

$appendAnchor = @'
  if (buildBackendAvailable() && buildAllowedFor(t) && !sys.includes(BUILD_CAPABILITY_MARKER)) sys += BUILD_CAPABILITY;
'@

$appendNew = @'
  if (buildBackendAvailable() && buildAllowedFor(t) && !sys.includes(BUILD_CAPABILITY_MARKER)) sys += BUILD_CAPABILITY;
  // The capability list is closed, so omitting inbound voice made her deny hearing the customer and invent client-side settings advice.
  if (!sys.includes(VOICE_IO_CAPABILITY_MARKER)) sys += VOICE_IO_CAPABILITY;
'@

$edits = @(
  @{ Anchor=$constAnchor;  Count=1; New=$constNew;  What='VOICE_IO constants' }
  @{ Anchor=$appendAnchor; Count=1; New=$appendNew; What='idempotent guarded append' }
)

# ------------------------------------------------------------ verify first --
Write-Host "CHECKING ANCHORS" -ForegroundColor Cyan

$bytes = [IO.File]::ReadAllBytes($File)
$text  = [Text.Encoding]::UTF8.GetString($bytes)

if ($text -match 'VOICE_IO') { Die "VOICE_IO already present - looks already applied. STOPPING." }

foreach ($e in $edits) {
  $n = ([regex]::Matches($text, [regex]::Escape($e.Anchor))).Count
  if ($n -ne $e.Count) { Die "expected $($e.Count) of '$($e.What)', found $n. File changed since authoring - STOPPING." }
  Good "$($e.What) - $n match(es)"
}

if ($WhatIf) { Write-Host ""; Warn "Dry run complete. All anchors present."; exit 0 }

# ----------------------------------------------------------------- back up --
Write-Host ""
Write-Host "BACKING UP" -ForegroundColor Cyan
$bak = "$File.bak-voiceio-$Stamp"
Copy-Item $File $bak
Good $bak

# ------------------------------------------------------------------ apply --
# Byte-preserving: read as bytes, decode, replace, re-encode. No newline translation,
# after a text-mode round trip silently converted 2,145 CRLF line endings earlier today.
Write-Host ""
Write-Host "APPLYING" -ForegroundColor Cyan
foreach ($e in $edits) { $text = $text.Replace($e.Anchor, $e.New); Good $e.What }
[IO.File]::WriteAllBytes($File, [Text.Encoding]::UTF8.GetBytes($text))

# ------------------------------------------------------------ syntax check --
Write-Host ""
Write-Host "SYNTAX CHECK" -ForegroundColor Cyan
Push-Location $Root
try { $out = & node --check $File 2>&1; $ok = ($LASTEXITCODE -eq 0) } finally { Pop-Location }

if ($ok) { Good "node --check clean" } else {
  $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Copy-Item $bak $File -Force
  Die "Syntax check FAILED - rolled back. File is exactly as it was."
}

# --------------------------------------------------------------- confirm --
Write-Host ""
Write-Host "CONFIRMING" -ForegroundColor Cyan
$after = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($File))
$checks = @(
  @{ N = "export const VOICE_IO_CAPABILITY_MARKER"; W = 'marker constant defined' }
  @{ N = "if (!sys.includes(VOICE_IO_CAPABILITY_MARKER)) sys += VOICE_IO_CAPABILITY;"; W = 'guarded append wired' }
  @{ N = "Never tell a customer to enable text-to-speech"; W = 'client-settings invention forbidden' }
  @{ N = "if (!sys.includes('CAPABILITIES YOU HAVE')) sys += CAPABILITY_AWARENESS;"; W = 'existing capability guard untouched' }
)
foreach ($c in $checks) { if ($after.Contains($c.N)) { Good $c.W } else { Warn "MISSING: $($c.W)" } }

Write-Host ""
Write-Host "APPLIED LOCALLY. Deploy separately." -ForegroundColor Cyan
Write-Host "  Backup: $bak"
Write-Host ""
