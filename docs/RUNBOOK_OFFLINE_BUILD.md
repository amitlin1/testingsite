# Offline Build Runbook

Complete workflow for building Next.js Docker image in an air-gapped environment.

---

## Overview

This workflow uses an **embedded npm cache** approach:

1. On ONLINE machine: Install dependencies, capturing the npm cache
2. Package: Include cache in deployment ZIP
3. On OFFLINE machine: Build Docker image using cached packages

---

## Phase 1: Online Machine Preparation

### 1.1 Create Cache Directory

```powershell
New-Item -ItemType Directory -Force -Path "D:\offline\npm-cache"
```

### 1.2 Clean Local State

```powershell
cd C:\Amit_Projects\testingSite

# Remove existing node_modules and lock state
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
```

### 1.3 Install Dependencies with Cache Population

```powershell
# Set npm to use dedicated cache
$env:npm_config_cache = "D:\offline\npm-cache"

# Generate lock file and install
npm install

# Verify lock file exists
Test-Path package-lock.json
```

### 1.4 Copy Cache into Project

```powershell
# Create offline cache folder in project
New-Item -ItemType Directory -Force -Path ".npm-offline"

# Copy cached packages
Copy-Item -Recurse -Force "D:\offline\npm-cache\*" ".npm-offline\"

# Verify cache size (expect 100-400MB)
(Get-ChildItem -Recurse ".npm-offline" | Measure-Object -Property Length -Sum).Sum / 1MB
```

### 1.5 Save Required Docker Images

```powershell
# Pull base images
docker pull node:20.18.0-bullseye-slim
docker pull nginx:1.25.4-alpine
docker pull postgres:16-alpine

# Save to tar files
docker save node:20.18.0-bullseye-slim -o "D:\offline\node-20.18.0-bullseye-slim.tar"
docker save nginx:1.25.4-alpine -o "D:\offline\nginx-1.25.4-alpine.tar"
docker save postgres:16-alpine -o "D:\offline\postgres-16-alpine.tar"
```

### 1.6 Create Deployment Package

```powershell
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# Create ZIP with all required files
Compress-Archive -Path @(
    "src",
    "public",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "postcss.config.mjs",
    "Dockerfile",
    ".dockerignore",
    ".npm-offline",
    "nginx",
    "docs",
    "docker-compose.prod.yml",
    "docker-compose.db.yml",
    ".env.prod.example",
    ".env.db.example"
) -DestinationPath "D:\offline\deployment-package-$timestamp.zip" -Force

Write-Host "Created: D:\offline\deployment-package-$timestamp.zip"
```

---

## Phase 2: Verify Offline Capability (Optional)

Before transferring, test that the cache is complete:

```powershell
# Create test directory
$testDir = "D:\offline\test-install"
New-Item -ItemType Directory -Force -Path $testDir

# Copy project files
Copy-Item package.json, package-lock.json $testDir
Copy-Item -Recurse ".npm-offline" "$testDir\.npm-offline"

cd $testDir

# Force offline mode
$env:npm_config_offline = "true"
$env:npm_config_cache = "$testDir\.npm-offline"

# Attempt install
npm ci --offline

# If successful, cleanup
cd ..
Remove-Item -Recurse -Force $testDir
```

If this fails, some packages are missing from cache. Run `npm install` again online.

---

## Phase 3: Transfer to Offline Network

Transfer these files to the PROD server:

- `deployment-package-YYYYMMDD-HHMMSS.zip`
- `node-20.18.0-bullseye-slim.tar`
- `nginx-1.25.4-alpine.tar`

Transfer to DB server:

- `docker-compose.db.yml`
- `.env.db.example`
- `postgres-16-alpine.tar`

---

## Phase 4: Offline Machine Build

### 4.1 Load Docker Images

```powershell
docker load -i "node-20.18.0-bullseye-slim.tar"
docker load -i "nginx-1.25.4-alpine.tar"

# Verify
docker images | Select-String "node|nginx"
```

### 4.2 Extract Deployment Package

```powershell
Expand-Archive -Path "deployment-package-*.zip" -DestinationPath "C:\app" -Force
cd C:\app
```

### 4.3 Build Next.js Image

```powershell
docker compose -f docker-compose.prod.yml build next-app
```

The Dockerfile is configured to:

1. Copy `.npm-offline` into the build context
2. Set `npm_config_offline=true`
3. Run `npm ci` using cached packages only

### 4.4 Build Nginx Image

```powershell
docker compose -f docker-compose.prod.yml build nginx
```

### 4.5 Configure and Start

See [RUNBOOK_PROD_SERVER.md](./RUNBOOK_PROD_SERVER.md) for remaining steps.

---

## Pre-Flight Checklist

Before transferring to offline environment:

```
□ package-lock.json exists and is up to date
□ .npm-offline folder size is reasonable (100-400MB)
□ Offline install test passed
□ All base images saved to tar files
□ .env.prod.example and .env.db.example included
□ Documentation (docs/) included
□ No NEXT_PUBLIC_* variables that need to change per-environment
```

---

## Troubleshooting

### npm ci fails offline with "package not found"

The cache is incomplete. On online machine:

1. Delete `.npm-offline`
2. Delete `D:\offline\npm-cache`
3. Re-run Phase 1 from start

### Native dependencies failing

Check for packages that download binaries at install:

- `sharp` - needs prebuilt binaries
- `esbuild` - downloads platform binary
- `node-canvas` - needs system libs

**Your project doesn't use these**, but if added later:

```powershell
# Force platform-specific download on online machine
npm rebuild
```

### Build context too large

If Docker build is very slow or times out:

```powershell
# Check context size
(Get-ChildItem -Recurse -Exclude "node_modules",".git" | Measure-Object -Property Length -Sum).Sum / 1MB

# Ensure .dockerignore excludes node_modules
Get-Content .dockerignore | Select-String "node_modules"
```

### "Cannot find module" at runtime

The standalone output might be missing files:

1. Check `next.config.ts` has `output: "standalone"`
2. Rebuild: `docker compose -f docker-compose.prod.yml build --no-cache next-app`
