# FileService / DigitalFactory — Air-Gapped Deployment Package

Everything needed to stand up the system on two **offline** servers. No internet,
no image builds, no Prisma CLI required.

```
two servers:
  ┌─────────────────────────────┐        ┌─────────────────────────────────────┐
  │ APP server                  │ ─────► │ DB server                            │
  │  next-app  +  nginx (:80)   │  net   │  postgres (:5432)                    │
  │                             │        │  FileServiceDB = MinIO (:9000/:9001) │
  │                             │        │  + daily/monthly backups             │
  └─────────────────────────────┘        └─────────────────────────────────────┘
```

## What's in the box

```
FileService-airgap/
├── db-server/                      ← copy to the DATABASE server
│   ├── images/  postgres-16-alpine.tar, minio.tar
│   ├── docker-compose.db.yml
│   ├── .env.db                     (DB + MinIO passwords — CHANGE THEM)
│   ├── .env                        (bucket name + backup settings)
│   ├── schema.sql                  ← run once in DBeaver
│   ├── docs/  גיבויים-README.md (Hebrew backup+restore guide), STORAGE.md
│   └── scripts/  1-load-images, 2-start, backup-now, restore-db, restore-files
└── app-server/                     ← copy to the APPLICATION server
    ├── images/  next-app.tar, nginx.tar
    ├── docker-compose.prod.yml
    ├── .env.prod                   (set DB_SERVER_IP + matching passwords)
    └── scripts/  1-load-images, 2-start
```

## Prerequisites (both servers)
- **Docker Desktop** installed and running (Windows). Drive `C:` shared with Docker.
- **DBeaver** on the DB server (to run `schema.sql`).
- Open from the APP server to the DB server: ports **5432** (Postgres) and **9000** (MinIO).

---

## PART A — DB server (do this first)

1. Copy the `db-server` folder onto the DB server.
2. **Edit `db-server\.env.db`** — set strong `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD`. Remember them; the app server must use the same.
3. Open PowerShell in `db-server\scripts` and run:
   ```powershell
   .\1-load-images.ps1     # loads postgres + MinIO images
   .\2-start.ps1           # creates C:\backups, starts the stack
   ```
4. **Create the schema in DBeaver:**
   - Connect to `localhost:5432`, database **InventoryDB**, user/password from `.env.db`.
   - Open `db-server\schema.sql` → **Execute SQL Script** (runs the whole file once).
   - This creates all 44 tables + seed data for the 6 reference tables.
5. Verify backups are writing:
   ```powershell
   Get-ChildItem C:\backups\postgres\daily
   Get-ChildItem C:\backups\files
   ```

Containers you should see: `postgres`, `FileServiceDB`, `FileServiceDB-backup`,
`digitalfactory-postgres-backup`.

---

## PART B — App server

1. Copy the `app-server` folder onto the app server.
2. **Edit `app-server\.env.prod`:**
   - Replace **`DB_SERVER_IP`** (appears twice) with the DB server's IP/hostname.
   - Make `DB_PASSWORD` / `MINIO_ROOT_PASSWORD` match the DB server's `.env.db`.
   - Set a real `NEXTAUTH_SECRET`.
3. Open PowerShell in `app-server\scripts` and run:
   ```powershell
   .\1-load-images.ps1     # loads next-app + nginx images
   .\2-start.ps1           # starts the app (refuses to start if DB_SERVER_IP not set)
   ```
4. Open `http://<app-server>/` in a browser. The bucket is auto-created on first use.

---

## Backups (already automatic)

| What | Where (DB server) | Retention |
| :--- | :--- | :--- |
| All files (MinIO mirror) | `C:\backups\files` | always current |
| Database — daily | `C:\backups\postgres\daily` | 7 days |
| Database — monthly | `C:\backups\postgres\monthly` | **forever** |

- Manual backup now: `db-server\scripts\backup-now.ps1`
- ⚠️ **Copy `C:\backups` off the server** (NAS / external disk) for true disaster recovery — this is the only non-automated step. See the Hebrew guide §7.
- Full Hebrew setup + restore guide: `db-server\docs\גיבויים-README.md`.

## Restore (if something breaks)
- **One deleted file:** MinIO console `http://<db-server>:9001` → restore previous version (versioning is on).
- **Whole database:** `db-server\scripts\restore-db.ps1 -DumpFile C:\backups\postgres\monthly\db-YYYY-MM.sql.gz`
- **All files:** `db-server\scripts\restore-files.ps1`

## Reference

| Container | Server | Role |
| :--- | :--- | :--- |
| `postgres` | DB | PostgreSQL database |
| `FileServiceDB` | DB | MinIO object storage (files) |
| `FileServiceDB-backup` | DB | mirrors files → C:\backups\files |
| `digitalfactory-postgres-backup` | DB | dumps DB → C:\backups\postgres |
| `next-app` | APP | Next.js application |
| `nginx` | APP | reverse proxy (port 80) |

**MinIO console:** `http://<db-server>:9001` (user/pass from `.env.db`). Restrict to trusted admins.

## Notes
- To change a password later you must update it in BOTH `.env.db` (DB server) and `.env.prod` (app server), then restart both stacks.
- These compose files are image-only on purpose (no `build:`), so `docker compose up -d` never tries to build. Do **not** pass `--build`.
