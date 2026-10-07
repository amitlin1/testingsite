# ===========================================================================
# DB SERVER - step 10: drop package_contents.manufacturer_sku
# ===========================================================================
#   .\scripts\10-apply-package-sku-drop.ps1
#
# For a database that ALREADY ran the package-model upgrade
# (scripts/prod-package-model/2-upgrade-to-packages.sql) before this column
# was dropped. A database upgraded with the current 2-upgrade file already has
# it applied and registered - this script then reports that and changes nothing.
#
# The package template no longer carries a manufacturer SKU: the opening
# wizard finds reference items from what is scanned. Whatever was typed in
# that column is lost; nothing reads it any more.
#
# ORDER OF DEPLOYMENT: the new app image first, then this. The old image still
# selects the column and fails without it; the new one never touches it.
# ===========================================================================

# NOT "Stop": docker writes ordinary progress to stderr and PowerShell 5.1 wraps
# a native command's stderr in an ErrorRecord. Every docker call that matters is
# checked through $LASTEXITCODE, and `throw` stays terminating regardless.
$ErrorActionPreference = "Continue"

$migration = "20261006120000_package_contents_drop_manufacturer_sku"

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
Write-Host "=== package_contents: dropping manufacturer_sku ===" -ForegroundColor Cyan

$hasTable = Query "SELECT to_regclass('public.package_contents') IS NOT NULL;"
if ($hasTable -ne "t") { throw "package_contents does not exist - run the package-model upgrade first." }

$registered = Query "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$migration';"
$hasColumn  = Query "SELECT count(*) FROM information_schema.columns WHERE table_name = 'package_contents' AND column_name = 'manufacturer_sku';"
if ([int]$registered -gt 0 -and [int]$hasColumn -eq 0) {
    Write-Host "  Already applied - nothing to do." -ForegroundColor Green
    exit 0
}

# ---- apply -----------------------------------------------------------------
$sqlLocal = Join-Path $root "migrations\$migration.sql"
if (-not (Test-Path $sqlLocal)) {
    $sqlLocal = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) "prisma\migrations\$migration\migration.sql"
}
if (-not (Test-Path $sqlLocal)) { throw "migration.sql not found (looked in the bundle layout and the repo layout)" }

# Copied in rather than piped: a piped heredoc through docker on Windows
# mangles non-ASCII (same as 7-seed-settings.ps1).
docker cp $sqlLocal postgres:/tmp/package_sku_drop.sql
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb -f /tmp/package_sku_drop.sql
if ($LASTEXITCODE -ne 0) { throw "MIGRATION FAILED." }

# ---- bookkeeping + verification -------------------------------------------
# Prisma's checksum is the sha256 of the file bytes; the repo file is LF.
$checksum = (Get-FileHash -Algorithm SHA256 $sqlLocal).Hash.ToLower()
Query @"
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '$checksum', now(), '$migration', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '$migration');
"@ | Out-Null

$left = Query "SELECT count(*) FROM information_schema.columns WHERE table_name = 'package_contents' AND column_name = 'manufacturer_sku';"
if ([int]$left -ne 0) { throw "Post-migration verification FAILED: the column is still there." }

Write-Host "  Done - manufacturer_sku dropped and the migration registered." -ForegroundColor Green
