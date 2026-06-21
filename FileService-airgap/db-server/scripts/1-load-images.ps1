# Loads the DB-server Docker images from ./images (run ONCE on the DB server).
$ErrorActionPreference = "Stop"
$img = Join-Path $PSScriptRoot "..\images"

Write-Host "Loading postgres image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "postgres-16-alpine.tar")
Write-Host "Loading MinIO image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "minio.tar")

Write-Host "`nLoaded images:" -ForegroundColor Green
docker images --format "{{.Repository}}:{{.Tag}}" | Select-String -Pattern "postgres|minio"
