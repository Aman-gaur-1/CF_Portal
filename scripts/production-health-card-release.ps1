[CmdletBinding()]
param(
  [ValidateSet('DryRun', 'Rehearsal', 'Apply')]
  [string]$Mode = 'DryRun',
  [ValidateSet('Production', 'Staging')]
  [string]$Target = 'Production',
  [string]$ConnectionFile = '',
  [string]$BackupPath = ''
)

$ErrorActionPreference = 'Stop'

$productionRef = 'hktpncjuflynwdikmbfl'
$stagingRef = 'bgpmsckjvutnqkryxknb'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pgBin = 'C:\Users\Aman\scoop\apps\postgresql\current\bin'
$psql = Join-Path $pgBin 'psql.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$productMigration = Join-Path $repoRoot 'supabase\migrations\20261018230000_student_health_card_product_model.sql'
$dryRunSql = Join-Path $repoRoot 'supabase\manual\production_health_card_release_dry_run.sql'
$compatibilitySql = Join-Path $repoRoot 'supabase\manual\production_health_card_compatibility.sql'
$rehearsalSql = Join-Path $repoRoot 'supabase\manual\production_health_card_release_rehearsal.sql'

if (-not (Test-Path -LiteralPath $psql)) { throw 'psql.exe was not found.' }
if (-not (Test-Path -LiteralPath $dryRunSql)) { throw 'Dry-run SQL file is missing.' }
if (-not (Test-Path -LiteralPath $compatibilitySql)) { throw 'Compatibility SQL file is missing.' }

if (-not $ConnectionFile) {
  $ConnectionFile = if ($Target -eq 'Production') {
    'C:\Users\Aman\CF_Portal\.env.production-db.local'
  } else {
    'C:\Users\Aman\CF_Portal\.env.staging.local'
  }
}

if (-not (Test-Path -LiteralPath $ConnectionFile)) {
  throw "Connection file not found for $Target."
}

$keyName = if ($Target -eq 'Production') { 'PRODUCTION_DATABASE_URL' } else { 'STAGING_DATABASE_URL' }
$line = Get-Content -LiteralPath $ConnectionFile | Where-Object { $_ -match "^\s*$keyName=" } | Select-Object -First 1
if (-not $line) { throw "$keyName is missing from the configured connection file." }
$databaseUrl = $line.Substring($line.IndexOf('=') + 1).Trim()
$databaseUri = [Uri]$databaseUrl
$connectionIdentity = "$($databaseUri.Host) $($databaseUri.UserInfo) $($databaseUri.AbsolutePath)"

if ($Target -eq 'Production') {
  if (-not $connectionIdentity.Contains($productionRef)) { throw 'Refusing: connection does not identify the production project.' }
  if ($connectionIdentity.Contains($stagingRef)) { throw 'Refusing: staging project ref is present in the production connection.' }
} else {
  if (-not $connectionIdentity.Contains($stagingRef)) { throw 'Refusing: connection does not identify the staging project.' }
  if ($connectionIdentity.Contains($productionRef)) { throw 'Refusing: production project ref is present in the staging connection.' }
}

function Invoke-PsqlFile([string]$File, [string[]]$ExtraArguments = @()) {
  $arguments = @('--no-psqlrc', '--dbname', $databaseUrl, '--set=ON_ERROR_STOP=1') + $ExtraArguments + @('--file', $File)
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $psql @arguments 2>&1 } finally { $ErrorActionPreference = $previousErrorAction }
  if ($LASTEXITCODE -ne 0) { throw "psql failed while executing $([IO.Path]::GetFileName($File))." }
  if ($output) { $output | Write-Output }
}

function Invoke-PsqlCommand([string]$Command, [string[]]$ExtraArguments = @()) {
  $arguments = @('--no-psqlrc', '--dbname', $databaseUrl, '--set=ON_ERROR_STOP=1') + $ExtraArguments + @('--command', $Command)
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $psql @arguments 2>&1 } finally { $ErrorActionPreference = $previousErrorAction }
  if ($LASTEXITCODE -ne 0) { throw 'psql command failed.' }
  if ($output) { $output | Write-Output }
}

function Invoke-PsqlTransactionalFile([string]$File, [string]$EndCommand) {
  $arguments = @(
    '--no-psqlrc',
    '--dbname',
    $databaseUrl,
    '--set=ON_ERROR_STOP=1',
    '--command',
    'BEGIN;',
    '--file',
    $File,
    '--command',
    $EndCommand
  )
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $psql @arguments 2>&1 } finally { $ErrorActionPreference = $previousErrorAction }
  if ($LASTEXITCODE -ne 0) { throw "Transactional psql execution failed for $([IO.Path]::GetFileName($File))." }
  if ($output) { $output | Write-Output }
}

switch ($Mode) {
  'DryRun' {
    Invoke-PsqlFile $dryRunSql
    break
  }

  'Rehearsal' {
    if ($Target -ne 'Staging') { throw 'Rehearsal is allowed only against staging.' }
    if (-not (Test-Path -LiteralPath $rehearsalSql)) { throw 'Rehearsal SQL file is missing.' }
    Invoke-PsqlFile $rehearsalSql
    break
  }

  'Apply' {
    if ($Target -ne 'Production') { throw 'Apply mode is production-only.' }
    if ($env:CF_ALLOW_PRODUCTION_RELEASE_WRITES -ne 'I_UNDERSTAND_PRODUCTION_WRITE') {
      throw 'Production writes are disabled. Set the explicit release guard only in an approved release window.'
    }
    if (-not $BackupPath -or -not (Test-Path -LiteralPath $BackupPath)) {
      throw 'A verified fresh backup path is required before Apply mode.'
    }
    if (-not (Test-Path -LiteralPath $pgRestore)) { throw 'pg_restore.exe was not found.' }
    $toc = & $pgRestore --list $BackupPath 2>&1
    if ($LASTEXITCODE -ne 0 -or -not $toc) { throw 'The required backup did not pass pg_restore --list.' }

    # The product migration is applied as its own transaction. The compatibility
    # phase then runs in one transaction: security corrections, login_id
    # backfill, deterministic activation backfill, and count checks.
    Invoke-PsqlFile $productMigration
    Invoke-PsqlTransactionalFile $compatibilitySql 'COMMIT;'
    Invoke-PsqlFile $dryRunSql
    break
  }
}

Write-Output ("target={0} mode={1} complete" -f $Target, $Mode)
