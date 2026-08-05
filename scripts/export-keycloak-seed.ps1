# ===========================================================================
# Export the DEV Keycloak database as a SQL seed  (run on the CONNECTED machine)
# ===========================================================================
#   .\scripts\export-keycloak-seed.ps1
#
# Produces prod-deploy\db-server\keycloak-seed\keycloak-seed.sql - a complete
# pg_dump of the development Keycloak database, restorable in DBeaver.
#
# ---------------------------------------------------------------------------
# THIS IS THE ALTERNATIVE PATH, NOT THE DEFAULT ONE
# ---------------------------------------------------------------------------
# The default install imports keycloak\testing-realm.template.json instead (see
# prod-deploy\README.md). Reach for this seed only when you want production to be
# a byte-exact clone of dev - including existing user accounts and their password
# hashes, which a realm JSON export does not carry.
#
# What you take on by using it:
#   * The dump encodes Keycloak 26.7.0's INTERNAL schema - 100 tables. It can
#     only be restored into the same Keycloak version.
#   * It carries DEV DATA: test users with known passwords, localhost redirect
#     URIs, dev client secrets. fixup-after-restore.sql must be run right after,
#     or production ships with known credentials on it.
#   * It contains password hashes and client secrets. Treat the output like a
#     password file: never commit it, and delete it once deployed.
#
# The output is written to a folder that .gitignore excludes.
# ===========================================================================

$ErrorActionPreference = "Stop"

$repoRoot  = Split-Path -Parent $PSScriptRoot
$outDir    = Join-Path $repoRoot "prod-deploy\db-server\keycloak-seed"
$outFile   = Join-Path $outDir "keycloak-seed.sql"

# The dev Keycloak database container (docker-compose.keycloak.yml).
$container = "keycloak-db"
$dbUser    = "keycloak"
$dbName    = "keycloak"

Write-Host ""
Write-Host "=== Exporting the DEV Keycloak database ===" -ForegroundColor Cyan
Write-Host ""

$state = docker inspect -f '{{.State.Status}}' $container 2>$null
if ($state -ne "running") {
    throw "Container '$container' is not running. Start the dev Keycloak stack first:`n" +
          "  docker compose -f docker-compose.keycloak.yml up -d"
}

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

Write-Host "Dumping $dbName from $container ..." -ForegroundColor Yellow

# --clean --if-exists so the file can be restored over a partially-populated
# database. --no-owner --no-privileges so it restores under whatever role the
# target uses, instead of demanding the dev role names exist there.
docker exec $container pg_dump -U $dbUser -d $dbName `
    --clean --if-exists --no-owner --no-privileges |
    Out-File -FilePath $outFile -Encoding utf8

if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }

$sizeKb = (Get-Item $outFile).Length / 1KB
Write-Host ""
Write-Host ("Wrote {0} ({1:N0} KB)" -f $outFile, $sizeKb) -ForegroundColor Green
Write-Host ""
Write-Host "CONTAINS SECRETS - password hashes and client secrets." -ForegroundColor Red
Write-Host "Do not commit it. Delete it from both machines once the deploy is done." -ForegroundColor Red
Write-Host ""
Write-Host "On the DB server, in DBeaver, against the keycloak database:" -ForegroundColor Cyan
Write-Host "  1. stop the Keycloak container on the app server"
Write-Host "  2. run keycloak-seed.sql"
Write-Host "  3. run fixup-after-restore.sql   <-- MANDATORY, edit its top block first"
Write-Host "  4. start Keycloak"
Write-Host ""
