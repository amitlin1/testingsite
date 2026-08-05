# ===========================================================================
# Copy the deployment bundle to removable media
# ===========================================================================
#   .\scripts\sync-to-usb.ps1 -Destination E:\prod-deploy
#   .\scripts\sync-to-usb.ps1 -Destination E:\prod-deploy -WhatIf
#
# WHY THIS EXISTS RATHER THAN A PLAIN robocopy: robocopy has no notion of
# .gitignore, so a bare copy carries any .env sitting in the source tree - the
# real, filled-in one, with real passwords and the address of whichever machine
# it was last used on.
#
# That is worse than leaking the file. On the target machine 2-check-env.ps1
# would PASS it: every value is present and none of them is a placeholder. The
# deployment then comes up on the wrong address with someone else's passwords,
# and nothing anywhere reports a problem.
#
# So .env is excluded here, always. .env.template is what travels.
# ===========================================================================

param(
    # Where to copy to, e.g. E:\prod-deploy
    [Parameter(Mandatory = $true)]
    [string]$Destination,

    # List what would be copied and exit.
    [switch]$WhatIf
)

# NOT "Stop" - robocopy signals success with exit codes 0-7, and several of
# those are reported as failures by PowerShell's native-command handling.
$ErrorActionPreference = "Continue"

$src = Join-Path (Split-Path -Parent $PSScriptRoot) "prod-deploy"
if (-not (Test-Path $src)) { throw "Source not found: $src" }

$drive = Split-Path -Qualifier $Destination
if (-not (Test-Path $drive)) { throw "Drive $drive is not connected." }

Write-Host ""
Write-Host "=== Syncing the deployment bundle ===" -ForegroundColor Cyan
Write-Host "  from : $src"
Write-Host "  to   : $Destination"
Write-Host ""

# Refuse to ship a bundle whose seeds are missing - a partial copy on an
# air-gapped site means another trip with a USB stick.
foreach ($required in @(
    "db-server\keycloak-seed\keycloak-seed.sql",
    "db-server\settings-seed\settings-seed.sql",
    "db-server\init\02-app-schema.sql"
)) {
    if (-not (Test-Path (Join-Path $src $required))) { throw "Missing from the bundle: $required" }
}

$tars = Get-ChildItem $src -Recurse -Filter *.tar
if ($tars.Count -lt 6) {
    Write-Host "  WARNING: only $($tars.Count) image tar(s) found; expected 6." -ForegroundColor Yellow
    Write-Host "  Run .\scripts\build-airgap-bundle.ps1 first." -ForegroundColor Yellow
    Write-Host ""
}

# Report any .env that WOULD have been copied, so its absence on the target is
# a known decision rather than a surprise.
$envs = Get-ChildItem $src -Recurse -Force -Filter ".env" -ErrorAction SilentlyContinue
if ($envs) {
    Write-Host "  Excluding these (they hold real credentials):" -ForegroundColor Yellow
    $envs | ForEach-Object { Write-Host "    $($_.FullName.Substring($src.Length + 1))" -ForegroundColor Yellow }
    Write-Host "  The target gets .env.template and is filled in there." -ForegroundColor Gray
    Write-Host ""
}

if ($WhatIf) {
    $all = Get-ChildItem $src -Recurse -File | Measure-Object -Property Length -Sum
    Write-Host ("  Would copy {0} files, {1:N0} MB (minus the exclusions above)." -f $all.Count, ($all.Sum / 1MB))
    Write-Host ""
    return
}

# /XF .env      - never ship real credentials (the whole point of this script)
# no /MIR       - additive; will not delete anything already on the target
robocopy $src $Destination /E /XF ".env" /R:2 /W:2 /NFL /NDL /NP /MT:8
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -ge 8) { throw "robocopy reported failures (exit $rc). Nothing further checked." }

# Byte counts alone would miss an edit that happens to preserve file size, so
# compare content on everything except the multi-GB tars.
$diff = 0
Get-ChildItem $src -Recurse -File |
    Where-Object { $_.Extension -ne ".tar" -and $_.Name -ne ".env" -and $_.FullName -notmatch "\\dbeaver\\" } |
    ForEach-Object {
        $t = Join-Path $Destination $_.FullName.Substring($src.Length + 1)
        if (-not (Test-Path $t)) { Write-Host "  MISSING: $($_.Name)" -ForegroundColor Red; $diff++ }
        elseif ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $t).Hash) {
            Write-Host "  DIFFERS: $($_.Name)" -ForegroundColor Red; $diff++
        }
    }

$stray = Get-ChildItem $Destination -Recurse -Force -Filter ".env" -ErrorAction SilentlyContinue
if ($stray) {
    Write-Host ""
    Write-Host "  A .env is present on the destination from an earlier copy:" -ForegroundColor Red
    $stray | ForEach-Object { Write-Host "    $($_.FullName)" -ForegroundColor Red }
    Write-Host "  Delete it - the target must start from .env.template." -ForegroundColor Red
}

Write-Host ""
if ($diff -eq 0 -and -not $stray) {
    Write-Host "Bundle synced and content-verified." -ForegroundColor Green
} else {
    Write-Host "Sync finished with $diff content mismatch(es)." -ForegroundColor Red
}
Write-Host ""
