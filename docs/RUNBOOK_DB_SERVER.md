# DB Server Deployment Runbook

Step-by-step guide for deploying PostgreSQL on the DB server.

---

## Prerequisites

- Docker and Docker Compose installed
- Docker running in Linux container mode
- Port 5432 open to PROD server network

---

## Initial Deployment

### 1. Copy Required Files

Transfer these files to DB server:

- `docker-compose.db.yml`
- `.env.db.example`

### 2. Configure Environment

```powershell
# Copy example and edit
Copy-Item .env.db.example .env.db

# Edit with production values
notepad .env.db
```

**Required changes in `.env.db`:**

- `POSTGRES_USER` → Application user (e.g., `appuser`)
- `POSTGRES_PASSWORD` → Strong password (use `openssl rand -base64 24`)
- `POSTGRES_DB` → Database name (e.g., `testingsite`)

### 3. Pull PostgreSQL Image

On an **online machine**, save the image:

```powershell
docker pull postgres:16-alpine
docker save postgres:16-alpine -o postgres-16-alpine.tar
```

Transfer `postgres-16-alpine.tar` to DB server, then load:

```powershell
docker load -i postgres-16-alpine.tar
```

### 4. Start PostgreSQL

```powershell
docker compose -f docker-compose.db.yml up -d
```

### 5. Verify

```powershell
# Check container status
docker compose -f docker-compose.db.yml ps

# Check logs
docker compose -f docker-compose.db.yml logs -f

# Test connection
docker compose -f docker-compose.db.yml exec postgres psql -U appuser -d testingsite -c "SELECT 1;"
```

---

## Database Initialization

If you have schema SQL files, run them:

```powershell
# Copy SQL file into container and execute
docker cp schema.sql postgres:/tmp/
docker compose -f docker-compose.db.yml exec postgres psql -U appuser -d testingsite -f /tmp/schema.sql
```

Or use init scripts (run only on first start):

1. Create folder `init-db/`
2. Place SQL files in order: `01-schema.sql`, `02-seed.sql`
3. Uncomment volume mount in `docker-compose.db.yml`
4. Recreate container: `docker compose -f docker-compose.db.yml up -d --force-recreate`

---

## Backup Procedures

### Manual Backup

```powershell
# Create backup directory
New-Item -ItemType Directory -Force -Path "C:\backups"

# Create timestamped backup
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker compose -f docker-compose.db.yml exec -T postgres pg_dump -U appuser -d testingsite > "C:\backups\backup-$timestamp.sql"

# Compressed backup
docker compose -f docker-compose.db.yml exec -T postgres pg_dump -U appuser -d testingsite -Fc > "C:\backups\backup-$timestamp.dump"
```

### Scheduled Backup (Windows Task Scheduler)

Create `backup-db.ps1`:

```powershell
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = "C:\backups"
docker compose -f C:\app\docker-compose.db.yml exec -T postgres pg_dump -U appuser -d testingsite -Fc > "$backupDir\backup-$timestamp.dump"

# Keep only last 7 days
Get-ChildItem $backupDir -Filter "backup-*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item
```

Schedule in Task Scheduler: Daily at 2:00 AM.

---

## Restore Procedures

### From SQL Backup

```powershell
# Stop application containers on PROD server first!

# Restore from SQL file
docker compose -f docker-compose.db.yml exec -T postgres psql -U appuser -d testingsite < "C:\backups\backup-20260122-100000.sql"
```

### From Compressed Backup

```powershell
# Copy backup into container
docker cp "C:\backups\backup-20260122-100000.dump" postgres:/tmp/

# Restore (drops and recreates)
docker compose -f docker-compose.db.yml exec postgres pg_restore -U appuser -d testingsite --clean --if-exists /tmp/backup-20260122-100000.dump
```

---

## Password Change

After initial setup, to change password:

```powershell
# Connect to postgres
docker compose -f docker-compose.db.yml exec postgres psql -U appuser -d testingsite

# In psql:
ALTER USER appuser WITH PASSWORD 'new_secure_password';
\q

# Update .env.db with new password
notepad .env.db

# Update .env.prod on PROD server with new password
# Then restart PROD containers
```

---

## Troubleshooting

### Container not starting

```powershell
docker compose -f docker-compose.db.yml logs postgres
```

### Check if port 5432 is in use

```powershell
netstat -an | Select-String ":5432"
```

### Connection refused from PROD server

- Check firewall allows port 5432
- Check Windows Defender firewall
- Check Docker network settings

### Data volume issues

```powershell
# Check volume
docker volume inspect postgres-data

# If corrupted, backup and recreate (DANGER: data loss if no backup)
docker compose -f docker-compose.db.yml down
docker volume rm postgres-data
docker compose -f docker-compose.db.yml up -d
```
