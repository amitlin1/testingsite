# Starts the DB stack: Postgres + MinIO (FileServiceDB) + backup sidecars.
# Run on the DB server AFTER 1-load-images.ps1 and after editing .env.db.
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")

# Backup target folders on this Windows host
New-Item -ItemType Directory -Force "C:\backups\files","C:\backups\postgres" | Out-Null

Push-Location $dir
try {
    docker compose -f docker-compose.db.yml up -d
}
finally { Pop-Location }

Write-Host "`nDB stack started." -ForegroundColor Green
docker ps --format "{{.Names}}`t{{.Status}}" | Select-String -Pattern "postgres|FileServiceDB"
Write-Host "`nNEXT STEP:" -ForegroundColor Yellow
Write-Host "  Open DBeaver -> connect to this host : 5432, database 'InventoryDB'" -ForegroundColor Yellow
Write-Host "  -> open schema.sql and run the whole script ONCE (creates all tables + seed data)." -ForegroundColor Yellow
