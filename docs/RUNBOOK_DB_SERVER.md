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
docker compose -f docker-compose.db.yml exec postgres psql -v ON_ERROR_STOP=1 -U appuser -d testingsite -f /tmp/schema.sql
```

Or use init scripts (run only on first start):

1. Create folder `init-db/`
2. Place SQL files in order: `01-schema.sql`, `02-seed.sql`
3. Uncomment volume mount in `docker-compose.db.yml`
4. Recreate container: `docker compose -f docker-compose.db.yml up -d --force-recreate`

---

## Backup Procedures

### Automatic (the `postgres-backup` sidecar — nothing to schedule)

The `postgres-backup` container in `prod-deploy/db-server/docker-compose.yml`
dumps **both** databases (`testingsite` AND `keycloak`) every
`BACKUP_INTERVAL_SECONDS` (default: daily) in **`pg_dump -Fc` custom format**
— a `.dump` file, already compressed, NOT gzip, NOT plain SQL:

| What | Where (under `BACKUP_PG_PATH`, default `C:\backups\postgres`) | Retention |
|---|---|---|
| Daily dumps | `daily\<db>-<yyyymmdd-hhmmss>.dump` | pruned after `BACKUP_DAILY_RETENTION_DAYS` (default 7) |
| Monthly dumps | `monthly\<db>-<yyyy-mm>.dump` | newest **24 per database** kept |

Example filenames: `daily\testingsite-20260825-020000.dump`,
`monthly\keycloak-2026-08.dump`.

Older backups from before the format change are `.sql.gz` files
(gzipped plain SQL). They stay restorable — see below — but everything new
is `.dump`.

### Manual Backup

```powershell
# From prod-deploy\db-server (custom format, matches the sidecar's output)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker compose exec -T postgres pg_dump -U appuser -d testingsite -Fc -f /tmp/manual-$timestamp.dump
docker cp postgres:/tmp/manual-$timestamp.dump "C:\backups\postgres\daily\testingsite-$timestamp.dump"
docker compose exec -T postgres rm -f /tmp/manual-$timestamp.dump
```

(`-f` inside the container + `docker cp`, not `>` redirection — PowerShell
re-encodes redirected output and corrupts the binary archive.)

---

## Restore Procedures

**Stop application containers on the APP server first!**

The supported path is `scripts/restore.sh` (run on the DB server, project
root, db stack up). It detects the format from the extension and handles
both generations:

```sh
# -Fc archive (current backups) -> pg_restore --clean --if-exists -j 4
./scripts/restore.sh ./backups/daily/testingsite-20260825-020000.dump

# legacy gzipped SQL (old backups) -> gunzip | psql ON_ERROR_STOP=1
./scripts/restore.sh ./backups/db-20260528-120000.sql.gz
```

Manually, for a `.dump` archive:

```powershell
# Copy backup into container (pg_restore -j needs a seekable file, not stdin)
docker cp "C:\backups\postgres\daily\testingsite-20260825-020000.dump" postgres:/tmp/restore.dump

# Restore (drops and recreates; -j 4 = parallel, minutes instead of hours)
docker compose exec postgres pg_restore --exit-on-error --clean --if-exists -j 4 -U appuser -d testingsite /tmp/restore.dump
docker compose exec postgres rm -f /tmp/restore.dump
```

A `.dump` archive is **binary** — `psql` cannot run it. Never try
`psql < backup.dump`; that is what `pg_restore` is for. Restore the
`keycloak` database the same way (its dump is what makes user accounts
recoverable), then run `keycloak-seed\fixup-after-restore.sql` if the app
server's URL changed.

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
