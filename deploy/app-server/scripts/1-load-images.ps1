# ===========================================================================
# APP SERVER - step 1: load the pre-built container images
# ===========================================================================
# Run ONCE, from anywhere:  .\scripts\1-load-images.ps1
#
# Every image was built on the connected machine and shipped as a tar in
# ..\images. Nothing is downloaded - this machine has no internet.
# Safe to re-run: `docker load` simply replaces the tag.
# ===========================================================================

# NOT "Stop". docker writes ordinary progress to stderr - "Network ... Creating",
# layer output from `docker load` - and Windows PowerShell 5.1 wraps a native
# command's stderr in an ErrorRecord, which "Stop" turns into a crash. It fires
# only when docker happens to have something to say, so it looks intermittent:
# the same script passes on a second run once the network already exists.
# Every docker call that matters is checked via $LASTEXITCODE, and `throw` stays
# terminating regardless of this setting.
$ErrorActionPreference = "Continue"

# Resolve paths relative to THIS script, so the working directory doesn't matter.
$root      = Split-Path -Parent $PSScriptRoot
$imagesDir = Join-Path $root "images"

Write-Host ""
Write-Host "=== APP SERVER: loading container images ===" -ForegroundColor Cyan
Write-Host ""

try { docker version --format '{{.Server.Version}}' | Out-Null }
catch { throw "Docker is not running. Start Docker Desktop and re-run this script." }

if (-not (Test-Path $imagesDir)) { throw "Missing images folder: $imagesDir" }

$tars = Get-ChildItem -Path $imagesDir -Filter *.tar | Sort-Object Length
if (-not $tars) { throw "No .tar files found in $imagesDir" }

$total = ($tars | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host ("Found {0} image(s), {1:N2} GB total. The OnlyOffice image is the slow one." -f $tars.Count, $total)
Write-Host ""

foreach ($tar in $tars) {
    $sizeMb = $tar.Length / 1MB
    Write-Host ("-> {0} ({1:N0} MB)" -f $tar.Name, $sizeMb) -ForegroundColor Yellow
    docker load -i $tar.FullName
    if ($LASTEXITCODE -ne 0) { throw "docker load failed for $($tar.Name)" }
}

Write-Host ""
Write-Host "=== Loaded images ===" -ForegroundColor Cyan
docker images --format "{{.Repository}}:{{.Tag}}`t{{.Size}}" |
    Select-String -Pattern "testingsite-next-app|testingsite-nginx|keycloak-optimized|onlyoffice/documentserver"

Write-Host ""
Write-Host "Next: copy .env.template to .env, edit it, then run scripts\2-prepare.ps1" -ForegroundColor Green
Write-Host ""
