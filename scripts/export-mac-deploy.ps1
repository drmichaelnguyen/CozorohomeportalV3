$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host "[export-mac] $Message"
}

function Write-Utf8Lf([string]$Path, [string]$Content) {
  $normalized = $Content -replace "`r`n", "`n"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $normalized, $encoding)
}

function Get-EnvMap([string]$Path) {
  $result = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $result
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 0) {
      continue
    }

    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $result[$key] = $value
  }

  return $result
}

function Get-DatabaseInfo([string]$DatabaseUrl) {
  if (-not $DatabaseUrl) {
    return $null
  }

  $uri = [System.Uri]$DatabaseUrl
  $userInfo = $uri.UserInfo.Split(":", 2)

  return [pscustomobject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 3306 }
    User = if ($userInfo.Count -ge 1) { $userInfo[0] } else { "" }
    Password = if ($userInfo.Count -ge 2) { $userInfo[1] } else { "" }
    Name = $uri.AbsolutePath.TrimStart("/")
    IsLocal = @("127.0.0.1", "localhost") -contains $uri.Host
  }
}

function Find-MySqlDump() {
  $fromPath = Get-Command mysqldump.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $candidates = @(
    "C:\Program Files\MariaDB 12.2\bin\mysqldump.exe"
    "C:\Program Files\MariaDB 11.8\bin\mysqldump.exe"
    "C:\Program Files\MariaDB 11.4\bin\mysqldump.exe"
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  $scan = Get-ChildItem "C:\Program Files" -Recurse -Filter mysqldump.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

  if ($scan) {
    return $scan
  }

  throw "Unable to find mysqldump.exe. Install MySQL or MariaDB client tools first."
}

function Invoke-RoboCopy([string]$Source, [string]$Destination, [string[]]$ExcludedDirectories, [string[]]$ExcludedFiles) {
  $arguments = @($Source, $Destination, "/E", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")

  if ($ExcludedDirectories.Count -gt 0) {
    $arguments += "/XD"
    $arguments += $ExcludedDirectories
  }

  if ($ExcludedFiles.Count -gt 0) {
    $arguments += "/XF"
    $arguments += $ExcludedFiles
  }

  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = (Resolve-Path ".").Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "cozorohome-mac-deploy-$timestamp"
$artifactBase = Join-Path $repoRoot "temp\mac-deploy"
$stagingRoot = Join-Path $artifactBase $packageName
$zipPath = Join-Path $artifactBase "$packageName.zip"

Write-Step "Preparing staging folder"
Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingRoot "deploy-assets\database") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingRoot "deploy-assets\cloudflared") -Force | Out-Null

$excludeDirs = @(
  (Join-Path $repoRoot ".git"),
  (Join-Path $repoRoot ".agent"),
  (Join-Path $repoRoot ".claude"),
  (Join-Path $repoRoot ".codex-logs"),
  (Join-Path $repoRoot "temp"),
  (Join-Path $repoRoot "backups"),
  (Join-Path $repoRoot "node_modules"),
  (Join-Path $repoRoot "portal\.next"),
  (Join-Path $repoRoot "portal\node_modules"),
  (Join-Path $repoRoot "api\dist"),
  (Join-Path $repoRoot "api\node_modules"),
  (Join-Path $repoRoot "bot\dist"),
  (Join-Path $repoRoot "bot\node_modules"),
  (Join-Path $repoRoot "guest-booking-standalone\node_modules")
)
$excludeFiles = @("*.log", "*.tmp", "*.zip")

Write-Step "Copying repo contents"
Invoke-RoboCopy -Source $repoRoot -Destination $stagingRoot -ExcludedDirectories $excludeDirs -ExcludedFiles $excludeFiles

$apiEnv = Get-EnvMap (Join-Path $repoRoot "api\.env")
$portalEnv = Get-EnvMap (Join-Path $repoRoot "portal\.env.local")
$botEnv = Get-EnvMap (Join-Path $repoRoot "bot\.env")
$guestEnv = Get-EnvMap (Join-Path $repoRoot "guest-booking-standalone\.env")
$database = Get-DatabaseInfo $apiEnv["DATABASE_URL"]

if (-not $database) {
  throw "api/.env is missing DATABASE_URL, so the export cannot include the database."
}

$mysqldumpPath = Find-MySqlDump
$dbDumpPath = Join-Path $stagingRoot "deploy-assets\database\database.sql"

Write-Step "Dumping MySQL database"
$dumpArgs = @(
  "--single-transaction",
  "--routines",
  "--triggers",
  "--events",
  "--host=$($database.Host)",
  "--port=$($database.Port)",
  "--user=$($database.User)"
)

if ($database.Password) {
  $dumpArgs += "--password=$($database.Password)"
}

$dumpArgs += "--databases"
$dumpArgs += $database.Name

& $mysqldumpPath @dumpArgs | Set-Content -LiteralPath $dbDumpPath -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
  throw "mysqldump failed with exit code $LASTEXITCODE"
}

$cloudflareSource = Join-Path $env:USERPROFILE ".cloudflared"
$cloudflareConfigPath = Join-Path $cloudflareSource "config.yml"
if (-not (Test-Path -LiteralPath $cloudflareConfigPath)) {
  throw "Cloudflare config not found at $cloudflareConfigPath"
}

$cloudflareConfig = Get-Content -LiteralPath $cloudflareConfigPath -Raw
$tunnelId = ""
$credentialsFile = ""
foreach ($line in ($cloudflareConfig -split "`r?`n")) {
  if ($line -match '^\s*tunnel:\s*(.+)\s*$') {
    $tunnelId = $Matches[1].Trim()
  }
  if ($line -match '^\s*credentials-file:\s*(.+)\s*$') {
    $credentialsFile = $Matches[1].Trim()
  }
}

if (-not $tunnelId -or -not $credentialsFile) {
  throw "Could not parse tunnel id and credentials-file from $cloudflareConfigPath"
}

$credentialBasename = Split-Path $credentialsFile -Leaf

Write-Step "Copying Cloudflare tunnel assets"
Copy-Item -LiteralPath $cloudflareConfigPath -Destination (Join-Path $stagingRoot "deploy-assets\cloudflared\config.source.yml")
Copy-Item -LiteralPath $credentialsFile -Destination (Join-Path $stagingRoot "deploy-assets\cloudflared\$credentialBasename")
if (Test-Path -LiteralPath (Join-Path $cloudflareSource "cert.pem")) {
  Copy-Item -LiteralPath (Join-Path $cloudflareSource "cert.pem") -Destination (Join-Path $stagingRoot "deploy-assets\cloudflared\cert.pem")
}

$configTemplate = $cloudflareConfig -replace [regex]::Escape($credentialsFile), "__CREDENTIALS_FILE__"
Write-Utf8Lf -Path (Join-Path $stagingRoot "deploy-assets\cloudflared\config.template.yml") -Content $configTemplate

$manifestPath = Join-Path $stagingRoot "deploy-assets\deploy-manifest.env"
$manifestLines = @(
  "PACKAGE_CREATED_AT=$((Get-Date).ToUniversalTime().ToString('s'))Z"
  "API_PORT=$($apiEnv["PORT"])"
  "PORTAL_PORT=$($portalEnv["PORT"])"
  "BOT_PORT=$($botEnv["PORT"])"
  "GUEST_BOOKING_PORT=$($guestEnv["PORT"])"
  "DATABASE_HOST=$($database.Host)"
  "DATABASE_PORT=$($database.Port)"
  "DATABASE_NAME=$($database.Name)"
  "DATABASE_USER=$($database.User)"
  "DATABASE_PASSWORD=$($database.Password)"
  "REQUIRES_LOCAL_MYSQL=$($(if ($database.IsLocal) { 'true' } else { 'false' }))"
  "CLOUDFLARED_TUNNEL_ID=$tunnelId"
  "CLOUDFLARED_CREDENTIALS_BASENAME=$credentialBasename"
)
Write-Utf8Lf -Path $manifestPath -Content ($manifestLines -join "`n")

Write-Step "Creating Mac launcher files"
$launchTemplate = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\mac-bootstrap-launch.sh") -Raw
$stopTemplate = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\mac-stop.sh") -Raw
Write-Utf8Lf -Path (Join-Path $stagingRoot "launch-on-mac.command") -Content $launchTemplate
Write-Utf8Lf -Path (Join-Path $stagingRoot "stop-on-mac.command") -Content $stopTemplate
Write-Utf8Lf -Path (Join-Path $stagingRoot "RUN-ON-MAC.txt") -Content @"
On the Mac:
1. Unzip this package.
2. Open Terminal in the extracted folder.
3. Run:
   bash ./launch-on-mac.command

To stop the stack later:
   bash ./stop-on-mac.command
"@

Write-Step "Writing export summary"
$summary = [pscustomobject]@{
  packageName = $packageName
  createdAt = (Get-Date).ToString("s")
  zipPath = $zipPath
  databaseDump = $dbDumpPath
  tunnelId = $tunnelId
  apiPort = $apiEnv["PORT"]
  portalPort = $portalEnv["PORT"]
  botPort = $botEnv["PORT"]
  guestBookingPort = $guestEnv["PORT"]
}
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingRoot "deploy-assets\export-summary.json") -Encoding UTF8

Write-Step "Compressing zip archive"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Step "Done"
Write-Host ""
Write-Host "Zip package created at:"
Write-Host $zipPath
