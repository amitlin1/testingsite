# Loads the APP-server Docker images from ./images (run ONCE on the app server).
$ErrorActionPreference = "Stop"
$img = Join-Path $PSScriptRoot "..\images"

Write-Host "Loading next-app image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "next-app.tar")
Write-Host "Loading nginx image..." -ForegroundColor Cyan
docker load -i (Join-Path $img "nginx.tar")

Write-Host "`nLoaded images:" -ForegroundColor Green
docker images --format "{{.Repository}}:{{.Tag}}" | Select-String -Pattern "testingsite-"
