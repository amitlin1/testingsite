# scripts/refresh-offline-cache.ps1
# Updates the offline NPM cache for Docker builds.
# INCREMENTAL: keeps existing node_modules, only updates the cache.

$ErrorActionPreference = "Stop"

Write-Host "Starting Offline Cache Refresh (Incremental)..." -ForegroundColor Cyan

# Define paths
$ProjectRoot = Get-Location
$TempCacheDir = Join-Path $ProjectRoot ".temp-npm-cache"
$OfflineCacheDir = Join-Path $ProjectRoot ".npm-offline"

# 1. Prepare Temp Cache dir (keep it if exists to allow resume)
Write-Host "1. Preparing temporary cache at $TempCacheDir..." -ForegroundColor Yellow
if (-not (Test-Path $TempCacheDir)) {
    New-Item -ItemType Directory -Force -Path $TempCacheDir | Out-Null
}

# 2. Install/update dependencies using the temp cache
# Does NOT delete node_modules - npm will only download what's missing
Write-Host "2. Running npm install (incremental - only downloads missing packages)..." -ForegroundColor Yellow
$env:npm_config_cache = $TempCacheDir
npm install --prefer-offline

if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed. Retrying once..." -ForegroundColor DarkYellow
    npm install --prefer-offline
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install failed after retry!"
        $env:npm_config_cache = ""
        exit 1
    }
}

# 3. Copy new/updated packages to Offline Directory (merge, don't replace all)
Write-Host "3. Merging into .npm-offline directory..." -ForegroundColor Yellow
if (-not (Test-Path $OfflineCacheDir)) {
    New-Item -ItemType Directory -Force -Path $OfflineCacheDir | Out-Null
}

# Use robocopy for efficient incremental sync (only copies new/changed files)
robocopy "$TempCacheDir" "$OfflineCacheDir" /E /NJH /NJS /NDL /NC /NS /XO 2>&1 | Out-Null
# robocopy exit codes 0-7 are success
if ($LASTEXITCODE -gt 7) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit 1
}

# 4. Cleanup
Write-Host "4. Cleaning up temporary cache..." -ForegroundColor Yellow
$env:npm_config_cache = ""
Remove-Item -Recurse -Force $TempCacheDir

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "Success! Offline cache updated in .npm-offline" -ForegroundColor Green
Write-Host "You can now build the Docker image offline." -ForegroundColor Green
Write-Host "---------------------------------------------------" -ForegroundColor Green
