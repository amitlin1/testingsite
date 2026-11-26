# ===========================================================================
# APP SERVER - step 3: start the stack
# ===========================================================================
#   .\scripts\3-start.ps1
#
# THE DB SERVER MUST BE UP AND SEEDED FIRST. Keycloak reads its realm, its
# clients and every user account from the `keycloak` database on that machine;
# it stores nothing locally.
#
# Startup order is enforced by healthchecks:  keycloak -> next-app -> nginx.
# If the DB server is unreachable, NOTHING comes up. That is deliberate - a
# half-started stack serving login pages against a dead database is worse than
# a clean failure.
#
# Safe to re-run: `up -d` reconciles to the desired state and leaves healthy
# containers alone.
# ===========================================================================

# NOT "Stop". docker writes ordinary progress to stderr - "Network ... Creating",
# layer output from `docker load` - and Windows PowerShell 5.1 wraps a native
# command's stderr in an ErrorRecord, which "Stop" turns into a crash. It fires
# only when docker happens to have something to say, so it looks intermittent:
# the same script passes on a second run once the network already exists.
# Every docker call that matters is checked via $LASTEXITCODE, and `throw` stays
# terminating regardless of this setting.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path ".env")) {
        throw ".env not found. Run: copy .env.template .env   then edit it."
    }

    Write-Host ""
    Write-Host "=== APP SERVER: starting ===" -ForegroundColor Cyan
    Write-Host "Keycloak connects to the DB server and validates its schema on boot;"
    Write-Host "allow up to ~90 seconds before it reports healthy."
    Write-Host ""

    docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed. Check the output above." }

    Write-Host ""
    Write-Host "=== Container status ===" -ForegroundColor Cyan
    docker compose ps

    Write-Host ""
    Write-Host "Watch startup:  docker compose logs -f keycloak next-app" -ForegroundColor DarkGray
    Write-Host "Then verify:    .\scripts\4-verify.ps1" -ForegroundColor Green
    Write-Host ""
}
finally {
    Pop-Location
}
