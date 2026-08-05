# ===========================================================================
# DB SERVER - step 1: load the pre-built container images
# ===========================================================================
# Run ONCE:  .\scripts\1-load-images.ps1
# Safe to re-run.
# ===========================================================================

$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot
$imagesDir = Join-Path $root "images"

Write-Host ""
Write-Host "=== DB SERVER: loading container images ===" -ForegroundColor Cyan
Write-Host ""

try { docker version --format '{{.Server.Version}}' | Out-Null }
catch { throw "Docker is not running. Start Docker Desktop and re-run this script." }

if (-not (Test-Path $imagesDir)) { throw "Missing images folder: $imagesDir" }

$tars = Get-ChildItem -Path $imagesDir -Filter *.tar | Sort-Object Length
if (-not $tars) { throw "No .tar files found in $imagesDir" }

foreach ($tar in $tars) {
    Write-Host ("-> {0} ({1:N0} MB)" -f $tar.Name, ($tar.Length / 1MB)) -ForegroundColor Yellow
    docker load -i $tar.FullName
    if ($LASTEXITCODE -ne 0) { throw "docker load failed for $($tar.Name)" }
}

Write-Host ""
Write-Host "=== Loaded images ===" -ForegroundColor Cyan
docker images --format "{{.Repository}}:{{.Tag}}`t{{.Size}}" |
    Select-String -Pattern "postgres|minio/minio"

Write-Host ""
Write-Host "Next: copy .env.template to .env, edit it, then run scripts\2-start.ps1" -ForegroundColor Green
Write-Host ""
