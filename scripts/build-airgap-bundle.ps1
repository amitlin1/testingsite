# ===========================================================================
# Rebuild every image and refresh the air-gap tars   (CONNECTED machine only)
# ===========================================================================
#   .\scripts\build-airgap-bundle.ps1
#   .\scripts\build-airgap-bundle.ps1 -Only nginx
#
# Rebuilds the three images we own, pulls nothing, and writes every tar into
# prod-deploy\*\images\. Run it after changing application code, nginx.conf or
# the Keycloak Dockerfile - the tars are what actually ships, so a source edit
# that is not rebuilt changes nothing on the target machine.
#
# The two third-party images (postgres, minio) and onlyoffice are only re-saved,
# never re-pulled, so this works without internet as long as they are already in
# the local image store.
# ===========================================================================

param(
    # Limit the run to one component: next-app | nginx | keycloak | save-only
    [string]$Only = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appImages = Join-Path $repoRoot "prod-deploy\app-server\images"
$dbImages  = Join-Path $repoRoot "prod-deploy\db-server\images"

Push-Location $repoRoot
try {
    # Fail early and clearly if the daemon is wedged. `docker version` can answer
    # while `docker run`/`build` hang, so probe with something that actually
    # starts a container - otherwise a broken daemon looks like a slow build.
    Write-Host ""
    Write-Host "Checking Docker..." -ForegroundColor Cyan
    $probe = Start-Job { docker run --rm alpine:latest true 2>&1 }
    if (-not (Wait-Job $probe -Timeout 90)) {
        Stop-Job $probe; Remove-Job $probe -Force
        throw "Docker cannot start containers (timed out). Restart Docker Desktop and re-run."
    }
    Receive-Job $probe | Out-Null
    Remove-Job $probe -Force
    Write-Host "  Docker is healthy." -ForegroundColor Green

    function Build-Image($name, $tag, $dockerfile, $context) {
        Write-Host ""
        Write-Host "=== Building $tag ===" -ForegroundColor Cyan
        docker build -t $tag -f $dockerfile $context
        if ($LASTEXITCODE -ne 0) { throw "build failed for $tag" }
    }

    function Save-Image($tag, $outFile) {
        Write-Host "  saving $tag -> $(Split-Path -Leaf $outFile)" -ForegroundColor Yellow
        docker save $tag -o $outFile
        if ($LASTEXITCODE -ne 0) { throw "docker save failed for $tag" }
    }

    $doAll = ($Only -eq "")

    if ($doAll -or $Only -eq "next-app") {
        Build-Image "next-app" "testingsite-next-app:latest" "Dockerfile" "."
    }
    if ($doAll -or $Only -eq "nginx") {
        Build-Image "nginx" "testingsite-nginx:latest" "nginx/Dockerfile" "nginx"
    }
    if ($doAll -or $Only -eq "keycloak") {
        # Bakes in the shifthouse theme AND KC_HTTP_RELATIVE_PATH=/auth, both of
        # which are build-time in Keycloak and cannot be set at runtime.
        Build-Image "keycloak" "keycloak-optimized:26.7.0" "keycloak/Dockerfile.prod" "keycloak"
    }

    Write-Host ""
    Write-Host "=== Saving tars ===" -ForegroundColor Cyan
    if (-not (Test-Path $appImages)) { New-Item -ItemType Directory -Force -Path $appImages | Out-Null }
    if (-not (Test-Path $dbImages))  { New-Item -ItemType Directory -Force -Path $dbImages  | Out-Null }

    if ($doAll -or $Only -eq "next-app" -or $Only -eq "save-only") {
        Save-Image "testingsite-next-app:latest" (Join-Path $appImages "next-app.tar")
    }
    if ($doAll -or $Only -eq "nginx" -or $Only -eq "save-only") {
        Save-Image "testingsite-nginx:latest" (Join-Path $appImages "nginx.tar")
    }
    if ($doAll -or $Only -eq "keycloak" -or $Only -eq "save-only") {
        Save-Image "keycloak-optimized:26.7.0" (Join-Path $appImages "keycloak.tar")
    }
    if ($doAll -or $Only -eq "save-only") {
        # Third-party, never rebuilt - just re-exported from the local store.
        Save-Image "onlyoffice/documentserver:latest" (Join-Path $appImages "onlyoffice.tar")
        Save-Image "postgres:16-alpine" (Join-Path $dbImages "postgres-16-alpine.tar")
        Save-Image "minio/minio:latest" (Join-Path $dbImages "minio.tar")
    }

    Write-Host ""
    Write-Host "=== Bundle ===" -ForegroundColor Cyan
    Get-ChildItem $appImages, $dbImages -Filter *.tar |
        Select-Object @{n="folder";e={Split-Path (Split-Path $_.FullName) -Leaf}},
                      Name,
                      @{n="MB";e={[math]::Round($_.Length/1MB)}},
                      LastWriteTime |
        Format-Table -AutoSize

    Write-Host "Done. Copy prod-deploy\ to the target machines." -ForegroundColor Green
    Write-Host ""
}
finally {
    Pop-Location
}
