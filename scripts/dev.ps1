$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

function Read-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    $trim = $line.Trim()
    if ($trim.Length -eq 0) { continue }
    if ($trim.StartsWith("#")) { continue }
    if ($trim -match "^\s*$Key\s*=\s*(.*)\s*$") {
      $val = $Matches[1]
      # strip optional quotes
      if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
      return $val
    }
  }
  return $null
}

# Load HOST/PORT from .env.local if not already set
$envFile = Join-Path (Get-Location) ".env.local"
if (-not $env:HOST) {
  $hostVal = Read-DotEnvValue $envFile "HOST"
  if ($hostVal) { $env:HOST = $hostVal }
}
if (-not $env:PORT) {
  $portVal = Read-DotEnvValue $envFile "PORT"
  if ($portVal) { $env:PORT = $portVal }
}

# Defaults (safe for LAN access)
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }
if (-not $env:PORT) { $env:PORT = "3000" }

# Force a consistent Node runtime for native addons.
# This repo uses better-sqlite3, which is currently built for Node ABI 127.
# Cursor bundles Node 22 (ABI 127) at the path below; prefer it if available.
$cursorNode = "$env:LOCALAPPDATA\Programs\cursor\resources\app\resources\helpers\node.exe"
$systemNode = "C:\Program Files\nodejs\node.exe"
$node = if (Test-Path $cursorNode) { $cursorNode } elseif (Test-Path $systemNode) { $systemNode } else { "node" }

$tsxCli = Join-Path (Get-Location) "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsxCli)) {
  throw "tsx CLI not found at $tsxCli. Run npm install."
}

Write-Host ("[dev] HOST={0} PORT={1}" -f $env:HOST, $env:PORT)
Write-Host ("[dev] node={0}" -f $node)

& $node $tsxCli --tsconfig tsconfig.json server.mjs
exit $LASTEXITCODE

