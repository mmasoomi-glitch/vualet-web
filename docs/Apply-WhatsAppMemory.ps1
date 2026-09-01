<#
  Apply-WhatsAppMemory.ps1

  GIVES MIRA HER MEMORY BACK ON WHATSAPP.

  THE DEFECT, proven two ways on 2026-08-30:
    * STATIC  - apps/engine/whatsapp-gateway-v2.mjs contains ZERO fact-write calls. The
                Telegram bot has the whole machinery; WhatsApp never had any of it.
    * TEMPORAL- the last fact Mira ever recorded was 2026-08-21 09:15:14. WhatsApp was
                bound at 11:27:20 the same morning, two hours and twelve minutes later.
                Not one fact since. tenant_facts.source has never contained 'whatsapp'.

  Her 36 existing facts are intact and the read path ALREADY works on WhatsApp, so no
  backfill is needed - the moment this lands, old and new facts are both visible to her.

  WHAT IT CHANGES - one file, apps/engine/whatsapp-gateway-v2.mjs, three splices:
    1. adds `appendFact` to the existing @mira/state import
    2. adds a non-blocking `recordFact` helper that LOGS its failures
    3. records two facts after each reply, mirroring telegram-bot.mjs:1199-1200

  Every line was authored by the code-author MCP (DeepSeek v4 Pro) and approved by a
  judge. I wrote none of it. Applying it is blocked for me by the P0-W3 cross-project
  write guard, which is why this is a handover.

  It backs the file up, asserts every anchor before touching anything, syntax-checks the
  result, and restores the backup automatically if the check fails. It does NOT restart
  the service - that is your call, and the script tells you the command at the end.

      .\Apply-WhatsAppMemory.ps1
      .\Apply-WhatsAppMemory.ps1 -WhatIf     # dry run: report only, change nothing
#>
[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$Root  = 'C:\Ballerina-Motasadea-V1'
$Rel   = 'apps\engine\whatsapp-gateway-v2.mjs'
$File  = Join-Path $Root $Rel
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Good ($m) { Write-Host "  OK    $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "  STOP  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "WhatsApp durable memory -> $Rel" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------"
if ($WhatIf) { Warn "DRY RUN - nothing will be written." }
Write-Host ""

if (-not (Test-Path $File)) { Die "$File not found." }

# ---------------------------------------------------------------- the edits --

$importAnchor = @'
import {
  initDb, ensureSchema, getDb,
  ensureTenant, getTenantByTelegram, getTenantById, setTenantStatus, setTenantEntitlement,
  updateTenantField,
  applyBillingState,
  resolveTenant, provisionTenantIdentity, linkChannelIdentity, CHANNELS,
  encrypt, decrypt, kekConfigured,
} from '@mira/state';
'@

$importNew = @'
import {
  initDb, ensureSchema, getDb,
  ensureTenant, getTenantByTelegram, getTenantById, setTenantStatus, setTenantEntitlement,
  updateTenantField,
  applyBillingState,
  resolveTenant, provisionTenantIdentity, linkChannelIdentity, CHANNELS,
  encrypt, decrypt, kekConfigured,
  appendFact,
} from '@mira/state';
'@

$helperAnchor = @'
const __dirname = dirname(fileURLToPath(import.meta.url));
'@

$helperNew = @'
/*
 * Safely records a fact via appendFact with WhatsApp defaults, logging errors without
 * exposing customer statements. Because appendFact can throw (validation, DB issues),
 * we catch all failures, log the kind and error, and return false. Returning a
 * boolean avoids disrupting caller flows and ensures silent emergencies become visible.
 */
async function recordFact(tenantId, kind, statement, extra = {}) {
  try {
    await appendFact(tenantId, {
      ...extra,
      kind,
      statement,
      source: extra.source ?? 'whatsapp',
      scope: extra.scope ?? 'general',
      actorIdentityId: extra.actorIdentityId ?? null,
      value: extra.value ?? null
    });
    return true;
  } catch (error) {
    console.error(`[tenant-ledger] ${kind} ${error.message}`);
    return false;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
'@

$callAnchor = @'
  const r = await respond(t, text, { inbound: isVoiceNote ? 'voice' : 'text' });
'@

$callNew = @'
  const r = await respond(t, text, { inbound: isVoiceNote ? 'voice' : 'text' });

  // Durable memory: this WhatsApp gateway previously never recorded facts,
  // leaving the assistant with no durable memory of any WhatsApp conversation.
  // Record the inbound message and system reply (non-blocking, fire-and-forget).
  recordFact(t.id, 'observation', text, { source: 'whatsapp', scope: 'chat' });
  recordFact(t.id, r.kind === 'chat' ? 'action' : 'system', r.text, {
    source: 'system',
    scope: 'chat',
    value: { kind: r.kind, cost: r.cost ?? 0, voice: !!r.voice },
  });
'@

$edits = @(
  @{ Anchor=$importAnchor; Count=1; New=$importNew; What='import appendFact' }
  @{ Anchor=$helperAnchor; Count=1; New=$helperNew; What='recordFact helper' }
  @{ Anchor=$callAnchor;   Count=1; New=$callNew;   What='two fact writes per reply' }
)

# ------------------------------------------------------------ verify first --
Write-Host "CHECKING ANCHORS" -ForegroundColor Cyan

$text = [IO.File]::ReadAllText($File)

if ($text -match 'recordFact') {
  Die "This file already mentions recordFact - it looks like the change is already applied. STOPPING rather than double-applying."
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
$bak = "$File.bak-wamemory-$Stamp"
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

# ------------------------------------------------------------- confirm it --
Write-Host ""
Write-Host "CONFIRMING" -ForegroundColor Cyan
$after = [IO.File]::ReadAllText($File)
$n = ([regex]::Matches($after, [regex]::Escape('recordFact('))).Count
Good "recordFact appears $n time(s) - 1 definition + 2 calls expected"
if ($after -match 'appendFact,') { Good "appendFact imported" }

Write-Host ""
Write-Host "APPLIED LOCALLY. NOT YET DEPLOYED." -ForegroundColor Cyan
Write-Host ""
Write-Host "  This changed your LOCAL working tree only. The engine on 23.88.59.31 is" -ForegroundColor Yellow
Write-Host "  still running the old file and will keep forgetting until it is deployed" -ForegroundColor Yellow
Write-Host "  and restarted. That is a production action, so it is your call, not mine." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Tell me when you want it deployed and I will prepare that step separately."
Write-Host "  Backup, if you want to undo: $bak"
Write-Host ""
