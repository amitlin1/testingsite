# Configuration Reference

Guide to environment variables and when changes require rebuild vs restart.

---

## Quick Reference

| Configuration         | Change Method             | Rebuild? |
| --------------------- | ------------------------- | -------- |
| DB host/port/password | Edit `.env.prod`, restart | NO       |
| Auth secrets          | Edit `.env.prod`, restart | NO       |
| Client API URL        | Edit `.env.prod`, restart | NO       |
| Feature flags         | Edit `.env.prod`, restart | NO       |
| `NEXT_PUBLIC_*` vars  | **REBUILD**               | YES      |
| Package dependencies  | **REBUILD**               | YES      |
| Source code           | **REBUILD**               | YES      |

---

## Why NEXT*PUBLIC*\* Requires Rebuild

Next.js replaces `NEXT_PUBLIC_*` variables at **build time** with their literal values in the JavaScript bundle. Example:

```javascript
// Source code
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// After build (values baked in)
const apiUrl = "https://api.example.com";
```

**Solution**: Use the runtime config mechanism instead:

1. Nginx generates `/config.js` at startup from env vars
2. Client loads `window.__RUNTIME_CONFIG__`
3. Use `useRuntimeConfig()` hook in components

---

## PROD Server Variables (`.env.prod`)

### Database (Runtime - Server Only)

```ini
# Full connection URL
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Or individual variables
DB_HOST=192.168.1.100
DB_PORT=5432
DB_USER=appuser
DB_PASSWORD=secure_password
DB_NAME=testingsite
```

**Change procedure**: Edit file → `docker compose up -d`

### Authentication (Runtime - Server Only)

```ini
NEXTAUTH_SECRET=32_char_random_string
JWT_SECRET=another_random_string
```

**Change procedure**: Edit file → `docker compose up -d`

### Client Runtime (Runtime - Client Visible)

```ini
APP_BASE_URL=https://app.example.com
APP_VERSION=1.2.0
FEATURE_FLAGS={"newUI": true}
```

**Change procedure**: Edit file → `docker compose up -d`
(Nginx regenerates `/config.js` on startup)

---

## DB Server Variables (`.env.db`)

```ini
POSTGRES_USER=appuser
POSTGRES_PASSWORD=secure_password
POSTGRES_DB=testingsite
```

⚠️ **Note**: These are only used on **first container creation**. To change password after initial setup, see [RUNBOOK_DB_SERVER.md](./RUNBOOK_DB_SERVER.md#password-change).

---

## Build-Time Variables

These require image rebuild:

| Variable             | Where      | Purpose                    |
| -------------------- | ---------- | -------------------------- |
| `NODE_VERSION` (ARG) | Dockerfile | Node.js base image version |
| Any `NEXT_PUBLIC_*`  | Next.js    | Baked into client JS       |

---

## Adding New Runtime Variables

### For Server-Side Code

1. Use in code directly:

```typescript
const myVar = process.env.MY_NEW_VAR || "default";
```

2. Add to `.env.prod.example`:

```ini
MY_NEW_VAR=value
```

3. Restart containers after setting value.

### For Client-Side Code

1. Add to nginx `entrypoint.sh`:

```bash
MY_CLIENT_VAR="${MY_CLIENT_VAR:-default}"
cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  myClientVar: "${MY_CLIENT_VAR}",
  ...
};
EOF
```

2. Update `RuntimeConfig` interface in `useRuntimeConfig.ts`

3. Add to `.env.prod.example`

4. Restart containers.

---

## Minimal-Change Procedure for Ops

**Scenario**: Change database password

```powershell
# 1. On DB Server - change password in PostgreSQL
docker compose -f docker-compose.db.yml exec postgres psql -U appuser -c "ALTER USER appuser WITH PASSWORD 'new_pass';"

# 2. On DB Server - update .env.db (for future container recreations)
notepad .env.db  # Change POSTGRES_PASSWORD

# 3. On PROD Server - update .env.prod
notepad .env.prod  # Change DB_PASSWORD and DATABASE_URL

# 4. On PROD Server - restart (no rebuild)
docker compose -f docker-compose.prod.yml up -d

# 5. Verify
docker compose -f docker-compose.prod.yml logs next-app | Select-String -Pattern "error|Error" -NotMatch
```

**Total time**: ~2 minutes, zero rebuilds.
