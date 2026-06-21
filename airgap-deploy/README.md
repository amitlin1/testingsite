# DigitalFactory — Air-Gapped Deployment Bundle (2026-06-04)

Everything needed to deploy the system on an offline server. Builds on top of the
earlier `FileService-airgap` kit and adds the **item-attachments feature**
(in-browser editing of `.docx/.xlsx/.pptx` via OnlyOffice + a plain-text editor
for `.txt/.md/.csv/...` + image attachments stored in MinIO).

```
two servers (same layout as before, ONE new container on the app server):
  ┌────────────────────────────────────────┐        ┌─────────────────────────────────────┐
  │ APP server                             │ ─────► │ DB server                            │
  │  nginx (:80)  →  next-app (:3000)      │        │  postgres (:5432)                    │
  │  onlyoffice (:8082)  ← editor iframe   │        │  FileServiceDB = MinIO (:9000/:9001) │
  │                                        │        │  + daily/monthly backups             │
  └────────────────────────────────────────┘        └─────────────────────────────────────┘
```

## What's in the box

```
airgap-deploy/
├── README.md                                    ← this file
├── db-server/                                   ← copy to the DATABASE server
│   ├── images/   postgres-16-alpine.tar, minio.tar
│   ├── docker-compose.db.yml
│   ├── .env.db.example                          (cp -> .env.db, set passwords)
│   ├── migrations/
│   │   └── 2026-06-04_add_updated_by_to_file_objects.sql
│   └── scripts/
│       ├── 1-load-images.ps1                    (run once)
│       ├── 2-start.ps1                          (start postgres + MinIO + backups)
│       └── 3-apply-migration.ps1                (one-time DB upgrade; idempotent)
└── app-server/                                  ← copy to the APPLICATION server
    ├── images/   next-app.tar, nginx.tar, onlyoffice.tar
    ├── docker-compose.prod.yml
    ├── Dockerfile                               (reference only — not used at runtime)
    ├── nginx/   nginx.conf, Dockerfile, entrypoint.sh
    ├── .env.prod.example                        (cp -> .env.prod, set values)
    ├── prisma/                                  (reference: schema + migrations)
    └── scripts/
        ├── 1-load-images.ps1                    (run once — loads ALL 3 images)
        └── 2-start.ps1                          (start next-app + nginx + onlyoffice)
```

Approximate image sizes (`docker save` output, uncompressed):

| Image | Size |
|---|---|
| `testingsite-next-app:latest` | ~460 MB |
| `testingsite-nginx:latest` | ~70 MB |
| `onlyoffice/documentserver:latest` | **~4.3 GB** ← the big one |
| `postgres:16-alpine` | ~395 MB |
| `minio/minio:latest` | ~240 MB |

Optional: `gzip` the tars for transport (~30–40% smaller). `docker load` accepts
both `.tar` and `.tar.gz`.

## Prerequisites (both servers)

- **Docker Desktop** installed and running (Windows). Drive `C:` shared with Docker.
- **DBeaver** on the DB server (or any psql client) for one-off SQL.
- Firewall open from the APP server to the DB server: **5432** (Postgres), **9000** (MinIO).
- On the APP server, **port 8082** must be reachable from end-user browsers
  (this is the OnlyOffice DocServer for the editor iframe — see below).

---

## PART A — DB server (do this first)

### A.1 Fresh install (new server, no data yet)

1. Copy the `db-server` folder onto the DB server.
2. **Edit `db-server\.env.db`** — set strong `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD`. Write them down; the app server needs to match.
3. Open PowerShell in `db-server\scripts` and run:
   ```powershell
   .\1-load-images.ps1
   .\2-start.ps1
   ```
4. Create the schema in DBeaver (only if you don't already have one from a previous install). Use the project's `schema.sql` from the original `FileService-airgap` kit, then continue.
5. (Skip A.2 — fresh schemas already have `updated_by`.)

### A.2 Upgrade an existing DB (you already have data)

If the DB server is already running an older version of the schema (from the
previous `FileService-airgap` bundle), you need exactly one column added:

```powershell
.\3-apply-migration.ps1
```

That script is **idempotent** — it checks `information_schema` first and skips
if the column already exists. So it's safe to re-run.

Or apply by hand in DBeaver:

```sql
ALTER TABLE "file_objects" ADD COLUMN "updated_by" VARCHAR(255);
```

The new column is **nullable** — existing rows stay valid, no backfill needed.

---

## PART B — App server

1. Copy the `app-server` folder onto the app server.
2. **Edit `app-server\.env.prod`** — see the section at the bottom of
   `.env.prod.example` titled *OnlyOffice Document Server*. Required values:
   - `DB_HOST` / `DATABASE_URL` — point at the DB server
   - `DB_PASSWORD`, `MINIO_ROOT_PASSWORD` — match the DB server
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `ONLYOFFICE_JWT_SECRET` — `openssl rand -base64 32` (different secret!)
   - `ONLYOFFICE_PUBLIC_URL` and `NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL` — both set
     to the URL end-user browsers reach the editor at. For an internal-only
     deployment this is `http://<app-server-IP>:8082`.
   - `APP_PUBLIC_URL` — leave as `http://nginx` (server-to-server, internal).
3. Open PowerShell in `app-server\scripts` and run:
   ```powershell
   .\1-load-images.ps1     # ← this one takes a minute (OnlyOffice is large)
   .\2-start.ps1
   ```
4. Open `http://<app-server>/` in a browser, log in, open an item, attach a file.

---

## Why OnlyOffice runs on its own port (8082, not /onlyoffice/)

OnlyOffice DocumentServer 9.x generates root-relative URLs inside its editor
iframe (`/cache/files/data/...`, `/coauthoring/...`) that **don't** honour a
reverse-proxy sub-path. If you mount it at `nginx /onlyoffice/`, those
fetches hit the wrong service and the per-document `Editor.bin` returns 404,
which the editor reports as a confusing "permissions" error.

Running it on its own host port keeps every fetch the editor makes
same-origin to OnlyOffice. The server-to-server URLs (`http://nginx`,
`http://onlyoffice`) stay inside the docker network and don't need changing.

If you want a single public hostname later, put it on a sub-domain
(e.g. `office.example.com`) — that works fine. Sub-paths do not.

---

## Backups (already automatic — same as before)

| What | Where (DB server) | Retention |
| :--- | :--- | :--- |
| All files (MinIO mirror) | `C:\backups\files` | always current |
| Database — daily | `C:\backups\postgres\daily` | 7 days |
| Database — monthly | `C:\backups\postgres\monthly` | **forever** |

The new attached files (under `items/{id}/...` in MinIO) are covered by the
existing `FileServiceDB-backup` mirror — no extra backup job needed.

---

## What's new in 2026-06-04 (vs the previous airgap kit)

- **DB:** one new column `file_objects.updated_by VARCHAR(255)`.
- **App server containers:** new `onlyoffice` service, port `8082`.
- **App envvar additions:** `ONLYOFFICE_JWT_SECRET`, `ONLYOFFICE_PUBLIC_URL`,
  `ONLYOFFICE_INTERNAL_URL`, `APP_PUBLIC_URL`, `NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL`,
  optional `MAX_TEXT_EDIT_SIZE_MB`.
- **Nginx:** old `/onlyoffice/` location block was REMOVED — don't add it back.
- **MinIO:** no schema change; new files just live under the prefix `items/{id}/`
  with `entity_type='item_attachment'` in the registry.
- **Dockerfile:** new build-arg `NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL` (Next.js inlines
  this into the static JS bundle at build time — see the existing image for the
  baked value; if you ever rebuild on-site you must pass the right value via
  `--build-arg` or it falls back to `/onlyoffice` and breaks).

## Reference: container roster

| Container | Server | Role | Port (host) |
| :--- | :--- | :--- | :--- |
| `postgres` | DB | PostgreSQL | 5432 |
| `FileServiceDB` | DB | MinIO object storage | 9000 (API), 9001 (UI) |
| `FileServiceDB-backup` | DB | mirrors MinIO → C:\backups\files | — |
| `digitalfactory-postgres-backup` | DB | pg_dump → C:\backups\postgres | — |
| `next-app` | APP | Next.js application | (internal) 3000 |
| `nginx` | APP | reverse proxy | 80 |
| **`onlyoffice`** | **APP** | **OnlyOffice DocServer (editor iframe)** | **8082** |

## Troubleshooting quick refs

- "ההורדה נכשלה (קוד -4)" in the editor → OnlyOffice can't fetch the document.
  Confirm `APP_PUBLIC_URL=http://nginx` and that nginx + next-app are both up.
- "Refused to execute script ... text/html" → the browser is loading the wrong
  OnlyOffice URL. Confirm `NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL` was baked into the
  image (`docker exec next-app grep -o "http://[^\"]*:8082" /app/.next/static/chunks/*.js | head`).
- "אין הרשאות לבצע פעולה" in the editor → JWT signature mismatch. Check
  `ONLYOFFICE_JWT_SECRET` is identical in `.env.prod` and inside the running
  `onlyoffice` container (`docker exec onlyoffice sh -c 'echo $JWT_SECRET'`).
- Editor spinner that never finishes → open DevTools console; you'll see lines
  starting with `[OnlyOffice]` showing exactly where the flow stops.
