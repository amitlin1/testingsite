# ===========================================================================
# DB SERVER - verify the deployment
# ===========================================================================
#   .\scripts\4-check.ps1
#
# Confirms both databases exist, the application schema was created, and MinIO
# is answering - before the app server is pointed at this machine.
# ===========================================================================

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
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
    $kcDb   = $cfg["KEYCLOAK_DB_NAME"]

    $pass = 0; $fail = 0
    function Test-Step([string]$name, [scriptblock]$check, [string]$hint) {
        Write-Host -NoNewline ("  {0,-46}" -f $name)
        try {
            if (& $check) { Write-Host "OK" -ForegroundColor Green; $script:pass++ }
            else { Write-Host "FAIL" -ForegroundColor Red; Write-Host "      $hint" -ForegroundColor DarkYellow; $script:fail++ }
        } catch {
            Write-Host "FAIL" -ForegroundColor Red
            Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray
            Write-Host "      $hint" -ForegroundColor DarkYellow
            $script:fail++
        }
    }

    Write-Host ""
    Write-Host "=== DB SERVER checks ===" -ForegroundColor Cyan
    Write-Host ""

    Test-Step "postgres is running" {
        (docker inspect -f '{{.State.Status}}' postgres 2>$null) -eq "running"
    } "docker compose logs postgres"

    Test-Step "minio is running" {
        (docker inspect -f '{{.State.Status}}' FileServiceDB 2>$null) -eq "running"
    } "docker compose logs minio"

    Test-Step "application database '$pgDb' exists" {
        $r = docker compose exec -T postgres psql -tAX -U $pgUser -d postgres -c "SELECT 1 FROM pg_database WHERE datname='$pgDb';"
        return ("$r".Trim() -eq "1")
    } "Check POSTGRES_DB in .env."

    Test-Step "keycloak database '$kcDb' exists" {
        $r = docker compose exec -T postgres psql -tAX -U $pgUser -d postgres -c "SELECT 1 FROM pg_database WHERE datname='$kcDb';"
        return ("$r".Trim() -eq "1")
    } "Run scripts\3-create-keycloak-db.ps1 (the volume already existed, so initdb.d never ran)."

    Test-Step "application schema was created" {
        $r = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
        $n = 0; [int]::TryParse("$r".Trim(), [ref]$n) | Out-Null
        Write-Host -NoNewline "($n tables) "
        return ($n -gt 5)
    } "Apply init\02-app-schema.sql to '$pgDb' in DBeaver."

    Test-Step "prisma migrations are recorded" {
        $r = docker compose exec -T postgres psql -tAX -U $pgUser -d $pgDb -c "SELECT count(*) FROM public._prisma_migrations;"
        $n = 0; [int]::TryParse("$r".Trim(), [ref]$n) | Out-Null
        Write-Host -NoNewline "($n rows) "
        return ($n -gt 0)
    } "The bookkeeping section of init\02-app-schema.sql did not run."

    Test-Step "MinIO API answers" {
        $r = Invoke-WebRequest -Uri "http://localhost:$($cfg['MINIO_PORT'])/minio/health/live" -UseBasicParsing -TimeoutSec 10
        return ($r.StatusCode -eq 200)
    } "docker compose logs minio"

    Write-Host ""
    if ($fail -eq 0) {
        Write-Host "All $pass checks passed. This server is ready." -ForegroundColor Green
        Write-Host "Now configure the APP SERVER with DB_HOST = this machine's IP." -ForegroundColor Green
    } else {
        Write-Host "$fail check(s) failed, $pass passed." -ForegroundColor Red
    }
    Write-Host ""
}
finally {
    Pop-Location
}
