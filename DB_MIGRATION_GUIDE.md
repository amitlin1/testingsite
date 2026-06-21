# Database Migration Guide

This project uses **Prisma Migrate** to evolve the database schema safely.
The default workflow **never deletes data** — it only applies the SQL deltas
between the previous and the new schema.

---

## TL;DR — Adding or Changing a Field

```bash
# 1. Edit prisma/schema.prisma — add the column / table / index.

# 2. Create the migration + apply it to the LOCAL dev DB (safe; preserves data):
npm run db:migrate -- --name <descriptive_snake_case_name>
#    Example:
#    npm run db:migrate -- --name add_priority_to_items

# 3. Verify state:
npm run db:status

# 4. Commit the new prisma/migrations/<timestamp>_<name>/migration.sql folder.

# 5. On the production server (or any other env), apply pending migrations:
npm run db:deploy
```

That is the entire safe loop. Everything below is reference / context.

---

## Available npm scripts

| Script                | Command                  | When to use                                                                                  |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `npm run db:status`   | `prisma migrate status`  | Check which migrations are applied / pending. Read-only.                                     |
| `npm run db:migrate`  | `prisma migrate dev`     | **Dev only.** Diff `schema.prisma` against the DB, generate a new migration file, apply it.  |
| `npm run db:deploy`   | `prisma migrate deploy`  | **Prod / CI / other envs.** Apply any pending committed migrations. Never generates SQL.     |
| `npm run db:generate` | `prisma generate`        | Regenerate the Prisma TypeScript client. Runs automatically inside `db:migrate` / `db:deploy`. |
| `npm run db:studio`   | `prisma studio`          | Open the visual DB browser.                                                                  |
| `npm run db:reset`    | `prisma migrate reset`   | **⚠️ Wipes the DB** and reapplies every migration from scratch. Local dev resets only.       |
| `npm run db:baseline` | custom script            | One-time. Marks every migration in `prisma/migrations/` as already-applied. Use on a DB that was set up by running SQL manually. See [the baseline section](#one-time-setup-baselining-an-existing-production-db). |

---

## How a typical schema change goes

### Scenario: add an `is_priority BOOLEAN` column to `items`

1. Open `prisma/schema.prisma`, locate `model items { … }`, add:
   ```prisma
   is_priority Boolean @default(false)
   ```

2. Run:
   ```bash
   npm run db:migrate -- --name add_is_priority_to_items
   ```

3. Prisma will:
   - Compare `schema.prisma` to the DB.
   - Write `prisma/migrations/20YYMMDDhhmmss_add_is_priority_to_items/migration.sql` with the SQL
     `ALTER TABLE items ADD COLUMN is_priority BOOLEAN NOT NULL DEFAULT false;`.
   - **Apply that SQL to the dev DB** (no other data is touched).
   - Re-run `prisma generate` so your TypeScript code sees the new field.

4. Commit BOTH `prisma/schema.prisma` AND the new `prisma/migrations/…` folder.

5. On the prod server, after pulling the new code:
   ```bash
   npm run db:deploy
   ```
   Prisma checks the `_prisma_migrations` table, sees the new one is missing,
   and runs only that migration's `migration.sql`. No data lost.

### Scenario: rename a column

Prisma cannot detect a rename automatically — it sees it as "drop old + add new",
which would lose data. The safe pattern:

1. Edit `schema.prisma` to add the new column **alongside** the old one with the new name.
2. `npm run db:migrate -- --name add_new_column_name`.
3. Write a **data migration** in that migration's `migration.sql` (or a new follow-up
   migration) to copy `UPDATE items SET new_col = old_col;`.
4. Once you're sure the app uses only the new column, run another migration that
   drops the old column.

### Scenario: removing a column / table

Prisma will warn before destructive operations. Choose:

- **In dev**: run `db:migrate`; Prisma asks for confirmation when data loss is possible.
- **Never run `db:migrate` against prod.** Use `db:deploy` on prod after the migration
  was generated and reviewed in dev.

---

## Checking that everything is in sync right now

```bash
npm run db:status
# Expected:
#   5 migrations found in prisma/migrations
#   Database schema is up to date!
```

Plus a one-off drift check (compares `schema.prisma` to the actual DB structure
column-by-column):

```bash
npx prisma migrate diff \
  --from-schema prisma/schema.prisma \
  --to-config-datasource \
  --exit-code
# Expected:
#   No difference detected.
#   Exit code 0
```

If either of these returns a difference, something edited the DB outside Prisma.
DO NOT run `db:migrate` until you've reconciled — see "Drift recovery" below.

---

## Drift recovery (someone edited the DB manually)

If `db:status` reports drift or `migrate diff` finds changes:

1. Decide who is the source of truth — usually `schema.prisma`.
2. If the DB has changes you want to KEEP and propagate to the schema:
   ```bash
   npx prisma db pull        # rewrites schema.prisma from the actual DB
   ```
   Review the changes, then create a migration to record them:
   ```bash
   npm run db:migrate -- --name capture_manual_db_changes
   ```
3. If the schema is correct and the DB has accidental edits, fix the DB by hand
   (or restore a backup) until `migrate diff` is empty.

---

## Production deployment checklist

After building a new Next.js image (e.g. `testingsite-next-app.tar`) and loading
it on the prod server:

```bash
# 1. Pull the latest committed code on the prod server (or copy the prisma/ folder).
git pull

# 2. Apply any pending migrations to the prod DB. Safe; preserves data.
npm run db:deploy

# 3. Restart the containers.
docker compose -f docker-compose.prod.yml up -d
```

Note: the runtime `next-app` container does NOT have the Prisma CLI or migration
files baked in (the Dockerfile only copies `.next/standalone`). So migrations are
always run from a checkout of the repo against the prod `DATABASE_URL`, not from
inside the container.

---

## One-time setup: baselining an existing production DB

If your production DB was populated by running migration SQL files **manually**
(e.g. via `psql` or pgAdmin) instead of `npm run db:deploy`, Prisma has no
record of what's been applied. The `_prisma_migrations` table is missing or
empty, so the next `npm run db:deploy` would try to run every migration from
scratch and fail on "relation already exists".

The fix is **baselining** — telling Prisma "these migrations have already been
applied, just record them as such, don't actually run their SQL".

### Steps

On any machine that has the repo checkout, with `DATABASE_URL` pointing at the
**production** database:

```powershell
# PowerShell
$env:DATABASE_URL = "postgres://USER:PASS@PROD_HOST:5432/InventoryDB?schema=public"
npm run db:baseline
npm run db:status
```

```bash
# bash / WSL
DATABASE_URL="postgres://USER:PASS@PROD_HOST:5432/InventoryDB?schema=public" \
    npm run db:baseline
DATABASE_URL="…same…" npm run db:status
```

`db:baseline` runs `scripts/baseline-prisma-migrations.js`, which loops over
every folder in `prisma/migrations/` and runs:

```
npx prisma migrate resolve --applied <name>
```

That writes a row to `_prisma_migrations` marking the migration as applied
**without executing its SQL** (the schema is already in place).

After baselining, `npm run db:status` should report:

```
Database schema is up to date!
```

From that point on the regular loop works:
- Dev: `npm run db:migrate -- --name X` creates a new migration file.
- Prod: `npm run db:deploy` applies only that new file.

### How to know if you need to baseline

```bash
# Connect to the prod DB and run:
SELECT EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = '_prisma_migrations') AS has_table;

# If has_table = false  → baseline is required.
# If has_table = true   → check row count:
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;
# Compare against the folders in prisma/migrations/.
# If anything is missing, run db:baseline (it's idempotent — already-recorded
# migrations are skipped, not duplicated).
```

The `db:baseline` script is **idempotent** — re-running it is safe. Already
recorded migrations are detected and skipped, so you can run it multiple times
or after adding new migrations without harm.

---

## ⚠️ Destructive operations — only use when you really mean it

| Command                              | Effect                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `npm run db:reset`                   | Drops every table, recreates from migrations, runs the seed. Data lost. |
| `npx prisma db push --force-reset`   | Drops and recreates schema directly, bypasses migrations. Data lost.    |
| `npx prisma db push`                 | Pushes schema without creating a migration file. Skips history. Avoid. |

Use these ONLY for a brand-new empty DB or local dev reset — never on prod.
