# Run from any machine with Git, Node, and pnpm (repo uses packageManager pnpm@10.x).
# 1) Pulls the requested branch (default: main).
# 2) Expects api/.env with DATABASE_URL pointing at the DB the API uses.
# 3) Installs API deps and runs prisma migrate deploy.
# 4) Reminds you to restart the API process.
param(
  [string]$Branch = "main",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Set-Location $RepoRoot

Write-Host "==> Repo: $RepoRoot"
Write-Host "==> git fetch && checkout $Branch && pull"

git fetch origin
git checkout $Branch
git pull origin $Branch

$envFile = Join-Path $RepoRoot "api\.env"
if (-not (Test-Path $envFile)) {
  Write-Error "Missing api\.env — create it and set DATABASE_URL to the same MariaDB/MySQL the API uses."
}

$dbLine = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' -ErrorAction SilentlyContinue
if (-not $dbLine) {
  Write-Warning "api\.env has no DATABASE_URL= line (check spelling / comments). Fix before deploy."
} else {
  Write-Host "==> Found DATABASE_URL in api\.env (value not shown). Confirm it targets the correct database."
}

$apiDir = Join-Path $RepoRoot "api"
Set-Location $apiDir

if (Get-Command corepack -ErrorAction SilentlyContinue) {
  corepack enable 2>$null
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm not on PATH. Install Node LTS, then: corepack enable && corepack prepare pnpm@10.32.1 --activate"
}

Write-Host "==> pnpm install (api)"
pnpm install

Write-Host "==> pnpm prisma:deploy (prisma migrate deploy)"
pnpm run prisma:deploy

Set-Location $RepoRoot
Write-Host ""
Write-Host "Done. Restart the API so Prisma reconnects (stop the API window/process, then start-prod / start-sandbox / your usual start command)."
