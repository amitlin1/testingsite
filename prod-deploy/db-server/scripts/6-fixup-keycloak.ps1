# ===========================================================================
# DB SERVER - STEP 6: point the restored realm at this installation
# ===========================================================================
#   .\scripts\6-fixup-keycloak.ps1 -AppUrl http://10.0.0.50
#   .\scripts\6-fixup-keycloak.ps1 -AppUrl http://10.0.0.50 -DeleteDevUsers
#
# Runs keycloak-seed\fixup-after-restore.sql through psql INSIDE the postgres
# container, with -AppUrl injected - so there is no line to hand-edit and no way
# to run the file with the placeholder address still in it.
#
# The seed is a copy of the development Keycloak: every client URL in it says
# http://localhost. Until they are rewritten, login fails with
# "Invalid parameter: redirect_uri" - Keycloak refuses to send the browser back
# to an address the client is not registered for.
#
# KEYCLOAK MUST BE STOPPED while this runs (it caches realm data in memory and
# would keep serving the OLD values, logging nothing). During a first install it
# has never started, so there is nothing to stop.
#
# Next: configure the APP SERVER with APP_PUBLIC_URL set to this same -AppUrl.
# ===========================================================================

param(
    # The address users type in their browser. No trailing slash.
    # Must equal APP_PUBLIC_URL in the app server's .env, byte for byte.
    [Parameter(Mandatory = $true)]
    [string]$AppUrl,

    # Remove manager1 / bodek1 / mahsan1 / dev-manager. Only after a real
    # manager account exists - these ARE the seeded logins.
    [switch]$DeleteDevUsers
)

# NOT "Stop". This file's NOTICE lines are its useful output, and psql sends
# them to stderr; Windows PowerShell 5.1 wraps native stderr in an ErrorRecord,
# which "Stop" would turn into a crash halfway through the fixup. Every docker
# call is checked via $LASTEXITCODE, and `throw` stays terminating regardless.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) { throw ".env not found." }

    $fixFile = Join-Path $root "keycloak-seed\fixup-after-restore.sql"
    if (-not (Test-Path $fixFile)) { throw "Not found: $fixFile" }

    # ---- validate the address BEFORE touching anything --------------------
    $AppUrl = $AppUrl.Trim()
    if ($AppUrl -notmatch '^https?://') { throw "-AppUrl must start with http:// or https:// (got '$AppUrl')" }
    if ($AppUrl.EndsWith("/"))          { throw "-AppUrl must not end with a slash (got '$AppUrl')" }
    if ($AppUrl -match '<<<')           { throw "-AppUrl still contains a placeholder: '$AppUrl'" }

    # A loopback address here is the expensive mistake, because NOTHING fails at
    # this point - it writes cleanly, Keycloak starts, and the realm is quietly
    # unusable. This value becomes:
    #   * the redirect URI and web origin the BROWSER is sent to, and
    #   * the OIDC issuer stamped into every token.
    # From any PC other than this one, loopback points at that PC - so login
    # breaks for every real user while still working on the server console.
    #
    # It must also match APP_PUBLIC_URL on the app server, and 2-check-env.ps1
    # rejects loopback there - so allowing it here only defers the failure.
    $urlHost = $null
    try { $urlHost = ([Uri]$AppUrl).Host } catch { throw "-AppUrl is not a valid URL: '$AppUrl'" }
    if ($urlHost -in @("127.0.0.1", "localhost", "::1", "0.0.0.0")) {
        throw ("-AppUrl points at '$urlHost'. This is the address USERS' BROWSERS are sent to " +
               "and the issuer signed into every token, so it must be reachable from client PCs. " +
               "Use this machine's LAN IP (ipconfig -> IPv4 Address), e.g. -AppUrl http://10.0.0.50 " +
               "- even when the app and the database are on this one machine.")
    }

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
    if (-not $pgUser) { throw "POSTGRES_USER is not set in .env." }

    Write-Host ""
    Write-Host "=== STEP 6: re-targeting the realm at $AppUrl ===" -ForegroundColor Cyan
    Write-Host ""

    # ---- preflight -------------------------------------------------------
    $state = docker inspect -f '{{.State.Status}}' postgres 2>$null
    if ("$state".Trim() -ne "running") { throw "The 'postgres' container is not running." }

    $realm = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
                -c "SELECT 1 FROM realm WHERE name='testing';"
    if ("$realm".Trim() -ne "1") {
        throw "Realm 'testing' not found in '$kcDb'. Run .\scripts\5-seed-keycloak.ps1 first."
    }

    # This file finds its work by matching "localhost". Once the URLs have been
    # rewritten there is nothing left to match, so re-running it with a DIFFERENT
    # address reports 0 rows and silently keeps the old one. Say so up front
    # rather than let it look like it worked.
    $lh = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
             -c "SELECT (SELECT count(*) FROM redirect_uris WHERE value LIKE '%localhost%') + (SELECT count(*) FROM web_origins WHERE value LIKE '%localhost%') + (SELECT count(*) FROM client_attributes WHERE value LIKE '%localhost%');"
    $lhCount = 0; [int]::TryParse("$lh".Trim(), [ref]$lhCount) | Out-Null

    if ($lhCount -eq 0) {
        $current = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
                      -c "SELECT string_agg(DISTINCT value, ', ') FROM redirect_uris WHERE value LIKE 'http%';"
        Write-Host "  No localhost URLs remain - the fixup has ALREADY run here." -ForegroundColor Yellow
        Write-Host "  Currently registered: $("$current".Trim())" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Running again CANNOT re-target the realm: this file matches on" -ForegroundColor DarkYellow
        Write-Host "  'localhost', and there is nothing left to match." -ForegroundColor DarkYellow
        Write-Host ""
        Write-Host "  To change the address, pick one:" -ForegroundColor DarkYellow
        Write-Host "    * .\scripts\5-seed-keycloak.ps1 -Force   (restore again, then re-run this)" -ForegroundColor DarkYellow
        Write-Host "    * or edit Clients -> testing-web -> Valid redirect URIs / Web origins" -ForegroundColor DarkYellow
        Write-Host "      in the Keycloak admin console" -ForegroundColor DarkYellow
        Write-Host ""
        if (-not $DeleteDevUsers) { return }
        Write-Host "  Continuing anyway because -DeleteDevUsers was given." -ForegroundColor Cyan
        Write-Host ""
    }

    # ---- inject the address ----------------------------------------------
    $raw = Get-Content $fixFile -Raw

    $urlPattern = "(v_app_url\s+text\s*:=\s*')[^']*(')"
    if (($raw | Select-String -Pattern $urlPattern -AllMatches).Matches.Count -ne 1) {
        throw "Could not find the v_app_url line in $fixFile - was the file edited?"
    }
    $sql = $raw -replace $urlPattern, ('${1}' + $AppUrl + '${2}')

    if ($DeleteDevUsers) {
        $delPattern = "(v_delete_dev_users\s+boolean\s*:=\s*)false"
        if (($sql | Select-String -Pattern $delPattern -AllMatches).Matches.Count -ne 1) {
            throw "Could not find the v_delete_dev_users line in $fixFile."
        }
        $sql = $sql -replace $delPattern, '${1}true'
        Write-Host "  -DeleteDevUsers: manager1 / bodek1 / mahsan1 / dev-manager WILL be removed." -ForegroundColor Yellow
        Write-Host "  Make sure a real manager account already exists, or nobody can sign in." -ForegroundColor Yellow
        Write-Host ""
    }

    # UTF-8 with NO BOM. The file carries Hebrew in its comments, and a BOM at
    # the head of the stream makes psql fail on the very first line.
    $tmp = Join-Path $env:TEMP "kc-fixup-$PID.sql"
    [System.IO.File]::WriteAllText($tmp, $sql, (New-Object System.Text.UTF8Encoding($false)))

    try {
        docker cp "$tmp" postgres:/tmp/kc-fixup.sql | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }

        Write-Host "  applying..." -ForegroundColor Gray
        Write-Host ""
        # No -q: the NOTICE lines and the verification table below ARE the output
        # you are meant to read.
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $kcDb -f /tmp/kc-fixup.sql
        if ($LASTEXITCODE -ne 0) { throw "Fixup FAILED - see the error above." }

        docker compose exec -T postgres rm -f /tmp/kc-fixup.sql 2>$null | Out-Null
    }
    finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }

    # ---- the check that actually decides go / no-go -----------------------
    $after = docker compose exec -T postgres psql -tAX -U $pgUser -d $kcDb `
                -c "SELECT (SELECT count(*) FROM redirect_uris WHERE value LIKE '%localhost%') + (SELECT count(*) FROM web_origins WHERE value LIKE '%localhost%') + (SELECT count(*) FROM client_attributes WHERE value LIKE '%localhost%');"
    $afterCount = 1; [int]::TryParse("$after".Trim(), [ref]$afterCount) | Out-Null

    Write-Host ""
    if ($afterCount -ne 0) {
        Write-Host "FAILED: $afterCount localhost URL(s) still present." -ForegroundColor Red
        Write-Host "Do NOT start the app server - login would fail with 'Invalid parameter: redirect_uri'." -ForegroundColor Red
        Write-Host ""
        return
    }

    Write-Host "This DB server is ready." -ForegroundColor Green
    Write-Host ""
    Write-Host "On the APP SERVER, .env must contain EXACTLY:" -ForegroundColor Cyan
    Write-Host "    APP_PUBLIC_URL=$AppUrl" -ForegroundColor White
    Write-Host ""
    Write-Host "The seeded accounts carry their DEVELOPMENT passwords." -ForegroundColor Yellow
    Write-Host "Change every one of them from the app after the first login." -ForegroundColor Yellow
    Write-Host ""
}
finally {
    Pop-Location
}
