# ===========================================================================
# Permissions in Keycloak: perm-/no- roles and the main roles' bundles
# ===========================================================================
# Run it on the machine where Keycloak runs (its container "keycloak"). No
# password and no token are needed:
#
#   .\keycloak-permissions.ps1                     # check only (changes nothing)
#   .\keycloak-permissions.ps1 -Apply              # create the roles, fill the bundles
#   .\keycloak-permissions.ps1 -Apply -Deny "step-back=user1,user2"
#
# How it logs in without a password: whoever may run docker on this machine
# already controls Keycloak, so it asks Keycloak itself for a temporary admin
# login - `kc.sh bootstrap-admin service` inside the keycloak container, with a
# random secret that exists only in this process - uses it, and deletes it at
# the end (a login left by a run that died is deleted by the next run). The
# secret never appears on a command line or on disk.
#
# The work itself is keycloak-permissions.mjs (next to this file), run with
# node from the app's image on Keycloak's docker network - the host needs no
# node. Its table is permissions.json - next to this file in a release folder,
# else the app's own src\lib\auth\permissions.json in the repo. In short: apply
# only ADDS (roles, and bundle entries for a role never filled), never removes a
# permission a manager took out of a bundle in Keycloak (unless -ResetBundles),
# and touches no user except those named in -Deny.
#
# Order on a release: run this (check, then -Apply) BEFORE starting the new app
# version. The version before it ignores the new roles, so running it early
# changes nothing for anyone.
#
# A Keycloak on ANOTHER machine: pass -KeycloakUrl; then its admin logs in with
# a password (asked here, hidden; or $env:KC_ADMIN_PASSWORD).
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
    # The Keycloak container on this machine.
    [string]$Container = "keycloak",
    # Keycloak's path (baked into the production image: /auth).
    [string]$KeycloakPath = "/auth",
    [string]$Realm = "testing",
    # The app's image: its node runs the script.
    [string]$Image = "testingsite-next-app:latest",

    # ---- only for a Keycloak on another machine ----
    # Its server URL with the path, e.g. https://host/auth. Switches to a password login.
    [string]$KeycloakUrl = "",
    [string]$AdminUser = "admin",
    [string]$AdminRealm = "master",
    # With -KeycloakUrl: run node inside $Image on this docker network instead of the host's node.
    [switch]$Docker,
    [string]$Network = "shifthouse-network"
)

# Not "Stop": in Windows PowerShell 5.1 a native command's stderr then aborts the script before
# its exit code can be read. Every failure below is checked and thrown explicitly.
$ErrorActionPreference = "Continue"

# A refusal: one red line and exit 1, not a PowerShell error dump. (A `finally` still runs.)
function Stop-Run([string]$message) {
    Write-Host ""
    Write-Host "ERROR: $message" -ForegroundColor Red
    exit 1
}

$here = $PSScriptRoot
$script = Join-Path $here "keycloak-permissions.mjs"
if (-not (Test-Path $script)) { Stop-Run "keycloak-permissions.mjs not found next to this file ($here)." }

$table = Join-Path $here "permissions.json"
if (-not (Test-Path $table)) {
    $table = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) "src\lib\auth\permissions.json"
}
if (-not (Test-Path $table)) { Stop-Run "permissions.json not found (next to this file, or src\lib\auth in the repo)." }
$table = (Resolve-Path $table).Path
$scriptDir = (Resolve-Path $here).Path
$tableDir = Split-Path -Parent $table
$tableName = Split-Path -Leaf $table

$mode = "check"
if ($Apply) { $mode = "apply" }
$common = @("--realm", $Realm, "--admin-realm", $AdminRealm)
foreach ($d in $Deny) { $common += @("--deny", $d) }
if ($ResetBundles) { $common += "--reset-bundles" }

function Invoke-Native([string]$exe, [string[]]$argList) {
    # Native output straight to the screen (not into the return value); the exit code back.
    & $exe @argList | Out-Host
    return $LASTEXITCODE
}

function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host ""
Write-Host "=== Keycloak permissions: $mode ===" -ForegroundColor Cyan
Write-Host "Table: $table"

$code = 1
if (-not $KeycloakUrl) {
    # ---------------- on the Keycloak machine: no password ----------------
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-Run "docker is not installed here. Run this on the machine where Keycloak runs." }
    $state = docker inspect -f "{{.State.Running}}" $Container 2>$null
    if ($state -ne "true") {
        Stop-Run "No running container '$Container' here. Run this on the machine where Keycloak runs (or pass -Container), or use -KeycloakUrl for a Keycloak elsewhere."
    }
    docker image inspect $Image 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Run "Image '$Image' not found here (it supplies node). Pass -Image." }
    $net = (docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $Container).Trim().Split(" ")[0]
    $cmd = docker inspect -f '{{json .Config.Cmd}}' $Container
    $url = "http://${Container}:8080$KeycloakPath"
    Write-Host "Keycloak: container '$Container' ($url on network '$net')   realm: $Realm"

    $clientId = "perm-script-" + (Get-Date -Format "yyyyMMddHHmmss")
    $env:PERM_TMP_SECRET = New-Secret
    try {
        Write-Host ""
        Write-Host "Creating a temporary admin login ($clientId), deleted at the end..." -ForegroundColor Yellow
        # A second Keycloak process in the container, which only writes the login and exits. The
        # live server holds the management port (9000), so this one is pointed elsewhere.
        $boot = @("exec", "-e", "PERM_TMP_SECRET", $Container, "/opt/keycloak/bin/kc.sh", "bootstrap-admin", "service",
                  "--client-id", $clientId, "--client-secret:env=PERM_TMP_SECRET", "--no-prompt", "--http-management-port=9099")
        if ($cmd -match "--optimized") { $boot += "--optimized" }
        $bootOut = & docker @boot 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $bootOut -notmatch "Created temporary admin service account") {
            Write-Host $bootOut
            Stop-Run "Keycloak did not create the temporary login (see above). Nothing was changed."
        }

        $env:KC_ADMIN_CLIENT_SECRET = $env:PERM_TMP_SECRET
        $run = @("run", "--rm", "--network", $net, "-e", "KC_ADMIN_CLIENT_SECRET",
                 "-v", "${scriptDir}:/kc/script:ro", "-v", "${tableDir}:/kc/table:ro",
                 "--entrypoint", "node", $Image, "/kc/script/keycloak-permissions.mjs",
                 $mode, "--url", $url, "--client-id", $clientId, "--temp-client", "--table", "/kc/table/$tableName") + $common
        $code = Invoke-Native "docker" $run
    } finally {
        Remove-Item Env:PERM_TMP_SECRET, Env:KC_ADMIN_CLIENT_SECRET -ErrorAction SilentlyContinue
    }
} else {
    # ---------------- a Keycloak elsewhere: its admin's password ----------------
    Write-Host "Keycloak: $KeycloakUrl   realm: $Realm   admin: $AdminUser@$AdminRealm"
    $hadPassword = [bool]$env:KC_ADMIN_PASSWORD
    if (-not $hadPassword) {
        $secure = Read-Host -AsSecureString "Keycloak admin password for '$AdminUser'"
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:KC_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    try {
        $nodeArgs = @($mode, "--url", $KeycloakUrl, "--user", $AdminUser) + $common
        if ($Docker) {
            $run = @("run", "--rm", "--network", $Network, "-e", "KC_ADMIN_PASSWORD",
                     "-v", "${scriptDir}:/kc/script:ro", "-v", "${tableDir}:/kc/table:ro",
                     "--entrypoint", "node", $Image, "/kc/script/keycloak-permissions.mjs") + $nodeArgs + @("--table", "/kc/table/$tableName")
            $code = Invoke-Native "docker" $run
        } else {
            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Run "node is not installed here. Add -Docker." }
            $code = Invoke-Native "node" (@($script) + $nodeArgs + @("--table", $table))
        }
    } finally {
        if (-not $hadPassword) { Remove-Item Env:KC_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
    }
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
