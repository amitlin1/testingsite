# ===========================================================================
# DB SERVER - STEP 7: load the settings-page reference data
# ===========================================================================
#   .\scripts\7-seed-settings.ps1
#   .\scripts\7-seed-settings.ps1 -Force        # replace existing rows
#   .\scripts\7-seed-settings.ps1 -SkipImages   # database only, no MinIO upload
#
# Fills the lookup tables behind every /settings page so the system arrives
# configured instead of empty: customers, item types, sources, item and station
# statuses, station types and stations, testing routes, workers, photo types,
# reference items, and the work-hours calendar.
#
# NOT transactional data. Items, shipments, test results and snapshots stay
# empty - a new installation starts its own history.
#
# Reference-item IMAGES are two halves that must both land: a row in
# reference_item_images (bucket + object_key) and the bytes in MinIO. This
# script does both, so the images actually render.
#
# Safe to skip entirely if the site wants to enter its own settings by hand.
# ===========================================================================

param(
    # Delete existing settings rows and reload. Fails if transactional data
    # already references them, which is the intended protection.
    [switch]$Force,
    # Load the database rows but do not upload image bytes to MinIO.
    [switch]$SkipImages
)

# NOT "Stop" - psql and mc write progress to stderr, and Windows PowerShell 5.1
# turns a native command's stderr into a terminating error. Exit codes are
# checked explicitly instead; `throw` stays terminating regardless.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found. Copy .env.template to .env first." }

    $seedFile = Join-Path $root "settings-seed\settings-seed.sql"
    $filesDir = Join-Path $root "settings-seed\minio-files"
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
    $pgDb   = $cfg["POSTGRES_DB"]
    if (-not $pgUser -or -not $pgDb) { throw "POSTGRES_USER / POSTGRES_DB are not set in .env." }

    # Reverse FK order - children first, so a reload cannot trip a constraint.
    $tables = @(
        "reference_item_images", "department_holidays", "testing_routes", "test_stations",
        "reference_items", "workday_overrides", "weekday_defaults", "holiday_types",
        "photo_types", "workers", "test_stations_type", "test_station_status",
        "item_status", "sources", "item_types", "customers"
    )

    Write-Host ""
    Write-Host "=== STEP 7: loading settings data into '$pgDb' ===" -ForegroundColor Cyan
    Write-Host ""

    # ---- preflight -------------------------------------------------------
    $state = docker inspect -f '{{.State.Status}}' postgres 2>$null
    if ("$state".Trim() -ne "running") {
        throw "The 'postgres' container is not running. Run .\scripts\2-start.ps1 first."
    }

    $hasSchema = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb `
                    -c "SELECT to_regclass('public.customers') IS NOT NULL;"
    if ("$hasSchema".Trim() -ne "t") {
        throw "The application schema is missing from '$pgDb'. It is created automatically on a fresh volume; otherwise apply init\02-app-schema.sql first."
    }

    # ---- already populated? ----------------------------------------------
    # holiday_types, photo_types and weekday_defaults are seeded by the
    # MIGRATIONS, so a fresh database already holds 14 rows across them. Counting
    # those would make this guard fire on every clean install. Only the tables a
    # fresh install leaves EMPTY tell us whether the system is already configured.
    $migrationSeeded = @("holiday_types", "photo_types", "weekday_defaults")
    $userTables = $tables | Where-Object { $_ -notin $migrationSeeded }

    $sumSql = ($userTables | ForEach-Object { "(SELECT count(*) FROM public.`"$_`")" }) -join " + "
    $existing = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb -c "SELECT $sumSql;"
    $n = 0; [int]::TryParse("$existing".Trim(), [ref]$n) | Out-Null

    if ($n -gt 0) {
        Write-Host "  The settings tables already hold $n configured row(s)." -ForegroundColor Yellow
        if (-not $Force) {
            Write-Host ""
            Write-Host "  Loading on top of them would duplicate entries and collide on ids." -ForegroundColor Yellow
            Write-Host "  Re-run with -Force to delete the current settings and reload." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  If this system is already in use, do NOT use -Force: the delete is" -ForegroundColor DarkYellow
            Write-Host "  refused anyway once items or shipments reference these rows." -ForegroundColor DarkYellow
            Write-Host ""
            return
        }
        Write-Host "  -Force: deleting current settings rows..." -ForegroundColor Yellow
        $delSql = ($tables | ForEach-Object { "DELETE FROM public.`"$_`";" }) -join " "
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb `
            -c "BEGIN; $delSql COMMIT;" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw ("Could not clear the settings tables - existing items/shipments still " +
                   "reference them. This system holds real data; seed it by hand instead.")
        }
        Write-Host "  cleared." -ForegroundColor Green
    }

    # ---- load ------------------------------------------------------------
    # Copied in rather than piped: PowerShell re-encodes a pipeline, and this
    # file is UTF-8 throughout (Hebrew names in nearly every table).
    Write-Host "  copying seed into the container..." -ForegroundColor Gray
    docker cp "$seedFile" postgres:/tmp/settings-seed.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }

    Write-Host "  loading (silence means success)..." -ForegroundColor Gray
    # The file wraps itself in BEGIN/COMMIT, so a failure rolls back whole.
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -q -f /tmp/settings-seed.sql
    if ($LASTEXITCODE -ne 0) { throw "Load FAILED - nothing was committed. Fix the error above and re-run." }
    docker compose exec -T postgres rm -f /tmp/settings-seed.sql 2>$null | Out-Null

    # ---- reference-item images into MinIO --------------------------------
    $manifestPath = Join-Path $filesDir "manifest.json"
    if ($SkipImages) {
        Write-Host "  -SkipImages: MinIO upload skipped. Reference-item images will not render." -ForegroundColor Yellow
    }
    elseif (-not (Test-Path $manifestPath)) {
        Write-Host "  no image manifest - nothing to upload." -ForegroundColor Gray
    }
    else {
        $mstate = docker inspect -f '{{.State.Status}}' FileServiceDB 2>$null
        if ("$mstate".Trim() -ne "running") {
            Write-Host "  MinIO is not running - skipping image upload." -ForegroundColor Yellow
            Write-Host "  Start it and re-run with -Force, or the images will 404." -ForegroundColor Yellow
        }
        else {
            $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
            Write-Host "  uploading $($manifest.Count) reference-item image(s) to MinIO..." -ForegroundColor Gray

            # mc runs INSIDE the MinIO container, where the root credentials are
            # already in the environment - nothing has to be passed in.
            docker exec FileServiceDB sh -c `
                'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1' | Out-Null

            $up = 0; $bad = 0
            foreach ($m in $manifest) {
                $local = Join-Path $filesDir $m.file
                if (-not (Test-Path $local)) { $bad++; continue }
                # The bucket is normally created by the app on first use; seeding
                # happens before the app has ever run, so create it here.
                docker exec FileServiceDB sh -c "mc mb --ignore-existing local/$($m.bucket) >/dev/null 2>&1" | Out-Null
                docker cp "$local" "FileServiceDB:/tmp/$($m.file)" | Out-Null
                docker exec FileServiceDB sh -c "mc cp '/tmp/$($m.file)' 'local/$($m.bucket)/$($m.key)' >/dev/null 2>&1" | Out-Null
                $chk = docker exec FileServiceDB sh -c "mc stat 'local/$($m.bucket)/$($m.key)' >/dev/null 2>&1 && echo ok"
                if ("$chk".Trim() -eq "ok") { $up++ } else { $bad++ }
                docker exec FileServiceDB rm -f "/tmp/$($m.file)" 2>$null | Out-Null
            }
            if ($bad -gt 0) { Write-Host "  uploaded $up, FAILED $bad" -ForegroundColor Red }
            else { Write-Host "  uploaded $up/$($manifest.Count)." -ForegroundColor Green }
        }
    }

    # ---- verify ----------------------------------------------------------
    Write-Host ""
    Write-Host "=== what landed ===" -ForegroundColor Cyan
    $verify = @"
SELECT 'customers' AS settings_page, count(*)::text AS rows FROM customers
UNION ALL SELECT 'item_types',          count(*)::text FROM item_types
UNION ALL SELECT 'sources',             count(*)::text FROM sources
UNION ALL SELECT 'item_status',         count(*)::text FROM item_status
UNION ALL SELECT 'test_station_status', count(*)::text FROM test_station_status
UNION ALL SELECT 'test_stations_type',  count(*)::text FROM test_stations_type
UNION ALL SELECT 'test_stations',       count(*)::text FROM test_stations
UNION ALL SELECT 'testing_routes',      count(*)::text FROM testing_routes
UNION ALL SELECT 'workers',             count(*)::text FROM workers
UNION ALL SELECT 'photo_types',         count(*)::text FROM photo_types
UNION ALL SELECT 'reference_items',     count(*)::text FROM reference_items
UNION ALL SELECT 'reference_item_imgs', count(*)::text FROM reference_item_images
UNION ALL SELECT 'weekday_defaults',    count(*)::text FROM weekday_defaults
UNION ALL SELECT 'workday_overrides',   count(*)::text FROM workday_overrides
UNION ALL SELECT 'holiday_types',       count(*)::text FROM holiday_types
UNION ALL SELECT 'department_holidays', count(*)::text FROM department_holidays;
"@
    $verify | docker compose exec -T postgres psql -U $pgUser -d $pgDb

    # A sequence left behind its table's max id hands the next UI-created record
    # an id that already exists - a duplicate-key error on a system that looks
    # perfectly healthy. The seed calls setval, so this asserts it took effect.
    $seqCheck = @"
SELECT string_agg(tbl || '.' || col, ', ') FROM (
  SELECT c.relname AS tbl, a.attname AS col,
         pg_get_serial_sequence('public.' || quote_ident(c.relname), a.attname) AS seq
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('customers','item_types','sources','item_status','test_station_status',
                       'test_stations_type','test_stations','testing_routes','photo_types',
                       'reference_items','reference_item_images','holiday_types',
                       'workday_overrides','department_holidays')
     AND pg_get_serial_sequence('public.' || quote_ident(c.relname), a.attname) IS NOT NULL
) s
WHERE (SELECT last_value FROM pg_sequences
        WHERE schemaname = 'public' AND sequencename = split_part(s.seq, '.', 2)) <= 1
  AND (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = s.tbl) > 0;
"@
    $stale = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb -c $seqCheck
    $stale = "$stale".Trim()
    if ($stale) {
        Write-Host ""
        Write-Host "WARNING: these sequences were not advanced past their seeded ids:" -ForegroundColor Red
        Write-Host "  $stale" -ForegroundColor Red
        Write-Host "Creating a record on those pages will fail with a duplicate key." -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Settings data loaded." -ForegroundColor Green
    Write-Host ""
    Write-Host "Check it in the app under Settings (/settings)." -ForegroundColor Cyan
    Write-Host "Anything wrong can be edited there - this seed is a starting point," -ForegroundColor Gray
    Write-Host "not a permanent fixture." -ForegroundColor Gray
    Write-Host ""
}
finally {
    Pop-Location
}
