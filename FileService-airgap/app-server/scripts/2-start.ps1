# Starts the APP stack: Next.js + Nginx.
# Run on the app server AFTER 1-load-images.ps1 and after editing .env.prod
# (set DB_SERVER_IP to your DB server's IP, and match the passwords).
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")
$envprod = Join-Path $dir ".env.prod"

if (Select-String -Path $envprod -Pattern "DB_SERVER_IP" -Quiet) {
    Write-Host "STOP: .env.prod still contains the placeholder 'DB_SERVER_IP'." -ForegroundColor Red
    Write-Host "Edit .env.prod and set it to your DB server's IP/hostname, then re-run." -ForegroundColor Red
    exit 1
}

Push-Location $dir
try {
    docker compose -f docker-compose.prod.yml up -d
}
finally { Pop-Location }

Write-Host "`nApp stack started. The site is served on port 80 (NGINX_PORT)." -ForegroundColor Green
docker ps --format "{{.Names}}`t{{.Status}}" | Select-String -Pattern "next-app|nginx"
