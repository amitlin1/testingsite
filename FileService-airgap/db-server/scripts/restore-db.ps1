# Restore PostgreSQL from a gzipped dump.  *** DESTRUCTIVE ***  (overwrites the DB)
# Usage:  .\restore-db.ps1 -DumpFile C:\backups\postgres\monthly\db-2026-05.sql.gz
# Tip: stop the APP server first so nothing writes during the restore.
param([Parameter(Mandatory = $true)][string]$DumpFile)
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not (Test-Path $DumpFile)) { throw "Dump not found: $DumpFile" }

# Read credentials from .env.db
$cfg = @{}
Get-Content (Join-Path $dir ".env.db") |
    Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } |
    ForEach-Object { $k, $v = $_ -split '=', 2; $cfg[$k.Trim()] = $v.Trim() }
$u = $cfg['POSTGRES_USER']; $p = $cfg['POSTGRES_PASSWORD']; $d = $cfg['POSTGRES_DB']

Write-Host "This will OVERWRITE database '$d' from:`n  $DumpFile" -ForegroundColor Red
if ((Read-Host "Type 'yes' to continue") -ne 'yes') { Write-Host "Aborted."; exit 0 }

# 1) drop & recreate empty database (identifier is double-quoted for psql)
$sql = "DROP DATABASE `"$d`" WITH (FORCE); CREATE DATABASE `"$d`" OWNER $u;"
docker exec postgres psql -U $u -d postgres -c $sql

# 2) stream the gz dump into psql via a temp container on the db-network
$dumpDir = (Resolve-Path (Split-Path -Parent $DumpFile)).Path
$dumpName = Split-Path -Leaf $DumpFile
docker run --rm -i -v "${dumpDir}:/b" --network db-network -e PGPASSWORD=$p postgres:16-alpine `
    sh -c "zcat /b/$dumpName | psql -h postgres -U $u -d $d"

Write-Host "`nDatabase restore complete." -ForegroundColor Green
