# ===========================================================================
# Permissions in Keycloak: perm-/no- roles and the main roles' bundles
# ===========================================================================
#   .\scripts\ops\keycloak-permissions.ps1                       # check only (changes nothing)
#   .\scripts\ops\keycloak-permissions.ps1 -Apply                # create the roles, fill the bundles
#   .\scripts\ops\keycloak-permissions.ps1 -Apply -Deny "step-back=user1,user2"
#
# Production (no node on the host): add -Docker. node then runs inside the app
# image, on the app's docker network, and reaches Keycloak at
# http://keycloak:8080/auth:
#   .\keycloak-permissions.ps1 -Docker            # check
#   .\keycloak-permissions.ps1 -Docker -Apply
#
# Runs keycloak-permissions.mjs (next to this file) with the table
# permissions.json - next to this file in a release folder, else the app's own
# src\lib\auth\permissions.json in the repo. The mjs says in full what it does;
# in short: apply only ADDS (roles, and bundle entries for a role never filled),
# never removes a permission a manager took out of a bundle in Keycloak (unless
# -ResetBundles), and touches no user except those named in -Deny.
#
# Order on a release: run this (check, then -Apply) BEFORE starting the new app
# version. The version before it ignores the new roles, so running it early
# changes nothing for anyone.
#
# Login: the Keycloak ADMIN (master realm). The password is asked for here
# (hidden), or read from $env:KC_ADMIN_PASSWORD when set, and handed to node
# through its environment only - never on a command line.
# ===========================================================================

param(
    # Make the changes. Without it: report only.
    [switch]$Apply,
    # Take a permission away from users: "<permission>=<user>,<user>" (repeatable),
    # e.g. "step-back=user1,user2". Permission names: the perm-... role without
    # "perm-" (see the check's output).
    [string[]]$Deny = @(),
    # Make every bundle exactly the table's defaults (adds AND removes).
    [switch]$ResetBundles,
    # Keycloak server (with the /auth path). Default: http://keycloak:8080/auth with
    # -Docker, else APP_PUBLIC_URL/auth from the app-server .env.
    [string]$KeycloakUrl = "",
    [string]$Realm = "testing",
    [string]$AdminUser = "admin",
    [string]$AdminRealm = "master",
    # Run node inside the app image (for a machine without node).
    [switch]$Docker,
    [string]$Image = "testingsite-next-app:latest",
    [string]$Network = "shifthouse-network",
    # The app-server .env (for the default URL without -Docker).
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
$script = Join-Path $here "keycloak-permissions.mjs"
if (-not (Test-Path $script)) { throw "keycloak-permissions.mjs not found next to this file ($here)." }

$table = Join-Path $here "permissions.json"
if (-not (Test-Path $table)) {
    $table = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) "src\lib\auth\permissions.json"
}
if (-not (Test-Path $table)) { throw "permissions.json not found (next to this file, or src\lib\auth in the repo)." }
$table = (Resolve-Path $table).Path

# ---- where Keycloak is ----
if (-not $KeycloakUrl) {
    if ($Docker) {
        $KeycloakUrl = "http://keycloak:8080/auth"
    } else {
        if (-not $EnvFile) {
            $EnvFile = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) "deploy\app-server\.env"
        }
        if (Test-Path $EnvFile) {
            $line = Get-Content $EnvFile | Where-Object { $_ -match '^\s*APP_PUBLIC_URL\s*=' } | Select-Object -First 1
            if ($line) { $KeycloakUrl = ($line -replace '^\s*APP_PUBLIC_URL\s*=\s*', '').Trim().Trim('"').TrimEnd('/') + "/auth" }
        }
        if (-not $KeycloakUrl) { throw "Pass -KeycloakUrl (e.g. https://host/auth), or -Docker on the app machine." }
    }
}

$mode = "check"
if ($Apply) { $mode = "apply" }
$nodeArgs = @($mode, "--url", $KeycloakUrl, "--realm", $Realm, "--user", $AdminUser, "--admin-realm", $AdminRealm)
foreach ($d in $Deny) { $nodeArgs += @("--deny", $d) }
if ($ResetBundles) { $nodeArgs += "--reset-bundles" }

Write-Host ""
Write-Host "=== Keycloak permissions: $mode ===" -ForegroundColor Cyan
Write-Host "Keycloak: $KeycloakUrl   realm: $Realm   admin: $AdminUser@$AdminRealm"
Write-Host "Table:    $table"

# ---- the admin password (never on a command line) ----
$hadPassword = [bool]$env:KC_ADMIN_PASSWORD
if (-not $hadPassword) {
    $secure = Read-Host -AsSecureString "Keycloak admin password for '$AdminUser'"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:KC_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

try {
    if ($Docker) {
        $scriptDir = (Resolve-Path $here).Path
        $tableDir = Split-Path -Parent $table
        $tableName = Split-Path -Leaf $table
        $dockerArgs = @(
            "run", "--rm", "--network", $Network,
            "-e", "KC_ADMIN_PASSWORD",
            "-v", "${scriptDir}:/kc/script:ro",
            "-v", "${tableDir}:/kc/table:ro",
            "--entrypoint", "node",
            $Image,
            "/kc/script/keycloak-permissions.mjs"
        ) + $nodeArgs + @("--table", "/kc/table/$tableName")
        & docker @dockerArgs
    } else {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            throw "node is not installed here. Run with -Docker on the app machine."
        }
        & node $script @nodeArgs --table $table
    }
    $code = $LASTEXITCODE
} finally {
    if (-not $hadPassword) { Remove-Item Env:KC_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
}

Write-Host ""
if ($code -ne 0) {
    Write-Host "FAILED (exit $code) - see the error above." -ForegroundColor Red
    exit $code
}
if ($Apply) {
    Write-Host "Done." -ForegroundColor Green
} else {
    Write-Host "Check only - nothing was changed. Run again with -Apply to make the changes." -ForegroundColor Yellow
}
