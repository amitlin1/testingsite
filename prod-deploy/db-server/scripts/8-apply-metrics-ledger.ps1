# ===========================================================================
# DB SERVER - STEP 8: apply the metrics-ledger migration (migration A)
# ===========================================================================
#   .\scripts\8-apply-metrics-ledger.ps1
#
# Release 2, USB trip #1. Applies the ADDITIVE metrics-ledger schema
# (migration 20260825000000_metrics_ledger_additive) to an EXISTING data
# volume, then runs the Tier-1 backfill so the ledger starts aligned with
# item_routes. init\02-app-schema.sql only runs on a FRESH volume, so an
# upgraded site needs this script instead.
#
# What it does, in order:
#   1. THREE pre-flight reports: orphan item_routes rows, duplicate
#      testing_routes(item_type_id, route_number), finished_at < created_at
#      (plus an informational report of rows the backfill cannot seed a
#      station for). Duplicates ABORT: the migration's unique index would
#      fail under ON_ERROR_STOP anyway - better to stop with the list.
#   2. Applies metrics-ledger\migration.sql   (psql -v ON_ERROR_STOP=1)
#   3. Runs metrics-ledger\tier1_backfill.sql (Tier-1 backfill, which also
#      does ENABLE TRIGGER trg_metrics_drift as its last statement)
#   4. Prints the backfill verification counts and metrics_selfcheck()
#   5. VALIDATE CONSTRAINT ir_item_fk - a SEPARATE, operator-confirmed step.
#      The FK is created NOT VALID because orphan item_routes rows are known
#      to exist on the production volume; validation fails until they are
#      resolved, so it must not be allowed to sink the whole migration.
#   6. Writes the _prisma_migrations bookkeeping row itself, so a future
#      `prisma migrate deploy` from a connected machine does not re-apply
#      the migration. (Same pattern as the tail of init\02-app-schema.sql.)
#
# Every statement in both SQL files is idempotent (IF NOT EXISTS / OR REPLACE
# / ON CONFLICT DO NOTHING), so re-running this script is safe - that is also
# why the Tier-1 step is deliberately re-run during the release-2 app-server
# cutover, to cover items created in the window.
#
# The two SQL files are placed in db-server\metrics-ledger\ by
# scripts\sync-to-usb.ps1, which refreshes them from prisma\ on every sync.
# ===========================================================================

# NOT "Stop" - psql and docker write ordinary progress to stderr, and Windows
# PowerShell 5.1 turns a native command's stderr into a terminating error.
# Exit codes are checked explicitly instead; `throw` stays terminating
# regardless of this setting.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found. Copy .env.template to .env first." }

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
    if (-not $pgUser -or -not $pgDb) { throw "POSTGRES_USER / POSTGRES_DB are not set in .env." }

    $migrationName = "20260825000000_metrics_ledger_additive"

    # Bundle layout first (what sync-to-usb.ps1 ships); repo layout as a
    # fallback so the script also runs from a development checkout.
    $migrationFile = Join-Path $root "metrics-ledger\migration.sql"
    $backfillFile  = Join-Path $root "metrics-ledger\tier1_backfill.sql"
    if (-not (Test-Path $migrationFile)) {
        $repoRoot = Split-Path -Parent (Split-Path -Parent $root)
        $migrationFile = Join-Path $repoRoot "prisma\migrations\$migrationName\migration.sql"
        $backfillFile  = Join-Path $repoRoot "prisma\backfill\tier1_backfill.sql"
    }
    if (-not (Test-Path $migrationFile)) { throw "Not found: metrics-ledger\migration.sql - re-run scripts\sync-to-usb.ps1 on the connected machine." }
    if (-not (Test-Path $backfillFile))  { throw "Not found: metrics-ledger\tier1_backfill.sql - re-run scripts\sync-to-usb.ps1 on the connected machine." }

    # Runs a query and returns its trimmed -tAX output; throws on psql failure.
    function Invoke-Sql([string]$sql) {
        $r = docker compose exec -T postgres psql -tAX -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -c $sql
        if ($LASTEXITCODE -ne 0) { throw "Query failed: $sql" }
        return "$r".Trim()
    }
    # Runs a query and prints its full table output.
    function Show-Sql([string]$sql) {
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -c $sql
        if ($LASTEXITCODE -ne 0) { throw "Query failed: $sql" }
    }

    Write-Host ""
    Write-Host "=== STEP 8: metrics-ledger migration A + Tier-1 backfill on '$pgDb' ===" -ForegroundColor Cyan
    Write-Host ""

    # ---- preflight: container + expected postgres --------------------------
    $state = docker inspect -f '{{.State.Status}}' postgres 2>$null
    if ("$state".Trim() -ne "running") {
        throw "The 'postgres' container is not running. Run .\scripts\2-start.ps1 first."
    }

    # btree_gist ships inside postgres:16-alpine; CREATE EXTENSION needs the
    # initdb superuser, which POSTGRES_USER is (see docker-compose.yml).
    Show-Sql "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('btree_gist');"
    Show-Sql "SELECT version();"

    # ---- pre-flight report 1: orphan item_routes rows ----------------------
    # These are why the migration adds ir_item_fk as NOT VALID. They do not
    # block anything today: the backfill JOINs items, so orphans are simply
    # not seeded, and the count equality check below excludes them too.
    Write-Host ""
    Write-Host "--- pre-flight 1/3: item_routes rows with no items row (orphans) ---" -ForegroundColor Cyan
    $orphans = [int](Invoke-Sql "SELECT count(*) FROM item_routes ir LEFT JOIN items it ON it.item_id = ir.item_id WHERE it.item_id IS NULL;")
    if ($orphans -gt 0) {
        Write-Host "  $orphans orphan row(s). First 20:" -ForegroundColor Yellow
        Show-Sql "SELECT ir.item_id, ir.route_number, ir.current_status, ir.created_at FROM item_routes ir LEFT JOIN items it ON it.item_id = ir.item_id WHERE it.item_id IS NULL ORDER BY ir.item_id LIMIT 20;"
        Write-Host "  They are excluded from the backfill; VALIDATE CONSTRAINT (step 5) will" -ForegroundColor Yellow
        Write-Host "  FAIL until they are deleted or their items rows are restored." -ForegroundColor Yellow
    } else {
        Write-Host "  none." -ForegroundColor Green
    }

    # ---- pre-flight report 2: duplicate testing_routes ---------------------
    # The migration creates UNIQUE INDEX testing_routes_type_number_uq on
    # (item_type_id, route_number); duplicates make that CREATE fail under
    # ON_ERROR_STOP, so they must be resolved BEFORE applying.
    Write-Host ""
    Write-Host "--- pre-flight 2/3: duplicate testing_routes(item_type_id, route_number) ---" -ForegroundColor Cyan
    $dups = [int](Invoke-Sql "SELECT count(*) FROM (SELECT 1 FROM testing_routes GROUP BY item_type_id, route_number HAVING count(*) > 1) d;")
    if ($dups -gt 0) {
        Show-Sql "SELECT item_type_id, route_number, count(*) AS copies FROM testing_routes GROUP BY item_type_id, route_number HAVING count(*) > 1 ORDER BY item_type_id, route_number;"
        throw ("$dups duplicate (item_type_id, route_number) pair(s) in testing_routes. " +
               "The migration's unique index cannot be created over them. Resolve the " +
               "duplicates (delete or renumber in the settings screen) and re-run.")
    }
    Write-Host "  none." -ForegroundColor Green

    # ---- pre-flight report 3: finished_at < created_at ---------------------
    # Poison for route_run's time CHECK. The backfill clamps these with
    # GREATEST(finished_at, created_at), so they are reported, not fatal.
    Write-Host ""
    Write-Host "--- pre-flight 3/3: item_routes rows with finished_at < created_at ---" -ForegroundColor Cyan
    $badTimes = [int](Invoke-Sql "SELECT count(*) FROM item_routes WHERE finished_at IS NOT NULL AND finished_at < created_at;")
    if ($badTimes -gt 0) {
        Write-Host "  $badTimes row(s). The backfill clamps their close time up to created_at. First 20:" -ForegroundColor Yellow
        Show-Sql "SELECT item_id, route_number, created_at, finished_at FROM item_routes WHERE finished_at IS NOT NULL AND finished_at < created_at ORDER BY item_id LIMIT 20;"
    } else {
        Write-Host "  none." -ForegroundColor Green
    }

    # ---- informational: rows the backfill cannot seed a station for --------
    # (Plan stage 4.) Seeded with an empty station_id under the relaxed
    # isi_station_shape; metrics_selfcheck reports them afterwards.
    Write-Host ""
    Write-Host "--- info: in-test/in-research rows without a station (unseedable station) ---" -ForegroundColor Cyan
    $noStation = [int](Invoke-Sql "SELECT count(*) FROM item_routes WHERE current_status IN (1,5) AND test_station_id IS NULL;")
    if ($noStation -gt 0) {
        Write-Host "  $noStation row(s) get an empty station_id; metrics_selfcheck will report them." -ForegroundColor Yellow
    } else {
        Write-Host "  none." -ForegroundColor Green
    }

    # ---- apply migration A -------------------------------------------------
    # Copied in rather than piped: PowerShell re-encodes a pipeline, and these
    # files are UTF-8 (Hebrew labels in metric_state).
    Write-Host ""
    Write-Host "--- applying $migrationName (idempotent) ---" -ForegroundColor Cyan
    docker cp "$migrationFile" postgres:/tmp/metrics-migration.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -q -f /tmp/metrics-migration.sql
    if ($LASTEXITCODE -ne 0) { throw "Migration FAILED - the failing statement rolled back. Fix the error above and re-run; every statement is idempotent." }
    docker compose exec -T postgres rm -f /tmp/metrics-migration.sql 2>$null | Out-Null
    Write-Host "  applied." -ForegroundColor Green

    # ---- Tier-1 backfill (idempotent, deliberately re-runnable) ------------
    Write-Host ""
    Write-Host "--- running Tier-1 backfill (ends with ENABLE TRIGGER trg_metrics_drift) ---" -ForegroundColor Cyan
    docker cp "$backfillFile" postgres:/tmp/tier1-backfill.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -q -f /tmp/tier1-backfill.sql
    if ($LASTEXITCODE -ne 0) { throw "Backfill FAILED. Fix the error above and re-run - ON CONFLICT DO NOTHING makes it safe to repeat." }
    docker compose exec -T postgres rm -f /tmp/tier1-backfill.sql 2>$null | Out-Null
    Write-Host "  done." -ForegroundColor Green

    # ---- backfill verification (plan stage 4) ------------------------------
    Write-Host ""
    Write-Host "--- backfill verification ---" -ForegroundColor Cyan
    $problems = 0

    # Orphans are excluded on BOTH sides on purpose - they were reported above.
    $lhs = [int](Invoke-Sql "SELECT count(*) FROM item_routes ir JOIN items it USING (item_id);")
    $rhs = [int](Invoke-Sql "SELECT count(*) FROM route_run WHERE run_no = 1;")
    if ($lhs -eq $rhs) {
        Write-Host "  item_routes-with-items ($lhs) = route_run run_no=1 ($rhs)   OK" -ForegroundColor Green
    } else {
        Write-Host "  item_routes-with-items ($lhs) <> route_run run_no=1 ($rhs)  MISMATCH" -ForegroundColor Red
        $problems++
    }

    $openIv = [int](Invoke-Sql "SELECT count(*) FROM item_state_interval WHERE upper_inf(valid_range);")
    $runs   = [int](Invoke-Sql "SELECT count(*) FROM route_run;")
    if ($openIv -eq $runs) {
        Write-Host "  open intervals ($openIv) = route_run rows ($runs)          OK" -ForegroundColor Green
    } else {
        Write-Host "  open intervals ($openIv) <> route_run rows ($runs)         MISMATCH" -ForegroundColor Red
        $problems++
    }

    # ---- metrics_selfcheck() -----------------------------------------------
    # Gate values (plan section 10.4 step 8): drift_open = 0,
    # intervals_missing_work_seconds = 0, calendar_horizon_days > 300,
    # calendar_sanity_net_minutes = 455. The calendar rows stay empty until
    # the app server's rebuild-work-calendar job has run once.
    Write-Host ""
    Write-Host "--- metrics_selfcheck() ---" -ForegroundColor Cyan
    Show-Sql "SELECT * FROM metrics_selfcheck();"

    # ---- VALIDATE CONSTRAINT ir_item_fk - separate, operator-confirmed -----
    Write-Host ""
    Write-Host "--- VALIDATE CONSTRAINT ir_item_fk ---" -ForegroundColor Cyan
    Write-Host "  The FK item_routes -> items was added NOT VALID. Validation scans the"
    Write-Host "  table and FAILS while orphan rows exist (reported above: $orphans)."
    Write-Host "  Skipping is safe: new/updated rows are already checked either way."
    $answer = Read-Host "  Type yes to run VALIDATE CONSTRAINT now (anything else skips)"
    if ($answer -eq "yes") {
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -c "ALTER TABLE item_routes VALIDATE CONSTRAINT ir_item_fk;"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  VALIDATE failed - resolve the orphan rows, then re-run just this step:" -ForegroundColor Red
            Write-Host "    ALTER TABLE item_routes VALIDATE CONSTRAINT ir_item_fk;" -ForegroundColor Red
            $problems++
        } else {
            Write-Host "  validated." -ForegroundColor Green
        }
    } else {
        Write-Host "  skipped. Run later in psql:  ALTER TABLE item_routes VALIDATE CONSTRAINT ir_item_fk;" -ForegroundColor Yellow
    }

    # ---- _prisma_migrations bookkeeping ------------------------------------
    # Same NOT EXISTS pattern as the bookkeeping tail of init\02-app-schema.sql
    # (that IS the table name - "_prisma_binaries" in the v1 runbook was a
    # typo). Checksum = sha256 of the migration.sql bytes, exactly what Prisma
    # records itself.
    Write-Host ""
    Write-Host "--- recording $migrationName in _prisma_migrations ---" -ForegroundColor Cyan
    $checksum = (Get-FileHash -Algorithm SHA256 $migrationFile).Hash.ToLower()
    $bookkeeping = @"
INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '$checksum', now(), '$migrationName', now(), 1
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '$migrationName');
"@
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -c $bookkeeping | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not write the _prisma_migrations row." }
    Write-Host "  recorded." -ForegroundColor Green

    Write-Host ""
    if ($problems -eq 0) {
        Write-Host "Migration A + Tier-1 backfill applied and verified." -ForegroundColor Green
        Write-Host ""
        Write-Host "Next: docker compose up -d   (picks up the tuning + backup changes)," -ForegroundColor Cyan
        Write-Host "then the APP SERVER trip: stop the old app, re-run the Tier-1 step" -ForegroundColor Cyan
        Write-Host "(this script again - it is idempotent), 3-start.ps1, 4-verify.ps1." -ForegroundColor Cyan
    } else {
        Write-Host "Finished with $problems problem(s) - see the red lines above." -ForegroundColor Red
    }
    Write-Host ""
}
finally {
    Pop-Location
}
