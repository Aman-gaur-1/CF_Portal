param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$expectedProjectRef = 'bgpmsckjvutnqkryxknb'
$productionProjectRef = 'hktpncjuflynwdikmbfl'
$expectedHost = "$expectedProjectRef.supabase.co"

function Read-DotEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$OnlyKeys = @()
  )

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      continue
    }

    $key = $Matches[1]
    if ($OnlyKeys.Count -gt 0 -and $OnlyKeys -notcontains $key) {
      continue
    }

    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Set-ProcessValues {
  param([hashtable]$Values)
  foreach ($entry in $Values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
}

$siblingStagingEnv = Join-Path (Split-Path -Parent $repoRoot) 'CF_Portal\.env.staging.local'
$worktreeStagingEnv = Join-Path $repoRoot '.env.staging.local'
$stagingEnvPath = if ($env:CF_PORTAL_STAGING_ENV_FILE) {
  [Environment]::ExpandEnvironmentVariables($env:CF_PORTAL_STAGING_ENV_FILE)
} elseif (Test-Path -LiteralPath $worktreeStagingEnv) {
  $worktreeStagingEnv
} else {
  $siblingStagingEnv
}

if (-not (Test-Path -LiteralPath $stagingEnvPath -PathType Leaf)) {
  throw "Staging env file was not found. Set CF_PORTAL_STAGING_ENV_FILE to an ignored staging env file."
}

if ($stagingEnvPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  $ignored = git -C $repoRoot check-ignore --quiet -- $stagingEnvPath
  if ($LASTEXITCODE -ne 0) {
    throw 'The staging env file inside the worktree must be git-ignored.'
  }
}

$stagingRaw = Get-Content -LiteralPath $stagingEnvPath -Raw
$stagingValues = Read-DotEnv -Path $stagingEnvPath
$stagingUrl = $stagingValues['NEXT_PUBLIC_SUPABASE_URL']
if (-not $stagingUrl) {
  throw 'Staging env is missing NEXT_PUBLIC_SUPABASE_URL.'
}

$stagingUri = [Uri]$stagingUrl
if ($stagingUri.Host -ne $expectedHost) {
  throw "Refusing to start: staging env does not point to the expected staging project."
}
if ($stagingRaw.Contains($productionProjectRef)) {
  throw 'Refusing to start: staging env contains the production project ref.'
}
if (-not $stagingValues['SUPABASE_SERVICE_KEY'] -and -not $stagingValues['SUPABASE_SERVICE_ROLE_KEY']) {
  throw 'Staging env is missing a server-side Supabase service key.'
}

# Clear potentially inherited or production database/integration values first.
foreach ($key in @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_DATABASE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'SUPABASE_DB_URL',
  'QWEN_API_KEY',
  'APIFY_TOKEN'
)) {
  [Environment]::SetEnvironmentVariable($key, $null, 'Process')
}

Set-ProcessValues -Values $stagingValues

# Auth credentials/secrets are local application settings, not database targets.
$localEnvPath = Join-Path $repoRoot '.env.local'
if (Test-Path -LiteralPath $localEnvPath -PathType Leaf) {
  Set-ProcessValues -Values (Read-DotEnv -Path $localEnvPath -OnlyKeys @(
    'ADMIN_CREDENTIALS',
    'TEACHER_CREDENTIALS',
    'ADMIN_SESSION_SECRET',
    'TEACHER_SESSION_SECRET',
    'STUDENT_SESSION_SECRET'
  ))
}

# Reassert the target after loading local auth settings and make the guard visible.
[Environment]::SetEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL', $stagingUrl, 'Process')
Write-Output "STAGING_ENV_CONFIGURED project_ref=$expectedProjectRef"
Write-Output 'PRODUCTION_DATABASE_TARGET_BLOCKED=true'

npm run dev -- -p $Port
exit $LASTEXITCODE
