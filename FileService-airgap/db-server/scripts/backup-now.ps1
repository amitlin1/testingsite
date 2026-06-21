# Triggers an immediate backup (each backup sidecar backs up on (re)start).
# Use before a risky change. Output lands in C:\backups.
$ErrorActionPreference = "Stop"
docker restart digitalfactory-postgres-backup | Out-Null
docker restart FileServiceDB-backup | Out-Null
Start-Sleep -Seconds 3
Write-Host "Triggered immediate backups. Recent files:" -ForegroundColor Green
Get-ChildItem C:\backups\postgres\daily -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name,Length
docker logs FileServiceDB-backup --tail 3
