# Applies the 2026-06-04 schema update: file_objects.updated_by column.
#
# Run this on the DB server AFTER 2-start.ps1, BEFORE the app server is upgraded.
# If you're doing a FRESH install, you don't need this — schema.sql (if present)
# already creates file_objects with the column. This script is only for EXISTING
# DBs that were created before 2026-06-04.
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")
$mig = Join-Path $dir "migrations\2026-06-04_add_updated_by_to_file_objects.sql"
$envdb = Join-Path $dir ".env.db"

if (-not (Test-Path $mig))   { Write-Host "STOP: migration file not found at $mig" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $envdb)) { Write-Host "STOP: .env.db not found" -ForegroundColor Red; exit 1 }

# Already applied?  Idempotency check: information_schema knows the column name
$envLines = Get-Content $envdb | Where-Object { $_ -match "^\s*[^#].*=" }
$envMap = @{}
foreach ($l in $envLines) { $k,$v = $l -split "=",2; $envMap[$k.Trim()] = $v.Trim() }
$dbUser = $envMap["POSTGRES_USER"]
$dbName = $envMap["POSTGRES_DB"]

$check = docker exec postgres psql -U $dbUser -d $dbName -tAc `
    "SELECT 1 FROM information_schema.columns WHERE table_name='file_objects' AND column_name='updated_by'"
if ($check -match "1") {
    Write-Host "Column file_objects.updated_by already exists — nothing to do." -ForegroundColor Yellow
    exit 0
}

Write-Host "Applying migration..." -ForegroundColor Cyan
Get-Content $mig -Raw | docker exec -i postgres psql -U $dbUser -d $dbName

Write-Host "`nMigration applied. Verifying..." -ForegroundColor Green
docker exec postgres psql -U $dbUser -d $dbName -c "\d file_objects" | Select-String "updated_by"
