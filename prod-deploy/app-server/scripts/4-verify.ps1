# ===========================================================================
# APP SERVER - step 4: verify the deployment
# ===========================================================================
#   .\scripts\4-verify.ps1
#
# Checks the things that actually break in an air-gapped IP-addressed install,
# in the order a login request travels through them. A red line here should tell
# you what to fix without reading any container logs.
# ===========================================================================

$ErrorActionPreference = "Continue"

$root    = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"

$cfg = @{}
foreach ($line in Get-Content $envPath) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $cfg[$t.Substring(0,$i).Trim()] = $t.Substring($i+1).Trim()
}
$appUrl = $cfg["APP_PUBLIC_URL"]
$ooUrl  = $cfg["ONLYOFFICE_PUBLIC_URL"]
$issuer = "$appUrl/auth/realms/testing"

$pass = 0; $fail = 0
function Test-Step([string]$name, [scriptblock]$check, [string]$hint) {
    Write-Host -NoNewline ("  {0,-48}" -f $name)
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
Write-Host "=== Verifying $appUrl ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Containers:" -ForegroundColor Cyan
foreach ($c in @("keycloak","next-app","nginx","onlyoffice")) {
    Test-Step "$c is running" {
        (docker inspect -f '{{.State.Status}}' $c 2>$null) -eq "running"
    } "docker compose logs $c"
}

Write-Host ""
Write-Host "Public endpoints (what a user's browser reaches):" -ForegroundColor Cyan

Test-Step "app answers on the public IP" {
    (Invoke-WebRequest -Uri "$appUrl/api/health" -UseBasicParsing -TimeoutSec 15).StatusCode -eq 200
} "nginx cannot reach next-app, or the IP in APP_PUBLIC_URL is not this machine's."

Test-Step "Keycloak answers under /auth" {
    (Invoke-WebRequest -Uri "$issuer/.well-known/openid-configuration" -UseBasicParsing -TimeoutSec 15).StatusCode -eq 200
} "Keycloak is not reachable at $appUrl/auth. Check the nginx /auth location and that keycloak is healthy."

# The single most valuable check. Keycloak stamps this exact string into every
# token; the app rejects anything else. A mismatch (a stray slash, the wrong IP,
# http vs https) causes a login loop that logs nothing useful.
Test-Step "issuer matches what the app expects" {
    $doc = Invoke-RestMethod -Uri "$issuer/.well-known/openid-configuration" -TimeoutSec 15
    if ($doc.issuer -ne $issuer) {
        Write-Host ""
        Write-Host "      Keycloak says : $($doc.issuer)" -ForegroundColor DarkGray
        Write-Host "      App expects   : $issuer" -ForegroundColor DarkGray
        return $false
    }
    return $true
} "KC_HOSTNAME is derived from APP_PUBLIC_URL - fix that in .env and restart keycloak."

# Catches the case where the DB seed was restored but the fixup SQL was never
# run, or was run with a different address. Symptom without this check: the
# login page appears, then Keycloak refuses to send the browser back.
Test-Step "login client accepts this server's redirect URI" {
    $u = "$issuer/protocol/openid-connect/auth?client_id=testing-web&response_type=code&scope=openid" +
         "&redirect_uri=" + [uri]::EscapeDataString("$appUrl/api/auth/callback/keycloak") +
         "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction SilentlyContinue
    # 200 = Keycloak rendered its login page, i.e. the redirect URI is registered.
    # A 302 back to the app carrying ?error=invalid_request means it is not.
    return ($r.StatusCode -eq 200)
} "Run fixup-after-restore.sql on the DB server with v_app_url = '$appUrl', then restart keycloak."

Test-Step "OnlyOffice answers on its own port" {
    (Invoke-WebRequest -Uri "$ooUrl/healthcheck" -UseBasicParsing -TimeoutSec 15).StatusCode -eq 200
} "Not reachable at $ooUrl. Confirm the port is published AND open to client PCs in the firewall."

Write-Host ""
Write-Host "Internal paths (containers calling each other - the usual silent failure):" -ForegroundColor Cyan

# These are the calls that would otherwise target the host's LAN IP and hang
# until timeout, showing up as a slow login and then a logout.
Test-Step "next-app -> Keycloak (token + refresh)" {
    $out = docker exec next-app node -e "fetch('http://keycloak:8080/auth/realms/testing/.well-known/openid-configuration').then(r=>console.log(r.status)).catch(e=>console.log('ERR '+e.message))" 2>&1
    return ("$out" -match "200")
} "The keycloak container is not reachable on the compose network. docker compose logs keycloak"

Test-Step "onlyoffice -> app (document fetch + save)" {
    $out = docker exec onlyoffice curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://nginx/api/health" 2>&1
    return ("$out" -match "200")
} "OnlyOffice cannot reach the app, so documents will not open. Check APP_INTERNAL_URL."

Write-Host ""
if ($fail -eq 0) {
    Write-Host "All $pass checks passed." -ForegroundColor Green
    Write-Host ""
    Write-Host "Open $appUrl in a browser and sign in." -ForegroundColor Green
    Write-Host "FIRST TASK: change the seeded account passwords from the app's user-management page." -ForegroundColor Yellow
} else {
    Write-Host "$fail check(s) failed, $pass passed." -ForegroundColor Red
}
Write-Host ""
