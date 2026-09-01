<#
  Apply-MemoryVoiceLogging.ps1

  MAKES TWO INVISIBLE FAILURES VISIBLE.

  Both of these already degrade gracefully, and that is CORRECT - the customer keeps
  getting an answer. What is wrong is that they degrade in total silence, so a fault can
  run for days with nobody able to see it:

    mira.mjs:382  ground(t, text).catch(() => null)
                  If retrieving the customer's recorded facts throws, EVERY fact the
                  assistant knows about them vanishes from the prompt and it answers as
                  a stranger. Nothing is logged.

    mira.mjs:521  catch (e) { return { ...voice: false... } }
                  When text-to-speech fails it falls back to text. Nothing is logged.
                  Real incident: the owner stopped getting voice notes and a journal
                  search for elevenlabs, tts, voice and every relevant HTTP status
                  returned not one line. With no error to explain the gap, Mira invented
                  a plausible cause and told the customer to change an unrelated setting.

  A silent failure in a system with a language model at its centre does not stay silent.
  It becomes a confident wrong explanation delivered to the customer.

  THIS IS A DIAGNOSTICS-ONLY CHANGE. Behaviour is byte-for-byte identical: same graceful
  degradation, same early return, same object, same fields. Two console.error lines are
  added. Neither logs customer content - only the error message.

  Every line was authored by the code-author MCP (DeepSeek v4 Pro) and judge-approved.
  In both cases Judge 1 demanded a change that would have altered behaviour and GPT-5.1
  overruled it; the code below is the version that preserves behaviour.

      .\Apply-MemoryVoiceLogging.ps1
      .\Apply-MemoryVoiceLogging.ps1 -WhatIf     # dry run: report only, change nothing
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
Write-Host "Diagnostic logging for two silent failures -> $Rel" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------"
if ($WhatIf) { Warn "DRY RUN - nothing will be written." }
Write-Host ""

if (-not (Test-Path $File)) { Die "$File not found." }

# ---------------------------------------------------------------- the edits --

$groundAnchor = @'
  const grounded = await ground(t, text).catch(() => null); // LAP: tier-grounded retrieval
'@

$groundNew = @'
  const grounded = await ground(t, text).catch(err => { console.error('[lap]', err.message); return null; }); // LAP: tier-grounded retrieval
'@

$voiceAnchor = @'
  if (shouldVoice(t.tier, t.replyN, inboundMedium)) {
    try {
      audio = await tts(reply);
      await import('@mira/state').then(m => m.debit(t.id, (charsOf(reply) / 1000) * VOICE_USD_PER_1K, 'voice'));
    } catch (e) {
      // Voice synthesis failed: emit oops sound, fallback to text (Jury-approved graceful degradation)
      return { text: reply, voice: false, audio: null, kind: 'chat', cost, personality: { soundEffect: 'oops' } };
    }
  }
'@

$voiceNew = @'
  if (shouldVoice(t.tier, t.replyN, inboundMedium)) {
    try {
      audio = await tts(reply);
      await import('@mira/state').then(m => m.debit(t.id, (charsOf(reply) / 1000) * VOICE_USD_PER_1K, 'voice'));
    } catch (e) {
      // Voice synthesis failed: emit oops sound, fallback to text (Jury-approved graceful degradation)
      console.error('[voice] TTS failed, falling back to text-only reply:', e.message);
      return { text: reply, voice: false, audio: null, kind: 'chat', cost, personality: { soundEffect: 'oops' } };
    }
  }
'@

$edits = @(
  @{ Anchor=$groundAnchor; Count=1; New=$groundNew; What='fact-read failure is logged' }
  @{ Anchor=$voiceAnchor;  Count=1; New=$voiceNew;  What='TTS failure is logged' }
)

# ------------------------------------------------------------ verify first --
Write-Host "CHECKING ANCHORS" -ForegroundColor Cyan

$text = [IO.File]::ReadAllText($File)

if ($text -match '\[voice\]|\[lap\]') {
  Die "This file already contains a [voice] or [lap] log line - it looks like the change is already applied. STOPPING rather than double-applying."
}

foreach ($e in $edits) {
  $hay    = $text -replace "`r`n", "`n"
  $needle = $e.Anchor -replace "`r`n", "`n"
  $n = ([regex]::Matches($hay, [regex]::Escape($needle))).Count
  if ($n -ne $e.Count) {
    Die "expected $($e.Count) occurrence(s) of the anchor for '$($e.What)', found $n. The file has changed since these fragments were authored - STOPPING rather than guessing."
  }
  Good "$($e.What) - $n match(es)"
}

if ($WhatIf) { Write-Host ""; Warn "Dry run complete. All anchors present. Re-run without -WhatIf to apply."; exit 0 }

# ----------------------------------------------------------------- back up --
Write-Host ""
Write-Host "BACKING UP" -ForegroundColor Cyan
$bak = "$File.bak-logging-$Stamp"
Copy-Item $File $bak
Good $bak

# ------------------------------------------------------------------ apply --
Write-Host ""
Write-Host "APPLYING" -ForegroundColor Cyan
$crlf = $text.Contains("`r`n")
$flat = $text -replace "`r`n", "`n"

foreach ($e in $edits) {
  $needle = $e.Anchor -replace "`r`n", "`n"
  $repl   = $e.New    -replace "`r`n", "`n"
  $flat   = $flat.Replace($needle, $repl)
  Good $e.What
}

if ($crlf) { $flat = $flat -replace "`n", "`r`n" }
[IO.File]::WriteAllText($File, $flat)

# ------------------------------------------------------------ syntax check --
Write-Host ""
Write-Host "SYNTAX CHECK" -ForegroundColor Cyan
Push-Location $Root
try {
  $out = & node --check $File 2>&1
  $ok  = ($LASTEXITCODE -eq 0)
} finally { Pop-Location }

if ($ok) {
  Good "node --check clean"
} else {
  Write-Host ""
  $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Write-Host ""
  Warn "Syntax check FAILED - restoring the backup."
  Copy-Item $bak $File -Force
  Die "Rolled back. The file is exactly as it was. Send me the errors above."
}

# ------------------------------------------------------- prove no behaviour change --
Write-Host ""
Write-Host "CONFIRMING BEHAVIOUR IS UNCHANGED" -ForegroundColor Cyan
$after = [IO.File]::ReadAllText($File)

$checks = @(
  @{ Needle = "return { text: reply, voice: false, audio: null, kind: 'chat', cost, personality: { soundEffect: 'oops' } };"; What = 'voice fallback return object identical' }
  @{ Needle = 'return null; }); // LAP: tier-grounded retrieval';                                                             What = 'fact-read still resolves to null' }
  @{ Needle = "console.error('[voice] TTS failed";                                                                            What = 'voice failure now logged' }
  @{ Needle = "console.error('[lap]', err.message)";                                                                          What = 'fact-read failure now logged' }
)
foreach ($c in $checks) {
  if ($after.Contains($c.Needle)) { Good $c.What } else { Warn "MISSING: $($c.What)" }
}

Write-Host ""
Write-Host "APPLIED LOCALLY. NOT YET DEPLOYED." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Local working tree only. Once this is deployed, the next time voice or" -ForegroundColor Yellow
Write-Host "  memory fails you will see the reason in the journal instead of silence:" -ForegroundColor Yellow
Write-Host ""
Write-Host "    journalctl -u mira-whatsapp -u mira-bot -f | grep -E '\[voice\]|\[lap\]|\[tenant-ledger\]'"
Write-Host ""
Write-Host "  Backup, if you want to undo: $bak"
Write-Host ""
