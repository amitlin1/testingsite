# ===========================================================================
# APP SERVER - step 2: validate .env before anything starts
# ===========================================================================
#   .\scripts\2-check-env.ps1
#
# Most air-gap deployment failures are a URL that disagrees with itself in two
# places, and they surface much later as an opaque "invalid token", a login
# loop, or an editor that never opens. Every check here maps to a specific
# failure that is painful to diagnose after the fact.
#
# It also prints the exact line to put in the DB server's fixup SQL, so the two
# machines cannot end up pointing at different addresses.
#
# Changes nothing. Safe to run at any time.
# ===========================================================================

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"

Write-Host ""
Write-Host "=== APP SERVER: validating .env ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $envPath)) {
    throw ".env not found at $envPath`n   Run:  copy .env.template .env    then edit it."
}

# Hand-parsed rather than sourced: docker compose reads this file as literal
# text with no shell expansion, so parsing it the same way here means the checks
# see exactly what the containers will receive.
$cfg = @{}
foreach ($line in Get-Content $envPath) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2) {
        if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
    }
    $cfg[$k] = $v
}

function Get-Val([string]$n) { if ($cfg.ContainsKey($n)) { return $cfg[$n] } return "" }

$errors   = @()
$warnings = @()

# ---- 1. required and actually filled in ------------------------------------
$required = @(
    "APP_PUBLIC_URL", "ONLYOFFICE_PUBLIC_URL",
    "DB_HOST", "DB_USER", "DB_NAME", "DB_PASSWORD",
    "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
    "KC_DB_USERNAME", "KC_DB_PASSWORD",
    "AUTH_SECRET", "AUTH_KEYCLOAK_SECRET", "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "ONLYOFFICE_JWT_SECRET", "CRON_SECRET",
    "KC_BOOTSTRAP_ADMIN_USERNAME", "KC_BOOTSTRAP_ADMIN_PASSWORD",
    "AUTH_KEYCLOAK_ID", "KEYCLOAK_ADMIN_CLIENT_ID"
)
foreach ($k in $required) {
    $v = Get-Val $k
    if ($v -eq "")                  { $errors += "$k is missing or empty" }
    elseif ($v -like "*<<<*")       { $errors += "$k still has its <<< ... >>> placeholder - fill it in" }
    elseif ($v -like "*CHANGE_ME*") { $errors += "$k still holds a CHANGE_ME placeholder" }
}

# ---- 2. the public URLs ----------------------------------------------------
function Get-UrlHost([string]$u) { try { return ([Uri]$u).Host } catch { return $null } }

$appUrl     = Get-Val "APP_PUBLIC_URL"
$appUrlHost = Get-UrlHost $appUrl

if (-not $appUrlHost) {
    $errors += "APP_PUBLIC_URL is not a valid URL: '$appUrl' (expected e.g. http://10.0.0.50)"
}
if ($appUrl.EndsWith("/")) {
    $errors += "APP_PUBLIC_URL must NOT end with a trailing slash (got '$appUrl') - it is " +
               "concatenated into the OIDC issuer, and '//realms' breaks token validation."
}
# Reaching the site over 127.0.0.1 works from the server console and from
# nowhere else, which looks like success right up until the first client tries.
if ($appUrlHost -eq "localhost" -or $appUrlHost -eq "127.0.0.1") {
    $errors += "APP_PUBLIC_URL points at $appUrlHost. Use this machine's LAN IP - " +
               "client PCs cannot reach localhost, and Keycloak would stamp it into every token."
}

$ooUrl     = Get-Val "ONLYOFFICE_PUBLIC_URL"
$ooUrlHost = Get-UrlHost $ooUrl
if (-not $ooUrlHost) {
    $errors += "ONLYOFFICE_PUBLIC_URL is not a valid URL: '$ooUrl'"
} elseif ($appUrlHost -and $ooUrlHost -ne $appUrlHost) {
    $errors += "ONLYOFFICE_PUBLIC_URL host '$ooUrlHost' differs from APP_PUBLIC_URL host " +
               "'$appUrlHost'. Everything runs on this one machine, so both must be this machine's IP."
}
if ($ooUrl.EndsWith("/")) { $errors += "ONLYOFFICE_PUBLIC_URL must not end with a trailing slash." }

# Ports must match what is actually published, or the browser loads nothing.
$ooPort = Get-Val "ONLYOFFICE_HOST_PORT"; if ($ooPort -eq "") { $ooPort = "8082" }
if ($ooUrlHost) {
    $p = ([Uri]$ooUrl).Port
    if ("$p" -ne "$ooPort") {
        $errors += "ONLYOFFICE_PUBLIC_URL port ($p) does not match ONLYOFFICE_HOST_PORT ($ooPort) - " +
                   "the browser would load the editor from a port nothing is listening on."
    }
}
$nginxPort = Get-Val "NGINX_PORT"; if ($nginxPort -eq "") { $nginxPort = "80" }
if ($appUrlHost) {
    $p = ([Uri]$appUrl).Port
    if ("$p" -ne "$nginxPort") {
        $errors += "APP_PUBLIC_URL port ($p) does not match NGINX_PORT ($nginxPort). " +
                   "Add the port to APP_PUBLIC_URL, e.g. http://$appUrlHost`:$nginxPort"
    }
}

# ---- 3. the DB server ------------------------------------------------------
# A loopback DB_HOST is the single most expensive mistake here: inside a
# container it means the CONTAINER itself, so Keycloak looks for PostgreSQL in
# its own filesystem and only fails minutes into startup, buried in a Java stack
# trace ending "Connection to 127.0.0.1:5432 refused".
$dbHost = Get-Val "DB_HOST"
if ($dbHost -in @("localhost", "127.0.0.1", "::1", "0.0.0.0")) {
    $errors += "DB_HOST is '$dbHost' - inside a container that means the CONTAINER ITSELF, " +
               "not this machine. Separate DB server: use its real IP. " +
               "App and database on ONE machine: use DB_HOST=host.docker.internal"
}

# ---- 4. dangerous rather than merely wrong ---------------------------------
if ((Get-Val "IS_DEV") -ne "") {
    $errors += "IS_DEV is set. In production this BYPASSES ALL AUTHENTICATION. Remove it."
}
$secretNames = @("AUTH_SECRET","AUTH_KEYCLOAK_SECRET","KEYCLOAK_ADMIN_CLIENT_SECRET","ONLYOFFICE_JWT_SECRET","CRON_SECRET")
$seen = @{}
foreach ($k in $secretNames) {
    $v = Get-Val $k
    if ($v -eq "") { continue }
    if ($v.Length -lt 16) { $warnings += "$k is short ($($v.Length) chars). Use 32 random bytes, base64." }
    if ($seen.ContainsKey($v)) { $warnings += "$k has the SAME value as $($seen[$v]). Use a distinct secret for each." }
    else { $seen[$v] = $k }
}

# ---- report ----------------------------------------------------------------
if ($warnings.Count -gt 0) {
    Write-Host "WARNINGS:" -ForegroundColor Yellow
    foreach ($w in $warnings) { Write-Host "  ! $w" -ForegroundColor Yellow }
    Write-Host ""
}
if ($errors.Count -gt 0) {
    Write-Host "CONFIGURATION ERRORS:" -ForegroundColor Red
    foreach ($e in $errors) { Write-Host "  X $e" -ForegroundColor Red }
    Write-Host ""
    throw "Fix $envPath and re-run this script."
}

Write-Host "  .env is consistent." -ForegroundColor Green
Write-Host ""
Write-Host "This deployment will serve:" -ForegroundColor Cyan
Write-Host "  Application      : $appUrl"
Write-Host "  Keycloak         : $appUrl/auth      (console at $appUrl/auth/admin)"
Write-Host "  OIDC issuer      : $appUrl/auth/realms/testing"
Write-Host "  OnlyOffice       : $ooUrl"
Write-Host "  DB server        : $dbHost`:$(Get-Val 'DB_PORT')"
Write-Host ""
Write-Host "CHECK THIS MATCHES THE DB SERVER" -ForegroundColor Yellow
Write-Host "  In db-server\keycloak-seed\fixup-after-restore.sql this line must read:" -ForegroundColor Yellow
Write-Host "      v_app_url text := '$appUrl';" -ForegroundColor White
Write-Host "  If it says anything else, login fails with 'Invalid parameter: redirect_uri'." -ForegroundColor Yellow
Write-Host ""
Write-Host "Next: confirm the DB server is up and seeded, then run scripts\3-start.ps1" -ForegroundColor Green
Write-Host ""
