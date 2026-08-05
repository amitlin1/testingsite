# ===========================================================================
# DB SERVER - create the Keycloak database on an EXISTING install
# ===========================================================================
#   .\scripts\3-create-keycloak-db.ps1
#
# ONLY needed when postgres already has a data volume, so init\01-create-
# keycloak-db.sh never ran (postgres executes initdb.d only on a volume it has
# never initialised). On a fresh install this script has nothing to do.
#
# Idempotent - safe to run repeatedly.
# ===========================================================================

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found." }

    $cfg = @{}
    foreach ($line in Get-Content ".env") {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $cfg[$t.Substring(0,$i).Trim()] = $t.Substring($i+1).Trim()
    }

    $pgUser = $cfg["POSTGRES_USER"]
    $pgDb   = $cfg["POSTGRES_DB"]
    $kcUser = $cfg["KEYCLOAK_DB_USER"]
    $kcDb   = $cfg["KEYCLOAK_DB_NAME"]
    $kcPass = $cfg["KEYCLOAK_DB_PASSWORD"]

    if (-not $kcPass -or $kcPass -like "*CHANGE_ME*") {
        throw "KEYCLOAK_DB_PASSWORD is not set in .env."
    }

    Write-Host ""
    Write-Host "=== Creating Keycloak database '$kcDb' and role '$kcUser' ===" -ForegroundColor Cyan

    # Role - created only if absent, so an existing password is never clobbered.
    $roleSql = @"
DO `$`$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$kcUser') THEN
        CREATE ROLE $kcUser LOGIN PASSWORD '$kcPass';
        RAISE NOTICE 'created role $kcUser';
    ELSE
        RAISE NOTICE 'role $kcUser already exists - left unchanged';
    END IF;
END
`$`$;
"@
    $roleSql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the keycloak role." }

    # CREATE DATABASE cannot run inside a transaction or a DO block, so check
    # for it first and create it only when missing.
    $exists = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb `
                 -c "SELECT 1 FROM pg_database WHERE datname = '$kcDb';"
    if ("$exists".Trim() -eq "1") {
        Write-Host "  database '$kcDb' already exists - left unchanged" -ForegroundColor Yellow
    } else {
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb `
            -c "CREATE DATABASE $kcDb OWNER $kcUser;"
        if ($LASTEXITCODE -ne 0) { throw "Failed to create database $kcDb." }
        Write-Host "  created database '$kcDb'" -ForegroundColor Green
    }

    # PostgreSQL 15+ locks down the public schema; without this Keycloak's first
    # boot dies with a bare "permission denied for schema public".
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $kcDb `
        -c "GRANT ALL ON SCHEMA public TO $kcUser;"

    Write-Host ""
    Write-Host "Done. Keycloak will create its own tables on first boot." -ForegroundColor Green
    Write-Host "Set KC_DB_PASSWORD on the APP SERVER to this same password." -ForegroundColor Yellow
    Write-Host ""
}
finally {
    Pop-Location
}
