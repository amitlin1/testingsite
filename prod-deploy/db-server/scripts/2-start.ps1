# ===========================================================================
# DB SERVER - step 2: start PostgreSQL + MinIO + backups
# ===========================================================================
#   .\scripts\2-start.ps1
#
# ON A FIRST RUN (empty data volume) postgres also:
#   - creates the `keycloak` role and database   (init\01-create-keycloak-db.sh)
#   - builds the full application schema         (init\02-app-schema.sql)
# Both are skipped on later runs - postgres only executes initdb.d on a volume
# it has never initialised. That is a postgres guarantee, not a choice here: it
# is what stops a restart from wiping a live database.
# ===========================================================================

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found. Run: copy .env.template .env   then edit it." }

    # Read the backup paths so we can create them before docker tries to mount
    # them - a missing host folder becomes an empty bind mount that silently
    # backs up to nowhere.
    $cfg = @{}
    foreach ($line in Get-Content ".env") {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $cfg[$t.Substring(0,$i).Trim()] = $t.Substring($i+1).Trim()
    }

    foreach ($key in @("BACKUP_FILES_PATH","BACKUP_PG_PATH")) {
        $p = $cfg[$key]
        if ($p -and -not (Test-Path $p)) {
            Write-Host "Creating backup folder $p" -ForegroundColor Yellow
            New-Item -ItemType Directory -Force -Path $p | Out-Null
        }
    }

    $isFirstRun = -not (docker volume ls -q | Select-String -Quiet "shifthouse-db_postgres-data")

    Write-Host ""
    Write-Host "=== DB SERVER: starting ===" -ForegroundColor Cyan
    if ($isFirstRun) {
        Write-Host "First run detected - postgres will create the keycloak database and" -ForegroundColor Yellow
        Write-Host "build the application schema. This takes a little longer than usual." -ForegroundColor Yellow
    }
    Write-Host ""

    docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed. Check the output above." }

    Write-Host ""
    docker compose ps

    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. .\scripts\4-check.ps1        verify both databases and the schema"
    Write-Host "  2. In DBeaver, against the '$($cfg['KEYCLOAK_DB_NAME'])' database:" -ForegroundColor Yellow
    Write-Host "       a. run keycloak-seed\keycloak-seed.sql"
    Write-Host "       b. edit the one marked line in keycloak-seed\fixup-after-restore.sql,"
    Write-Host "          set it to the APP server's URL, and run the whole file"
    Write-Host "     Without step 2 Keycloak has no realm and nobody can log in." -ForegroundColor Yellow
    Write-Host "  3. Only then set up the APP server."
    Write-Host ""
    Write-Host "FIREWALL: allow the APP SERVER's IP to reach ports $($cfg['POSTGRES_PORT']) and $($cfg['MINIO_PORT']) on this machine." -ForegroundColor Yellow
    Write-Host ""
}
finally {
    Pop-Location
}
