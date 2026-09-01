<#
  Apply-CapabilityAudit.ps1

  CLOSES FOUR PLATFORM-WIDE CAPABILITY DENIALS. Multi-tenant, not one conversation.

  THE SYSTEMIC DEFECT. Mira's capability brief is a CLOSED list ending "you can only do
  what is listed here. If asked about something not listed, say you're not sure rather
  than making up a capability." That clause is correct and load-bearing - it stops her
  over-promising. But it means the list is not a DESCRIPTION of her abilities, it is the
  DEFINITION of them. Any capability wired in code but missing from the list is not merely
  unmentioned: she ACTIVELY DENIES it, then invents a mechanism to explain the denial.

  This has now caused three incidents on the same root cause:
    - durable memory   (she told customers she would forget them)
    - inbound voice    (she told the owner his browser was not passing audio)
    - and the four below, not yet triggered but live for every paying tenant

  THE AUDIT. Modules the production WhatsApp gateway imports and calls, against the list:

    wired + listed    voice.mjs stt ............ inbound voice   (fixed earlier today)
    wired + listed    wa-image-ocr.mjs ......... image OCR
    WIRED + MISSING   wa-outbound-files.mjs .... sendAttachments
    WIRED + MISSING   wa-proactive.mjs ......... runPulseSweep, handlePulseCommand
    WIRED + MISSING   wa-autoanswer.mjs ........ maybeAutoAnswer, autoAnswerOffDigest
    WIRED + MISSING   wa-observe.mjs ........... observeOutgoing, shouldObserve

  Four capabilities the product SELLS, that the product's own assistant denies having.

  THE FIX. Four marker/text pairs beside BUILD_CAPABILITY, following the file's
  ADDITIVE-ONLY rule for the jury-fixed string, plus four idempotent guarded appends in
  the always-on position so none of the four persona-replacing paths can drop them.

  Deliberately UNCONDITIONAL apart from the marker check. Each capability text states its
  OWN gate - consent for observation, a mode the customer switches on for away-answering,
  on/off for pulses. She must always know she HAS the capability and describe its gate,
  rather than being told she lacks it. Gating belongs in the sentence, not in whether she
  is told at all.

  Authored by the code-author MCP (DeepSeek v4 Pro), judge-approved. Not written by me.

      .\Apply-CapabilityAudit.ps1
      .\Apply-CapabilityAudit.ps1 -WhatIf
#>
[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$Root  = 'C:\Ballerina-Motasadea-V1'
$File  = Join-Path $Root 'apps\engine\src\mira.mjs'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Good ($m) { Write-Host "  OK    $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "  STOP  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Capability audit - four platform-wide denials" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------"
if ($WhatIf) { Warn "DRY RUN - nothing will be written." }
Write-Host ""

if (-not (Test-Path $File)) { Die "$File not found." }

$constAnchor = @'
ask them to resend it rather than explaining why.';
'@

$constNew = @'
ask them to resend it rather than explaining why.';

// ADDITIVE ONLY, same rule as BUILD_CAPABILITY and VOICE_IO_CAPABILITY above. A platform-wide
// audit found these four wired into the gateway and absent from the closed list, which means
// every tenant's assistant denies four capabilities the product actually sells. Each text
// carries its OWN gate, because the gate belongs in the sentence - not in whether she is told.
export const FILES_CAPABILITY_MARKER = 'You can SEND REAL FILES';
export const FILES_CAPABILITY =
  '\n- ' + FILES_CAPABILITY_MARKER + ' for this customer - documents and files sent into the chat as real attachments. If they ask for something as a file, offer to send it, and never claim you can only paste text.';

export const PROACTIVE_CAPABILITY_MARKER = 'You can MESSAGE FIRST';
export const PROACTIVE_CAPABILITY =
  '\n- ' + PROACTIVE_CAPABILITY_MARKER + ' for this customer - you can message the customer first without being prompted when something is worth raising. These are called pulses. The customer can turn them on or off. Never claim you can only respond when spoken to.';

export const AWAY_CAPABILITY_MARKER = 'You can COVER FOR THE CUSTOMER';
export const AWAY_CAPABILITY =
  '\n- ' + AWAY_CAPABILITY_MARKER + ' for this customer - when the customer is away you can answer on their behalf and give them a digest of what you handled when they return. This is a mode the customer switches on. Do not deny being able to cover for them.';

export const OBSERVE_CAPABILITY_MARKER = 'You can OBSERVE WITH EXPLICIT CONSENT';
export const OBSERVE_CAPABILITY =
  '\n- ' + OBSERVE_CAPABILITY_MARKER + ' for this customer - with the customer\'s explicit consent you can observe how they write to other people in order to learn their style and who matters to them. Consent is required and off by default. State the consent requirement plainly whenever you mention this, and never imply you read anything without permission.';
'@

$appendAnchor = @'
  if (!sys.includes(VOICE_IO_CAPABILITY_MARKER)) sys += VOICE_IO_CAPABILITY;
'@

$appendNew = @'
  if (!sys.includes(VOICE_IO_CAPABILITY_MARKER)) sys += VOICE_IO_CAPABILITY;
  // these four were wired in code but missing from the closed list, and a closed list turns every omission into an active denial to the customer.
  if (!sys.includes(FILES_CAPABILITY_MARKER)) sys += FILES_CAPABILITY;
  if (!sys.includes(PROACTIVE_CAPABILITY_MARKER)) sys += PROACTIVE_CAPABILITY;
  if (!sys.includes(AWAY_CAPABILITY_MARKER)) sys += AWAY_CAPABILITY;
  if (!sys.includes(OBSERVE_CAPABILITY_MARKER)) sys += OBSERVE_CAPABILITY;
'@

$edits = @(
  @{ Anchor=$constAnchor;  Count=1; New=$constNew;  What='four capability constants' }
  @{ Anchor=$appendAnchor; Count=1; New=$appendNew; What='four guarded appends' }
)

Write-Host "CHECKING ANCHORS" -ForegroundColor Cyan
$text = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($File))
if ($text -match 'FILES_CAPABILITY') { Die "FILES_CAPABILITY already present - looks already applied. STOPPING." }
foreach ($e in $edits) {
  $n = ([regex]::Matches($text, [regex]::Escape($e.Anchor))).Count
  if ($n -ne $e.Count) { Die "expected $($e.Count) of '$($e.What)', found $n - STOPPING." }
  Good "$($e.What) - $n match(es)"
}
if ($WhatIf) { Write-Host ""; Warn "Dry run complete."; exit 0 }

Write-Host ""
Write-Host "BACKING UP" -ForegroundColor Cyan
$bak = "$File.bak-capaudit-$Stamp"; Copy-Item $File $bak; Good $bak

Write-Host ""
Write-Host "APPLYING (byte-preserving)" -ForegroundColor Cyan
foreach ($e in $edits) { $text = $text.Replace($e.Anchor, $e.New); Good $e.What }
[IO.File]::WriteAllBytes($File, [Text.Encoding]::UTF8.GetBytes($text))

Write-Host ""
Write-Host "SYNTAX CHECK" -ForegroundColor Cyan
Push-Location $Root
try { $out = & node --check $File 2>&1; $ok = ($LASTEXITCODE -eq 0) } finally { Pop-Location }
if ($ok) { Good "node --check clean" } else {
  $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Copy-Item $bak $File -Force; Die "FAILED - rolled back."
}

Write-Host ""
Write-Host "CONFIRMING" -ForegroundColor Cyan
$after = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($File))
foreach ($m in 'FILES_CAPABILITY_MARKER','PROACTIVE_CAPABILITY_MARKER','AWAY_CAPABILITY_MARKER','OBSERVE_CAPABILITY_MARKER') {
  $defs = ([regex]::Matches($after, [regex]::Escape("export const $m"))).Count
  $uses = ([regex]::Matches($after, [regex]::Escape("if (!sys.includes($m))"))).Count
  if ($defs -eq 1 -and $uses -eq 1) { Good "$m - defined and wired" } else { Warn "$m defs=$defs uses=$uses" }
}
foreach ($k in "if (!sys.includes('CAPABILITIES YOU HAVE')) sys += CAPABILITY_AWARENESS;","sys += VOICE_IO_CAPABILITY;","console.error('[lap]'") {
  if ($after.Contains($k)) { Good "untouched: $k" } else { Warn "MISSING: $k" }
}

Write-Host ""
Write-Host "APPLIED LOCALLY. Deploy separately." -ForegroundColor Cyan
Write-Host "  Backup: $bak"
Write-Host ""
