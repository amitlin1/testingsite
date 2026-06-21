# Starts the APP stack: Next.js + Nginx + OnlyOffice DocumentServer.
# Run on the app server AFTER 1-load-images.ps1 and after editing .env.prod.
#
# .env.prod checklist (refuses to start until these are real):
#   - DB_HOST / DATABASE_URL — point at the DB server
#   - DB_PASSWORD, MINIO_ROOT_PASSWORD — match the DB server's .env.db
#   - NEXTAUTH_SECRET — generate with: openssl rand -base64 32
#   - ONLYOFFICE_JWT_SECRET — separate secret, generate the same way
#   - ONLYOFFICE_PUBLIC_URL / NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL — the
#     browser-reachable URL of the DocServer (default http://localhost:8082)
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")
$envprod = Join-Path $dir ".env.prod"

if (-not (Test-Path $envprod)) {
    Write-Host "STOP: .env.prod not found. Copy .env.prod.example -> .env.prod and edit it." -ForegroundColor Red
    exit 1
}

# Quick sanity checks against placeholders that obviously haven't been filled in
$blockers = @(
    @{ pattern = "DB_SERVER_IP";                        msg = "DB_HOST/DATABASE_URL still points at the DB_SERVER_IP placeholder" }
    @{ pattern = "CHANGE_ME";                           msg = "There are CHANGE_ME placeholders left in .env.prod (passwords / secrets)" }
    @{ pattern = "generate_a_secure_random_string_here"; msg = "NEXTAUTH_SECRET is still the example placeholder" }
)
foreach ($b in $blockers) {
    if (Select-String -Path $envprod -Pattern $b.pattern -Quiet) {
        Write-Host ("STOP: " + $b.msg + ". Edit .env.prod and re-run.") -ForegroundColor Red
        exit 1
    }
}

Push-Location $dir
try {
    # NOTE: this compose file has `build:` blocks for next-app and nginx — but
    # on the air-gapped server we use the pre-loaded images and never build,
    # so we pass --no-build. The image names already match, so up -d picks
    # them up from the local daemon.
    docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build
}
finally { Pop-Location }

Write-Host "`nApp stack started." -ForegroundColor Green
Write-Host "  - site         : http://localhost/        (port 80, nginx -> next-app)" -ForegroundColor Gray
Write-Host "  - OnlyOffice   : http://localhost:8082/   (direct host port for the editor iframe)" -ForegroundColor Gray
docker ps --format "{{.Names}}`t{{.Status}}" | Select-String -Pattern "next-app|nginx|onlyoffice"
