# Restore all files from the backup mirror (C:\backups\files) back into MinIO.
# Use if the MinIO data was lost. Does not delete existing objects.
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")

$cfg = @{}
Get-Content (Join-Path $dir ".env.db"), (Join-Path $dir ".env") |
    Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } |
    ForEach-Object { $k, $v = $_ -split '=', 2; $cfg[$k.Trim()] = $v.Trim() }
$user = $cfg['MINIO_ROOT_USER']; $pass = $cfg['MINIO_ROOT_PASSWORD']
$bucket = if ($cfg['MINIO_BUCKET']) { $cfg['MINIO_BUCKET'] } else { 'digitalfactory-files' }

if (-not (Test-Path "C:\backups\files")) { throw "C:\backups\files not found" }

Write-Host "Mirroring C:\backups\files -> bucket '$bucket' ..." -ForegroundColor Cyan
docker run --rm -v "C:\backups\files:/backup" --network db-network --entrypoint sh minio/minio:latest -c `
    "mc alias set dst http://minio:9000 '$user' '$pass' && mc mb -p dst/$bucket; mc mirror --overwrite /backup dst/$bucket"

Write-Host "`nFile restore complete." -ForegroundColor Green
