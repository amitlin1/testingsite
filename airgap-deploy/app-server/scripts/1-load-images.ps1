# Loads the APP-server Docker images from ./images (run ONCE on the app server).
# Includes: next-app, nginx, AND the OnlyOffice Document Server (used by the
# item-attachments file editor introduced in 2026-06-04).
$ErrorActionPreference = "Stop"
$img = Join-Path $PSScriptRoot "..\images"

Write-Host "Loading next-app image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "next-app.tar")

Write-Host "Loading nginx image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "nginx.tar")

Write-Host "Loading OnlyOffice Document Server image (large, ~4 GB)..." -ForegroundColor Cyan
docker load -i (Join-Path $img "onlyoffice.tar")

Write-Host "`nLoaded images:" -ForegroundColor Green
docker images --format "{{.Repository}}:{{.Tag}}" | Select-String -Pattern "testingsite-|onlyoffice/documentserver"
