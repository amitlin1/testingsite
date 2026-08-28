# scripts/reset-db.ps1
# Resets the database schema using Prisma:
# 1. Drops all existing tables
# 2. Re-applies the schema from prisma/schema.prisma
# 3. Runs prisma generate to update the client
#
# WARNING: This will DELETE ALL DATA in the database!
# Only run this if you want a fresh start.

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Red
Write-Host "  WARNING: This will DELETE ALL DATA!" -ForegroundColor Red
Write-Host "============================================" -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Are you sure? Type 'yes' to continue"
if ($confirm -ne "yes") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Step 1: Resetting database (drop + re-create schema)..." -ForegroundColor Cyan

# prisma migrate reset drops all tables and re-applies migrations
# --force skips the interactive confirmation (we already confirmed above)
# --skip-seed skips seeding (optional, remove if you have a seed file)
npx prisma migrate reset --force --skip-seed

if ($LASTEXITCODE -ne 0) {
    # NO db push fallback. `prisma db push --force-reset` recreates only what
    # schema.prisma declares — every raw-SQL object from migrations (triggers,
    # functions, materialized views, EXCLUDE constraints) silently vanishes,
    # leaving a database that LOOKS right and misbehaves later. If migrate
    # reset fails, fix the migration instead of bypassing it.
    Write-Error "prisma migrate reset failed - fix the failing migration (no db push fallback)."
    exit 1
}

Write-Host ""
Write-Host "Step 2: Generating Prisma Client..." -ForegroundColor Cyan
npx prisma generate

if ($LASTEXITCODE -ne 0) {
    Write-Error "prisma generate failed!"
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Database reset complete!" -ForegroundColor Green
Write-Host "  Schema applied from prisma/schema.prisma" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
