# PROD Server Deployment Runbook

Step-by-step guide for deploying Next.js + Nginx on the PROD server.

---

## Prerequisites

- Docker and Docker Compose installed
- Docker running in Linux container mode
- Deployment package (ZIP) transferred to server
- Network access to DB server on port 5432

---

## Initial Deployment

### 1. Extract Deployment Package

```powershell
# Extract to deployment directory
Expand-Archive -Path "deployment-package.zip" -DestinationPath "C:\app" -Force
cd C:\app
```

### 2. Configure Environment

```powershell
# Copy example and edit
Copy-Item .env.prod.example .env.prod

# Edit with production values
notepad .env.prod
```

**Required changes in `.env.prod`:**

- `DB_HOST` → IP address of DB server
- `DB_PASSWORD` → Actual database password
- `NEXTAUTH_SECRET` → Generate with `openssl rand -base64 32`

### 3. Build Images

```powershell
# Build Next.js image (uses embedded npm cache)
docker compose -f docker-compose.prod.yml build next-app

# Build Nginx image
docker compose -f docker-compose.prod.yml build nginx
```

### 4. Start Services

```powershell
docker compose -f docker-compose.prod.yml up -d
```

### 5. Verify Deployment

```powershell
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs -f --tail=100

# Health check
Invoke-WebRequest -Uri "http://localhost/health" -UseBasicParsing
Invoke-WebRequest -Uri "http://localhost/" -UseBasicParsing
```

---

## Configuration Changes (No Rebuild)

When changing DB host, password, secrets, or other runtime config:

```powershell
# 1. Edit environment file
notepad .env.prod

# 2. Restart containers (picks up new env)
docker compose -f docker-compose.prod.yml up -d

# 3. Verify
docker compose -f docker-compose.prod.yml logs -f --tail=50
```

**No rebuild required for:**

- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
- DATABASE_URL
- NEXTAUTH_SECRET, JWT_SECRET
- APP_BASE_URL, APP_VERSION
- FEATURE_FLAGS

---

## Updates with New Code

When deploying new application version:

```powershell
# 1. Transfer new deployment package

# 2. Stop current containers
docker compose -f docker-compose.prod.yml down

# 3. Tag current images for rollback
docker tag next-app:latest next-app:previous
docker tag nginx:latest nginx:previous

# 4. Extract new code (backup old first)
Move-Item C:\app C:\app-backup-$(Get-Date -Format "yyyyMMdd")
Expand-Archive -Path "deployment-package-new.zip" -DestinationPath "C:\app"
cd C:\app

# 5. Copy existing .env.prod
Copy-Item ..\app-backup-*\.env.prod .env.prod

# 6. Rebuild and start
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

---

## Rollback Procedure

```powershell
# Stop current containers
docker compose -f docker-compose.prod.yml down

# Restore previous images
docker tag next-app:previous next-app:latest
docker tag nginx:previous nginx:latest

# Start with previous images
docker compose -f docker-compose.prod.yml up -d
```

---

## Troubleshooting

### Container not starting

```powershell
docker compose -f docker-compose.prod.yml logs next-app
docker compose -f docker-compose.prod.yml logs nginx
```

### Check if port 80 is in use

```powershell
netstat -an | Select-String ":80"
```

### Test database connectivity from container

```powershell
docker compose -f docker-compose.prod.yml exec next-app sh -c "wget -qO- http://DB_HOST:5432 || echo 'Connection test complete'"
```

### Nginx not forwarding requests

```powershell
# Check nginx config syntax
docker compose -f docker-compose.prod.yml exec nginx nginx -t

# Check next-app is responding
docker compose -f docker-compose.prod.yml exec nginx wget -qO- http://next-app:3000/
```
