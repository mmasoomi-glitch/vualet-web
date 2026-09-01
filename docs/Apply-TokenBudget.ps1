<#
  Apply-TokenBudget.ps1

  Applies the dynamic author-token allocator to C:\code_author_mcp.

  WHY YOU ARE RUNNING THIS AND NOT ME: the P0-W3 cross-project write guard blocks this
  session from writing outside C:\vualet-web. Every line of code below was authored by the
  code-author MCP (DeepSeek v4 Pro) and approved by a judge -- I did not write any of it.
  I am only the hands, and my hands are tied to one folder. This script is the handover.

  WHAT IT CHANGES
    src/constants.ts  + authorTokenBudget()            -- the allocator itself
    src/config.ts     + authorTokenCeiling             -- CA_AUTHOR_TOKEN_CEILING, 3 places
    src/pipeline.ts   ~ import, author call, estimate  -- 3 splices

  It backs up all three files first, asserts every anchor appears exactly the expected
  number of times BEFORE touching anything, and restores the backups if the typecheck fails.

  Nothing is deployed. Nothing is committed. Read-only until you run it.

      .\Apply-TokenBudget.ps1
      .\Apply-TokenBudget.ps1 -WhatIf     # dry run: report only, change nothing
#>
[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$Root  = 'C:\code_author_mcp'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Good ($m) { Write-Host "  OK    $m" -ForegroundColor Green }
function Info ($m) { Write-Host "  ..    $m" -ForegroundColor Gray }
function Warn ($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "  STOP  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Dynamic author-token allocator -> $Root" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------"
if ($WhatIf) { Warn "DRY RUN - nothing will be written." }
Write-Host ""

if (-not (Test-Path $Root)) { Die "$Root not found." }

# ---------------------------------------------------------------- the edits --
# Each entry: file, a literal anchor, its required occurrence count, and the replacement.
# Literal replace only - no regex - so nothing can match more than intended.

$constantsAnchor = @'
/** Rough chars-per-token for the local estimator. */
export const CHARS_PER_TOKEN = 4;
'@

$constantsNew = @'
/** Rough chars-per-token for the local estimator. */
export const CHARS_PER_TOKEN = 4;

// Dynamic ceiling lets callers override the default cap to match their model's context window.
export function authorTokenBudget(inputChars: number, opts?: { floor?: number; ceiling?: number }): number {
  const safeChars = Number.isFinite(inputChars) && inputChars > 0 ? inputChars : 0;
  const floor = opts?.floor ?? MAX_COMPLETION_TOKENS.author;
  const ceiling = opts?.ceiling ?? 32000;
  const tokenBudget = (safeChars / CHARS_PER_TOKEN) * 1.2;
  const clampedBudget = Math.min(Math.max(tokenBudget, floor), ceiling);
  return Math.round(clampedBudget);
}
'@

$ifaceAnchor = @'
  budgetUsd: number;
  timeoutMs: number;
}
'@

$ifaceNew = @'
  budgetUsd: number;
  timeoutMs: number;
  authorTokenCeiling: number;
}
'@

$cfgAnchor = @'
    timeoutMs: num("CA_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 600_000),
'@

$cfgNew = @'
    timeoutMs: num("CA_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 600_000),
    // it is the hard upper bound the dynamic author-token allocator may not cross, and the floor stays MAX_COMPLETION_TOKENS.author
    authorTokenCeiling: num("CA_AUTHOR_TOKEN_CEILING", 32000, 1000, 200000),
'@

$importAnchor = 'import { MAX_COMPLETION_TOKENS, CHARS_PER_TOKEN, costUsd, priceFor } from "./constants.js";'
$importNew    = 'import { MAX_COMPLETION_TOKENS, CHARS_PER_TOKEN, costUsd, priceFor, authorTokenBudget } from "./constants.js";'

$site1Anchor = @'
  return await call(
    run,
    cfg,
    stage,
    cfg.authorModel,
    [
      { role: "system", content: prompts.author },
      { role: "user", content: user },
    ],
    MAX_COMPLETION_TOKENS.author,
    false,
  );
'@

$site1New = @'
  const inputSize = dossier.length + (constraints?.length ?? 0) + (revision?.previousCode?.length ?? 0);
  return await call(
    run,
    cfg,
    stage,
    cfg.authorModel,
    [
      { role: "system", content: prompts.author },
      { role: "user", content: user },
    ],
    authorTokenBudget(inputSize, { ceiling: cfg.authorTokenCeiling }),
    false,
  );
'@

$site2Anchor = '  const A = MAX_COMPLETION_TOKENS.author;'
$site2New    = '  const A = authorTokenBudget(inputChars, { ceiling: cfg.authorTokenCeiling });'

$edits = @(
  @{ File='src\constants.ts'; Anchor=$constantsAnchor; Count=1; New=$constantsNew; What='authorTokenBudget()' }
  @{ File='src\config.ts';    Anchor=$ifaceAnchor;     Count=1; New=$ifaceNew;     What='interface field' }
  @{ File='src\config.ts';    Anchor=$cfgAnchor;       Count=2; New=$cfgNew;       What='CA_AUTHOR_TOKEN_CEILING x2' }
  @{ File='src\pipeline.ts';  Anchor=$importAnchor;    Count=1; New=$importNew;    What='import' }
  @{ File='src\pipeline.ts';  Anchor=$site1Anchor;     Count=1; New=$site1New;     What='author call site' }
  @{ File='src\pipeline.ts';  Anchor=$site2Anchor;     Count=1; New=$site2New;     What='cost estimate' }
)

# ------------------------------------------------------------ verify first --
Write-Host "CHECKING ANCHORS" -ForegroundColor Cyan
$texts = @{}
foreach ($e in $edits) {
  $path = Join-Path $Root $e.File
  if (-not (Test-Path $path)) { Die "missing $path" }
  if (-not $texts.ContainsKey($e.File)) { $texts[$e.File] = [IO.File]::ReadAllText($path) }

  # normalise CRLF so a Windows checkout still matches the LF anchors above
  $hay = $texts[$e.File] -replace "`r`n", "`n"
  $needle = $e.Anchor -replace "`r`n", "`n"

  $n = ([regex]::Matches($hay, [regex]::Escape($needle))).Count
  if ($n -ne $e.Count) {
    Die "$($e.File): expected $($e.Count) occurrence(s) of the anchor for '$($e.What)', found $n. The file has changed since these fragments were authored - STOPPING rather than guessing."
  }
  Good "$($e.File) - $($e.What) - $n match(es)"
}

if ($WhatIf) { Write-Host ""; Warn "Dry run complete. All anchors present. Re-run without -WhatIf to apply."; exit 0 }

# ----------------------------------------------------------------- back up --
Write-Host ""
Write-Host "BACKING UP" -ForegroundColor Cyan
$backups = @{}
foreach ($f in ($edits.File | Select-Object -Unique)) {
  $src = Join-Path $Root $f
  $bak = "$src.bak-tokenbudget-$Stamp"
  Copy-Item $src $bak
  $backups[$f] = $bak
  Good $bak
}

# ------------------------------------------------------------------ apply --
Write-Host ""
Write-Host "APPLYING" -ForegroundColor Cyan
foreach ($e in $edits) {
  $path = Join-Path $Root $e.File
  $text = [IO.File]::ReadAllText($path)
  $crlf = $text.Contains("`r`n")

  $flat   = $text -replace "`r`n", "`n"
  $needle = $e.Anchor -replace "`r`n", "`n"
  $repl   = $e.New    -replace "`r`n", "`n"

  $flat = $flat.Replace($needle, $repl)
  if ($crlf) { $flat = $flat -replace "`n", "`r`n" }

  [IO.File]::WriteAllText($path, $flat)
  Good "$($e.File) - $($e.What)"
}

# ------------------------------------------------------------- typecheck --
Write-Host ""
Write-Host "TYPECHECK" -ForegroundColor Cyan
Push-Location $Root
try {
  $out = & npm run typecheck 2>&1
  $ok  = ($LASTEXITCODE -eq 0)
} finally { Pop-Location }

if ($ok) {
  Good "tsc --noEmit clean"
} else {
  Write-Host ""
  $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Write-Host ""
  Warn "Typecheck FAILED - rolling back every file."
  foreach ($f in $backups.Keys) { Copy-Item $backups[$f] (Join-Path $Root $f) -Force }
  Die "Rolled back. Nothing was left half-applied. Send me the errors above."
}

# ----------------------------------------------------------------- build --
Write-Host ""
Write-Host "BUILD" -ForegroundColor Cyan
Push-Location $Root
try {
  $out = & npm run build 2>&1
  $ok  = ($LASTEXITCODE -eq 0)
} finally { Pop-Location }

if ($ok) { Good "build clean" } else {
  $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Warn "Build failed. Backups are at *.bak-tokenbudget-$Stamp if you want to roll back."
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Cyan
Write-Host "  The author ceiling is now sized from the material each call must hand back."
Write-Host "  Floor stays 8,000 so nothing can get worse. Default cap 32,000."
Write-Host "  Tune it with CA_AUTHOR_TOKEN_CEILING (1,000 - 200,000) if you ever need to."
Write-Host ""
Write-Host "  RESTART the MCP server for this to take effect - in Claude Code, /mcp then" -ForegroundColor Yellow
Write-Host "  reconnect code-author, or restart the session." -ForegroundColor Yellow
Write-Host ""
