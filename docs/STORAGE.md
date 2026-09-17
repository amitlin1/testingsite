# File Storage Architecture

All files in DigitalFactory are stored in **MinIO** (S3-compatible object
storage). The Next.js app is **stateless** — it keeps no files on disk — so it
can be scaled or redeployed freely. Postgres holds a registry/audit log of every
object so we can list, audit, and detect orphans as the dataset grows.

```
                ┌────────────────────────── DB server ──────────────────────────┐
  Next.js  ───► │  MinIO  (bytes, versioned)        Postgres  (file_objects index)│
  (stateless)   │     ▲                                  ▲                         │
                │     │ minio-backup (mc mirror)         │ postgres-backup (pg_dump)│
                │  minio-backups vol               postgres-backups vol            │
                └─────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | File | Responsibility |
| :--- | :--- | :--- |
| Client | [`src/lib/minio.ts`](../src/lib/minio.ts) | Low-level MinIO client + `ensureBucket()` (enables **versioning**). |
| Storage service | [`src/lib/storage.ts`](../src/lib/storage.ts) | The **only** module that talks to MinIO: put/get/stat/remove/copy/list, `presignPost` / `inspectUploadedObject`, web-stream helper, sha256. |
| Direct upload | [`src/lib/directUpload/`](../src/lib/directUpload/) · [`src/lib/api/direct-upload.ts`](../src/lib/api/direct-upload.ts) | Presigned POST tickets (server) and the browser helper that uploads straight to MinIO. See **Direct uploads** below. |
| Registry | [`src/lib/file-registry.ts`](../src/lib/file-registry.ts) | Keeps the `file_objects` table in sync (best-effort, never blocks the primary op). |
| Signatures | [`src/lib/file-utils.ts`](../src/lib/file-utils.ts) | `saveSignature` / `deleteSignature` — store at `shipments/{id}/{file}`. |

### Object key layout

| What | Key | Tracked as |
| :--- | :--- | :--- |
| Received signature | `shipments/{shipmentId}/recv_<ts>_<rand>.png` | `entity_type = shipment_signature` |
| Sent signature | `shipments/{shipmentId}/send_<ts>_<rand>.png` | `entity_type = shipment_history_signature` |
| File-manager file | `<user path>/<filename>` | `entity_type = file_manager` |
| Item attachment | `items/{itemId}/{uuid}_{safeName}` | `entity_type = item_attachment` |
| Reference image (RU bucket) | `reference-items/{refId or new}/{ts}-{id8}-{safeName}` | `entity_type = reference_item_image` |

The DB columns `shipments.signature_path` / `shipment_history.signature_path`
still store **only the filename**, so the serving URL
`/api/shipments/{id}/files/{filename}` and the frontend/PDF code are unchanged.

## Direct uploads (browser → MinIO)

Upload bytes never pass through the app. Every upload path — item attachments,
the file manager, reference-item images — runs the same three steps:

1. **presign** — the browser POSTs `{ files: [{ name, type, size }], …tags }` to a
   `…/presign` route. The app validates (size cap, ownership, photo types),
   picks the object key, writes a `file_objects` row with `status = 'pending'`,
   and signs a **POST policy** (`presignedPostPolicy`): bucket, exact key,
   Content-Type and a `content-length-range` are pinned; 1h expiry.
2. **upload** — the browser POSTs the policy fields + the file straight to
   `MINIO_PUBLIC_ENDPOINT` with an `XMLHttpRequest`, so the progress bar is the
   real transfer. MinIO enforces the policy; the app is not involved.
3. **confirm** — the browser POSTs the key(s) to a `…/confirm` route (for
   reference images, the form save itself carries them). The app
   `statObject()`s the key, checks the size, and flips the row to `active`
   through `registerFileObject()`. `checksum_sha256` stays NULL for direct
   uploads — the bytes never crossed the server — and MinIO's ETag is kept in
   `metadata.etag` instead.

Routes: `POST /api/items/[id]/files/{presign,confirm}` (a replace passes
`replace_key`), `POST /api/files/upload/{presign,confirm}`,
`POST /api/settings/reference-items/images/presign` followed by
`POST /api/settings/reference-items` or `PUT …/[id]` (JSON, with
`images: [{ objectKey, fileName, photoType }]`).

Server-side writes (`putObject`) remain for the small things that originate on
the server: signatures, OnlyOffice saves, inline text edits.

### What the network must allow

- Browsers reach MinIO **directly** at `MINIO_PUBLIC_ENDPOINT` (default:
  `MINIO_ENDPOINT`, i.e. `http://<DB-IP>:9000`). The DB server firewall must
  allow **9000 from the client network**, not only from the app server. Keep
  9001 (console) closed.
- The POST is cross-origin (`http://<APP-IP>` → `http://<DB-IP>:9000`). MinIO
  answers CORS for the S3 API out of the box (`MINIO_API_CORS_ALLOW_ORIGIN`
  defaults to `*`); set it to the app origin to tighten.
- SigV4 signs the Host, so the URL in a ticket must be exactly what the browser
  will use. Single-machine installs where the app sees MinIO as
  `host.docker.internal` must set `MINIO_PUBLIC_ENDPOINT` to the machine's LAN
  address. The presign client signs offline with `MINIO_REGION` (default
  `us-east-1`, MinIO's default) and never contacts the public endpoint itself.
- Tickets are signed with the app's MinIO credentials; the access-key *name*
  appears in every ticket (the secret does not). A dedicated MinIO user for
  signing is a planned follow-up.

### Stale pending rows

A ticket that is never used (tab closed mid-upload) leaves a `pending` row and
possibly an object. `scripts/reconcile-file-registry.mjs` adopts pending rows
whose object did arrive (→ `active`) and soft-deletes pending rows older than a
day whose object never did.

## The `file_objects` registry table

MinIO is the source of truth for **bytes**; `file_objects` is the source of
truth for **metadata** (key, size, sha256, content type, owner, soft-delete
status). It enables auditing, orphan detection, dedup, and fast listing.

Apply the migration (creates the table):

```bash
npx prisma migrate deploy   # production
# or, for a fresh/dev database:
npx prisma db push
npx prisma generate         # always regenerate the client after schema changes
```

## Environment variables

| Var | Where | Notes |
| :--- | :--- | :--- |
| `MINIO_ENDPOINT` | app | how the APP reaches MinIO, e.g. `http://DB_SERVER_IP:9000` (prod), `http://localhost:9000` (dev) |
| `MINIO_PUBLIC_ENDPOINT` | app | how BROWSERS reach MinIO for direct uploads; default = `MINIO_ENDPOINT` |
| `MINIO_REGION` | app | region baked into presigned tickets; default `us-east-1` (MinIO's default) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | app + db | must match on both sides |
| `MINIO_BUCKET` | app + db | default `digitalfactory-files` (auto-created) |
| `MINIO_REFERENCE_BUCKET` | app | bucket for reference-item images (default `ru-reference-items`) |
| `MINIO_VERSIONING` | app | set to `false` to disable versioning (default: enabled) |
| `MAX_FILE_SIZE_MB` | app | per-file cap for item attachments and the file manager (default 100) |
| `BACKUP_INTERVAL_SECONDS` | db | backup sidecar cadence (default 86400) |
| `BACKUP_RETENTION_DAYS` | db | gzipped pg_dump retention (default 14) |

## Migrating existing on-disk signatures

If any signatures were written to disk by the old code (`FILES_PATH`), move them
into MinIO once. Idempotent — safe to re-run.

```bash
# dev
node -r dotenv/config scripts/migrate-signatures-to-minio.mjs dotenv_config_path=.env.development
# prod (env already set in the container/host)
node scripts/migrate-signatures-to-minio.mjs
```

After verifying, you can drop `FILES_PATH` from the env files. The prod
container no longer mounts a `shipments-data` volume.

## Backups & durability

Three layers of protection. Backups are written to **host folders** on the
(Windows) DB server, not Docker volumes — easy to copy off-site and they survive
`docker compose down -v`. Hebrew setup + restore guide: [`docs/גיבויים-README.md`](./גיבויים-README.md).

1. **MinIO versioning** — enabled automatically by `ensureBucket()`. Overwrites
   and deletes keep prior versions, recoverable from the MinIO console / `mc`.
2. **`minio-backup` sidecar** — `mc mirror` of the bucket → `C:/backups/files`
   every `BACKUP_INTERVAL_SECONDS` (default 24h). Runs without `--remove`, so
   files deleted in the bucket remain in the backup.
3. **`postgres-backup` sidecar** — gzipped `pg_dump` every interval:
   - `C:/backups/postgres/daily/db-<ts>.sql.gz` — pruned after `BACKUP_DAILY_RETENTION_DAYS` (default 7).
   - `C:/backups/postgres/monthly/db-<YYYY-MM>.sql.gz` — one per month, **kept forever** (idempotent).

Override paths/cadence via `BACKUP_FILES_PATH`, `BACKUP_PG_PATH`,
`BACKUP_INTERVAL_SECONDS`, `BACKUP_DAILY_RETENTION_DAYS` (set in the project
`.env` or shell — they are compose-interpolated, not read from `.env.db`).

On-demand snapshot: `./scripts/backup.sh [output_dir]`.

### Restore

**Full DB restore** (destructive — overwrites the live database):

```bash
# stop the app, recreate the DB empty, then pipe a dump back in
docker compose -f docker-compose.prod.yml stop next-app
docker exec postgres psql -U appuser -d postgres -c 'DROP DATABASE "InventoryDB" WITH (FORCE); CREATE DATABASE "InventoryDB" OWNER appuser;'
docker run --rm -i -v C:/backups/postgres:/b --network db-network -e PGPASSWORD=<pw> postgres:16-alpine \
  sh -c "zcat /b/monthly/db-<YYYY-MM>.sql.gz | psql -h postgres -U appuser -d InventoryDB"
docker compose -f docker-compose.prod.yml start next-app
```

**Restore files into MinIO** (if the bucket is lost):

```bash
docker run --rm -v C:/backups/files:/backup --network db-network --entrypoint sh minio/minio \
  -c "mc alias set dst http://minio:9000 <user> <pw> && mc mb -p dst/digitalfactory-files; mc mirror --overwrite /backup dst/digitalfactory-files"
```

Single deleted file: restore the prior version straight from the MinIO console
(versioning), no full restore needed.

## Reconciling drift

The registry is best-effort, so it can drift from MinIO (e.g. a write that
failed to register). Repair it any time — read-only against MinIO:

```bash
node -r dotenv/config scripts/reconcile-file-registry.mjs dotenv_config_path=.env.development
```

Find orphaned objects (active in MinIO, no owning row) or dangling signatures
via SQL on `file_objects` (`entity_type`, `entity_id`, `status`).
