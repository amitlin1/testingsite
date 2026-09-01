# ===========================================================================
# DB SERVER - step 9: migration B, the DESTRUCTIVE one
# ===========================================================================
#   .\scripts\9-apply-metrics-drop.ps1
#
# Drops the entire legacy metrics subsystem: 23 snapshot tables,
# station_live_counters, finished_item, mv_station_stats, the counter trigger
# and its function, plus the dual-run drift scaffold.
#
# THERE IS NO ROLLBACK. Re-deploying the previous application image does NOT
# bring a dropped table back. The only recovery is a restore from backup, which
# means losing everything written since that backup. Take one first.
#
# THE GATE (plan §8 stage 7) is enforced here, not merely documented: this
# script REFUSES to run until it has verified, against the live database, that
#   1. the ledger is actually populated (dropping the old system while the new
#      one is empty would leave the dashboard with nothing at all),
#   2. metrics_drift has no open rows — the dual-run's whole purpose was to
#      prove every item_routes writer also emits its ledger event,
#   3. metrics_selfcheck reports no anomalies,
#   4. the operator confirms IN WRITING that a full week has passed with
#      drift_open = 0 on every sample. The script cannot see history; only a
#      human can attest to the week.
#
# ORDER OF DEPLOYMENT (both servers): DB FIRST, then the app image. The app's
# schema gate requires metrics_schema_version >= 2, which this migration sets,
# so the new image refuses to serve writes until this has run. The old image
# against a post-drop database is the dangerous direction and is why the DB
# must not be migrated until the new image is ready to go out behind it.
# ===========================================================================

# NOT "Stop": docker writes ordinary progress to stderr and PowerShell 5.1 wraps
# a native command's stderr in an ErrorRecord. Every docker call that matters is
# checked through $LASTEXITCODE, and `throw` stays terminating regardless.
$ErrorActionPreference = "Continue"

$root    = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) { throw ".env not found at $envPath" }

$cfg = @{}
foreach ($line in Get-Content $envPath) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
        $v = $v.Substring(1, $v.Length - 2)
    }
    $cfg[$t.Substring(0, $i).Trim()] = $v
}
$pgUser = $cfg["POSTGRES_USER"]
$pgDb   = $cfg["POSTGRES_DB"]
if (-not $pgUser -or -not $pgDb) { throw "POSTGRES_USER / POSTGRES_DB missing from $envPath" }

function Query([string]$sql) {
    $out = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb -c $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
    return ("$out".Trim())
}

Write-Host ""
Write-Host "=== MIGRATION B - dropping the legacy metrics subsystem ===" -ForegroundColor Red
Write-Host "    THIS CANNOT BE UNDONE." -ForegroundColor Red
Write-Host ""

# ---- gate 1: the replacement is actually carrying data ---------------------
$intervals = [int](Query "SELECT count(*) FROM item_state_interval;")
$events    = [int](Query "SELECT count(*) FROM item_state_event;")
Write-Host ("  ledger: {0} intervals / {1} events" -f $intervals, $events)
if ($intervals -lt 1 -or $events -lt 1) {
    throw "The ledger is EMPTY. Dropping the old system now would leave the dashboard with no data at all. Run the Tier-1 backfill (8-apply-metrics-ledger.ps1) first."
}

# ---- gate 2: the dual-run proved every writer emits its event --------------
$driftTable = Query "SELECT to_regclass('public.metrics_drift') IS NOT NULL;"
if ($driftTable -eq "t") {
    $drift = [int](Query "SELECT count(*) FROM metrics_drift WHERE resolved_at IS NULL;")
    Write-Host ("  open drift rows: {0}" -f $drift)
    if ($drift -ne 0) {
        throw "metrics_drift has $drift OPEN row(s): at least one writer changes item_routes without emitting its ledger event. Fix that before dropping the scaffold that is telling you about it."
    }
} else {
    Write-Host "  metrics_drift is already gone - this migration has run before." -ForegroundColor Yellow
}

# ---- gate 3: the ledger's own health checks -------------------------------
$anomalies = Query @"
SELECT count(*) FROM metrics_selfcheck()
 WHERE value <> 0
   AND check_name NOT IN ('open_intervals','calendar_horizon_days','calendar_sanity_net_minutes','ledger_bytes');
"@
Write-Host ("  metrics_selfcheck anomalies: {0}" -f $anomalies)
if ([int]$anomalies -ne 0) {
    Write-Host ""
    docker compose exec -T postgres psql -U $pgUser -d $pgDb -c "SELECT * FROM metrics_selfcheck();"
    throw "metrics_selfcheck reports $anomalies anomaly/anomalies. Resolve them before the irreversible step."
}

# ---- gate 4: the week only a human can attest to ---------------------------
Write-Host ""
Write-Host "  The checks above are a snapshot of RIGHT NOW. The gate is a full week" -ForegroundColor Yellow
Write-Host "  of drift_open = 0 on every sample (plan section 8, stage 7), which this" -ForegroundColor Yellow
Write-Host "  script cannot see." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Confirm: has a full week passed with no open drift, and is a fresh" -ForegroundColor Yellow
Write-Host "  backup on hand?" -ForegroundColor Yellow
$answer = Read-Host "  Type exactly: DROP THE SNAPSHOTS"
if ($answer -ne "DROP THE SNAPSHOTS") {
    Write-Host "  Aborted - nothing was changed." -ForegroundColor Green
    exit 0
}

# ---- apply -----------------------------------------------------------------
$sqlLocal = Join-Path $root "metrics-ledger\20260901000000_metrics_drop_snapshots.sql"
if (-not (Test-Path $sqlLocal)) {
    $sqlLocal = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) "prisma\migrations\20260901000000_metrics_drop_snapshots\migration.sql"
}
if (-not (Test-Path $sqlLocal)) { throw "migration.sql not found (looked in the bundle layout and the repo layout)" }

# Copied in rather than piped: the same reasoning as 7-seed-settings.ps1 -
# a piped heredoc through docker on Windows mangles non-ASCII.
docker cp $sqlLocal postgres:/tmp/metrics_drop.sql
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }

Write-Host ""
Write-Host "  applying..." -ForegroundColor Cyan
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -f /tmp/metrics_drop.sql
if ($LASTEXITCODE -ne 0) { throw "MIGRATION FAILED - the database may be half-dropped. Restore from backup." }

# ---- bookkeeping + verification -------------------------------------------
$checksum = (Get-FileHash -Algorithm SHA256 $sqlLocal).Hash.ToLower()
$insert = @"
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '$checksum', now(), '20260901000000_metrics_drop_snapshots', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260901000000_metrics_drop_snapshots');
"@
Query $insert | Out-Null

$left = Query "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%_snapshots%' OR table_name IN ('station_live_counters','finished_item','metrics_drift'));"
$ver  = Query "SELECT version FROM metrics_schema_version WHERE id = 1;"

Write-Host ""
Write-Host ("  legacy tables remaining: {0}   (expected 0)" -f $left)
Write-Host ("  metrics_schema_version : {0}   (expected 2)" -f $ver)
docker compose exec -T postgres psql -U $pgUser -d $pgDb -c "SELECT * FROM metrics_selfcheck();"

if ([int]$left -ne 0 -or "$ver" -ne "2") { throw "Post-migration verification FAILED." }

Write-Host ""
Write-Host "  Done. Now deploy the application image - it requires schema version 2." -ForegroundColor Green
