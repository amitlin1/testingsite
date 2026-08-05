# ===========================================================================
# DB SERVER - STEP 5: restore the Keycloak realm into the keycloak database
# ===========================================================================
#   .\scripts\5-seed-keycloak.ps1
#   .\scripts\5-seed-keycloak.ps1 -Force      # wipe an existing schema, no prompt
#
# Runs keycloak-seed\keycloak-seed.sql through psql INSIDE the postgres
# container. Do NOT use DBeaver for this file - its SQL editor has its own
# parser and mangles two things pg_dump output legitimately contains:
#
#   1. psql meta-commands (\restrict / \unrestrict) - stripped from our copy,
#      but any freshly generated dump will have them again.
#   2. ${...} sequences. Keycloak stores i18n keys like
#      ${offlineAccessScopeConsentText} as ordinary data; DBeaver treats them as
#      its OWN variables and pops a "Bind parameter(s)" dialog. Clicking OK
#      substitutes EMPTY STRINGS and corrupts the realm silently - no error, and
#      you only find out when consent screens render blank.
#
# psql has neither behaviour: the file is executed exactly as written.
#
# Next: .\scripts\6-fixup-keycloak.ps1 -AppUrl http://<APP-SERVER-IP>
# ===========================================================================

param(
    # Drop an existing public schema without asking.
    [switch]$Force
)

# NOT "Stop". psql writes NOTICE lines to stderr as normal operation (DROP
# SCHEMA CASCADE always does), and Windows PowerShell 5.1 wraps a native
# command's stderr in an ErrorRecord - which "Stop" then turns into a crash
# mid-restore. Every docker call below is checked explicitly via $LASTEXITCODE,
# and `throw` stays terminating regardless of this setting.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found. Copy .env.template to .env first." }

    $seedFile = Join-Path $root "keycloak-seed\keycloak-seed.sql"
    if (-not (Test-Path $seedFile)) { throw "Not found: $seedFile" }

    $cfg = @{}
    foreach ($line in Get-Content ".env") {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $cfg[$t.Substring(0,$i).Trim()] = $t.Substring($i+1).Trim()
    }
    $pgUser = $cfg["POSTGRES_USER"]
    $kcDb   = $cfg["KEYCLOAK_DB_NAME"]; if (-not $kcDb) { $kcDb = "keycloak" }
    $kcUser = $cfg["KEYCLOAK_DB_USER"]; if (-not $kcUser) { $kcUser = "keycloak" }
    if (-not $pgUser) { throw "POSTGRES_USER is not set in .env." }

    Write-Host ""
    Write-Host "=== STEP 5: seeding the Keycloak realm into '$kcDb' ===" -ForegroundColor Cyan
    Write-Host ""

    # ---- preflight -------------------------------------------------------
    $state = docker inspect -f '{{.State.Status}}' postgres 2>$null
    if ("$state".Trim() -ne "running") {
        throw "The 'postgres' container is not running. Run .\scripts\2-start.ps1 first."
    }

    $dbThere = docker compose exec -T postgres psql -tAX -U $pgUser -d postgres `
                  -c "SELECT 1 FROM pg_database WHERE datname='$kcDb';"
    if ("$dbThere".Trim() -ne "1") {
        throw "Database '$kcDb' does not exist. Run .\scripts\3-create-keycloak-db.ps1 first."
    }

    # The fixup in step 6 re-owns every table to this role, so it must exist
    # BEFORE we start - failing here is far cheaper than failing after a restore.
    $roleThere = docker compose exec -T postgres psql -tAX -U $pgUser -d postgres `
                    -c "SELECT 1 FROM pg_roles WHERE rolname='$kcUser';"
    if ("$roleThere".Trim() -ne "1") {
        throw "Login role '$kcUser' does not exist. Run .\scripts\3-create-keycloak-db.ps1 first."
    }

    # ---- an earlier attempt may have left a partial schema behind ---------
    $tables = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
                 -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
    $n = 0; [int]::TryParse("$tables".Trim(), [ref]$n) | Out-Null

    if ($n -gt 0) {
        Write-Host "  '$kcDb' already holds $n table(s)." -ForegroundColor Yellow
        Write-Host "  Restoring on top of them fails with 'already exists' errors." -ForegroundColor Yellow
        Write-Host ""
        if (-not $Force) {
            Write-Host "  This database is for Keycloak only, so dropping its schema is safe" -ForegroundColor DarkGray
            Write-Host "  UNLESS Keycloak is already live here with real users." -ForegroundColor DarkGray
            $answer = Read-Host "  Drop the public schema and restore clean? (yes/no)"
            if ($answer -ne "yes") { Write-Host "Aborted - nothing changed." -ForegroundColor Yellow; return }
        }
        Write-Host "  dropping schema..." -ForegroundColor Yellow
        # client_min_messages silences the "drop cascades to 100 other objects"
        # NOTICE, which is noise here and lands on stderr.
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $kcDb `
            -c "SET client_min_messages TO WARNING; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $kcUser;" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to drop the public schema." }
        Write-Host "  schema reset." -ForegroundColor Green
        Write-Host ""
    }

    # ---- restore ---------------------------------------------------------
    # Copied INTO the container rather than piped: piping through PowerShell
    # re-encodes the stream, and this file carries UTF-8 (Hebrew display names,
    # theme strings). A byte-for-byte copy cannot corrupt them.
    Write-Host "  copying seed into the container..." -ForegroundColor Gray
    docker cp "$seedFile" postgres:/tmp/keycloak-seed.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }

    Write-Host "  restoring (silence means success)..." -ForegroundColor Gray
    # ON_ERROR_STOP=1 - stop at the FIRST error instead of ploughing on and
    # leaving a half-populated realm that looks like it worked.
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $kcDb -q -f /tmp/keycloak-seed.sql
    if ($LASTEXITCODE -ne 0) { throw "Restore FAILED. Nothing further has run; fix the error above and re-run." }

    docker compose exec -T postgres rm -f /tmp/keycloak-seed.sql 2>$null | Out-Null

    # ---- verify ----------------------------------------------------------
    Write-Host ""
    Write-Host "=== what landed ===" -ForegroundColor Cyan
    $verify = @"
SELECT 'tables'        AS item, count(*)::text FROM information_schema.tables WHERE table_schema='public'
UNION ALL SELECT 'realm',        COALESCE(max(name),'MISSING') FROM realm WHERE name='testing'
UNION ALL SELECT 'login theme',  COALESCE(max(login_theme),'(none)') FROM realm WHERE name='testing'
UNION ALL SELECT 'clients',      string_agg(client_id,', ' ORDER BY client_id) FROM client WHERE client_id IN ('testing-web','testing-admin-api')
UNION ALL SELECT 'client secrets', count(*)::text FROM client WHERE client_id IN ('testing-web','testing-admin-api') AND secret IS NOT NULL
UNION ALL SELECT 'roles',        string_agg(name,', ' ORDER BY name) FROM keycloak_role WHERE name IN ('manager','tester','storekeeper','mashan')
UNION ALL SELECT 'accounts',     string_agg(username,', ' ORDER BY username) FROM user_entity WHERE username NOT LIKE 'service-account-%'
UNION ALL SELECT 'passwords',    count(*)::text FROM credential WHERE type='password';
"@
    $verify | docker compose exec -T postgres psql -U $pgUser -d $kcDb

    # 'client secrets' must be 2. The secrets live in the database, which is why
    # the app's .env values work as-is with nothing to regenerate by hand.
    $secrets = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
                  -c "SELECT count(*) FROM client WHERE client_id IN ('testing-web','testing-admin-api') AND secret IS NOT NULL;"
    if ("$secrets".Trim() -ne "2") {
        Write-Host ""
        Write-Host "WARNING: expected 2 client secrets, found '$("$secrets".Trim())'." -ForegroundColor Red
        Write-Host "The app will fail to authenticate. Re-run this script." -ForegroundColor Red
        Write-Host ""
        return
    }

    Write-Host ""
    Write-Host "Seed restored." -ForegroundColor Green
    Write-Host "Every URL in it still says localhost - step 6 rewrites them." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Next:  .\scripts\6-fixup-keycloak.ps1 -AppUrl http://<APP-SERVER-IP>" -ForegroundColor Cyan
    Write-Host ""
}
finally {
    Pop-Location
}
