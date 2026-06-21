# Starts the DB stack: PostgreSQL + MinIO + backup mirrors.
# Run on the DB server AFTER 1-load-images.ps1 and after editing .env.db.
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")
$envdb = Join-Path $dir ".env.db"

if (-not (Test-Path $envdb)) {
    Write-Host "STOP: .env.db not found. Copy .env.db.example -> .env.db and edit it." -ForegroundColor Red
    exit 1
}

# Reject obvious placeholders
foreach ($p in @("CHANGE_ME","changeme")) {
    if (Select-String -Path $envdb -Pattern $p -Quiet) {
        Write-Host "STOP: .env.db still contains '$p' placeholders. Set real passwords and re-run." -ForegroundColor Red
        exit 1
    }
}

# Make sure the host backup folders exist (compose mounts them)
$null = New-Item -ItemType Directory -Force "C:\backups\postgres\daily"
$null = New-Item -ItemType Directory -Force "C:\backups\postgres\monthly"
$null = New-Item -ItemType Directory -Force "C:\backups\files"

Push-Location $dir
try {
    docker compose --env-file .env.db -f docker-compose.db.yml up -d
}
finally { Pop-Location }

Write-Host "`nDB stack started." -ForegroundColor Green
Write-Host "  - postgres   : localhost:5432   (DBeaver / app connections)" -ForegroundColor Gray
Write-Host "  - MinIO API  : localhost:9000   (S3 endpoint — app reads/writes here)" -ForegroundColor Gray
Write-Host "  - MinIO UI   : http://localhost:9001/   (admin console)" -ForegroundColor Gray
docker ps --format "{{.Names}}`t{{.Status}}" | Select-String -Pattern "postgres|minio|FileServiceDB"
