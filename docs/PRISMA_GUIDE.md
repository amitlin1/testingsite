# Prisma - Production & Team Guide

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Key Concepts](#key-concepts)
- [Environment Setup](#environment-setup)
- [Daily Workflow for Developers](#daily-workflow-for-developers)
- [Working in a Team](#working-in-a-team)
- [Production Deployment](#production-deployment)
- [Handling Conflicts](#handling-conflicts)
- [Dangerous Operations](#dangerous-operations)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)
- [Command Reference](#command-reference)

---

## Overview

Prisma manages the database through three components:

| Component | What it is | File location |
|---|---|---|
| **Schema** | TypeScript-like definition of all tables, columns, relations, indexes | `prisma/schema.prisma` |
| **Migrations** | SQL files that track every change to the database over time | `prisma/migrations/` |
| **Prisma Client** | Auto-generated TypeScript client used in application code | `node_modules/@prisma/client` |
| **Config** | Connection URL and migration path settings | `prisma.config.ts` |

**Important:** Prisma reads `DATABASE_URL` from environment variables (via `prisma.config.ts` which loads `dotenv`).

---

## Project Structure

```
project/
├── prisma/
│   ├── schema.prisma              # THE source of truth for your DB structure
│   └── migrations/
│       ├── migration_lock.toml    # Locks the DB provider (postgresql)
│       ├── 0_init/
│       │   └── migration.sql      # Initial database creation
│       ├── 20260217140614_add_poc_and_stokekeeper/
│       │   └── migration.sql
│       ├── 20260218000000_dashboard_optimization/
│       │   └── migration.sql
│       └── 20260224085257_update_database_structure/
│           └── migration.sql
├── prisma.config.ts               # Prisma configuration (DB URL, paths)
├── .env                           # DATABASE_URL for local development
└── .env.prod                      # DATABASE_URL for production
```

---

## Key Concepts

### Schema vs Migration - What's the difference?

- **Schema** (`schema.prisma`) = "what the DB should look like RIGHT NOW"
- **Migrations** (`migrations/`) = "the HISTORY of changes that got us here"

Think of it like Git:
- Schema = the current state of your code
- Migrations = the commit history

### Why Migrations Matter in a Team

Without migrations, if Developer A adds a column and Developer B adds a different column, there's no way to merge these changes safely. Migrations give each change a unique timestamp and SQL file, so they can be applied in order on any database.

### Migration naming convention

```
20260217140614_add_poc_and_stokekeeper
│              │
│              └── Description (snake_case, short, descriptive)
└── Timestamp (auto-generated: YYYYMMDDHHMMSS)
```

---

## Environment Setup

### DATABASE_URL format

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME
```

### For local development (from Windows, DB in Docker)

```env
# .env (at project root)
DATABASE_URL=postgresql://appuser:Strong_Pass_123@localhost:5432/InventoryDB
```

### For Next.js running inside Docker (connecting to DB on host)

```env
# .env.prod
DATABASE_URL=postgresql://appuser:Strong_Pass_123@host.docker.internal:5432/InventoryDB
```

### Verify connection

```bash
npx prisma db pull --print
```

If it prints the schema from the DB, the connection works. If it fails, check your URL.

---

## Daily Workflow for Developers

### Scenario 1: You pulled new code and there are new migrations

```bash
# 1. Install dependencies (in case Prisma version changed)
npm install

# 2. Apply pending migrations to your local DB
npx prisma migrate deploy

# 3. Regenerate the Prisma Client
npx prisma generate
```

### Scenario 2: You need to change the database

```bash
# 1. Edit prisma/schema.prisma
#    Example: add a "notes" column to the shipments table

# 2. Create a migration
npx prisma migrate dev --name add_notes_to_shipments

# 3. Verify the generated SQL
#    Check: prisma/migrations/2026XXXX_add_notes_to_shipments/migration.sql

# 4. Test your application works with the change

# 5. Commit BOTH the schema AND the migration
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add notes column to shipments"
```

### Scenario 3: Quick exploration / prototyping (NO migration)

```bash
# Push schema changes directly to DB (no migration file created)
npx prisma db push

# WARNING: This is fine for dev/prototyping only.
# NEVER use this in production or when working with a team.
# It doesn't create migration files, so other developers
# won't get your changes.
```

---

## Working in a Team

### The Golden Rules

1. **NEVER edit a migration file that has already been committed and pushed.**
   Once a migration is shared, it's immutable. Other team members may have already applied it.

2. **ALWAYS commit the schema AND migrations together.**
   ```bash
   git add prisma/schema.prisma prisma/migrations/
   git commit -m "feat: description of DB change"
   ```

3. **NEVER use `db push` in a team environment.**
   It doesn't create migrations, so other team members won't get the change.

4. **NEVER use `migrate dev` on production.**
   It can drop data. Use `migrate deploy` only.

5. **Pull and migrate before creating new migrations.**
   ```bash
   git pull
   npx prisma migrate deploy   # Apply teammates' migrations first
   npx prisma migrate dev --name your_change  # Then create yours
   ```

### Workflow: Developer A and Developer B both change the DB

```
Developer A                          Developer B
──────────                          ──────────
1. git pull                          1. git pull
2. Edit schema.prisma                2. Edit schema.prisma
3. npx prisma migrate dev            3. npx prisma migrate dev
   --name add_notes                     --name add_priority
4. git add + commit + push           4. git add + commit + push
                                        (gets merge conflict? see below)
```

### Handling Schema Merge Conflicts

If both developers edit `schema.prisma`, Git will show a merge conflict.

**How to resolve:**

```bash
# 1. Pull the latest changes
git pull

# 2. If there's a conflict in schema.prisma:
#    Open schema.prisma, manually merge both changes
#    (keep both new columns/tables/etc.)

# 3. If there's NO conflict in migrations/ (different timestamps):
#    Both migration files will exist side by side. That's fine.

# 4. Verify the schema matches what the migrations expect:
npx prisma migrate dev

# 5. If Prisma asks "Do you want to create a new migration?":
#    - If you already resolved everything: type "no"
#    - If there's a diff: let it create a merge migration

# 6. Commit the resolution
git add prisma/
git commit -m "merge: resolve schema conflicts"
```

### Handling Migration Conflicts (rare but possible)

This happens when two migrations try to change the same table in incompatible ways.

```bash
# 1. Check migration status
npx prisma migrate status

# 2. If it shows "drift detected":
#    You need to fix the schema to match reality

# 3. Reset your dev DB and re-apply all migrations:
npx prisma migrate reset
# WARNING: This deletes all data in your LOCAL dev DB.
# NEVER run this on production.
```

---

## Production Deployment

### First-time setup (new/empty database)

```bash
# Option A: Apply all existing migrations
npx prisma migrate deploy

# Option B: If there are no migrations yet, push schema directly
npx prisma db push
```

### Regular deployment (when new migrations exist)

```bash
# 1. ALWAYS backup first
docker exec postgres pg_dumpall -U appuser > backup_$(date +%F).sql

# 2. Apply pending migrations
DATABASE_URL=postgresql://appuser:Strong_Pass_123@localhost:5432/InventoryDB \
  npx prisma migrate deploy

# 3. Check status
npx prisma migrate status
```

### Deployment checklist

```
[ ] Backup database (pg_dumpall or pg_dump)
[ ] Check which migrations are pending: npx prisma migrate status
[ ] Review the SQL in each pending migration file
[ ] Apply migrations: npx prisma migrate deploy
[ ] Verify: npx prisma migrate status (should show all applied)
[ ] Rebuild and restart the application
[ ] Smoke test the application
```

### What `migrate deploy` does vs `migrate dev`

| | `migrate dev` | `migrate deploy` |
|---|---|---|
| **Purpose** | Development | Production |
| **Creates new migrations** | Yes | No |
| **Drops data if needed** | Yes (asks first) | Never |
| **Resets DB on drift** | Yes (asks first) | Fails with error |
| **Generates Prisma Client** | Yes | No |
| **Safe for production** | NO | YES |

---

## Dangerous Operations

### Commands that can DELETE data

| Command | Risk | When to use |
|---|---|---|
| `migrate reset` | **DELETES ALL DATA**, re-runs all migrations | Local dev only, never production |
| `migrate dev` | May drop columns/tables if schema changed | Local dev only |
| `db push --force-reset` | **DROPS AND RECREATES** the entire DB | Never in production |
| `db execute` | Runs raw SQL | Only when you know exactly what you're doing |

### How to safely rename a column in production

**WRONG way** (will DELETE the column and create a new one, losing all data):
```prisma
// Before
model items {
  serial_no String
}

// After - DON'T just rename in schema!
model items {
  serial_number String  // Prisma sees: drop serial_no, create serial_number
}
```

**RIGHT way** (3-step migration):

```bash
# Step 1: Create a custom migration (empty)
npx prisma migrate dev --name rename_serial_no --create-only

# Step 2: Edit the generated migration.sql manually:
# Replace whatever Prisma generated with:
ALTER TABLE "items" RENAME COLUMN "serial_no" TO "serial_number";

# Step 3: Update schema.prisma to match
# Change the field name to serial_number

# Step 4: Apply the migration
npx prisma migrate dev
```

### How to safely delete a column in production

```bash
# 1. Backup
docker exec postgres pg_dump -U appuser -t items InventoryDB > items_backup.sql

# 2. Remove the field from schema.prisma

# 3. Create migration
npx prisma migrate dev --name remove_old_column

# 4. Review the SQL - make sure it's only dropping what you expect

# 5. Deploy to production
npx prisma migrate deploy
```

---

## Backup & Recovery

### Before any migration on production

```bash
# Full database backup
docker exec postgres pg_dumpall -U appuser > full_backup_$(date +%F).sql

# Single database backup (smaller, faster)
docker exec postgres pg_dump -U appuser InventoryDB > inventorydb_backup_$(date +%F).sql

# Backup specific table
docker exec postgres pg_dump -U appuser -t items InventoryDB > items_backup.sql
```

### Restore from backup

```bash
# Full restore
docker exec -i postgres psql -U appuser -d InventoryDB < inventorydb_backup.sql

# Restore specific table
docker exec -i postgres psql -U appuser -d InventoryDB < items_backup.sql
```

### Migration failed? How to rollback

Prisma doesn't have a built-in rollback. You have two options:

**Option A: Fix forward**
```bash
# 1. Fix the issue in schema.prisma
# 2. Create a new migration that fixes the problem
npx prisma migrate dev --name fix_previous_migration
# 3. Deploy
npx prisma migrate deploy
```

**Option B: Restore from backup**
```bash
# 1. Restore the database
docker exec -i postgres psql -U appuser -d InventoryDB < backup.sql

# 2. Mark the failed migration as rolled back
npx prisma migrate resolve --rolled-back "20260224085257_update_database_structure"

# 3. Fix the migration file or schema, then re-deploy
```

---

## Troubleshooting

### "Migration has not yet been applied"

```bash
# Check which migrations are pending
npx prisma migrate status

# Apply them
npx prisma migrate deploy
```

### "Drift detected: Your database schema is not in sync"

This means someone changed the DB directly (outside of Prisma).

```bash
# Option 1: Pull the current DB state into schema
npx prisma db pull

# Option 2: If you want to KEEP the schema and override the DB
npx prisma db push

# Option 3: In dev, reset everything
npx prisma migrate reset  # CAUTION: deletes all data
```

### "The migration was modified after it was applied"

Someone edited a migration file that was already applied. This is forbidden.

```bash
# Option 1: Restore the original migration file from git
git checkout prisma/migrations/XXXXX_name/migration.sql

# Option 2: If intentional, mark it as resolved
npx prisma migrate resolve --applied "XXXXX_name"
```

### "P1001: Can't reach database server"

```bash
# Check if Postgres is running
docker ps | grep postgres

# Check connection
docker exec postgres pg_isready -U appuser -d InventoryDB

# Test from your machine
npx prisma db pull --print
```

### "Environment variable not found: DATABASE_URL"

Make sure you have a `.env` file at the project root with:
```
DATABASE_URL=postgresql://appuser:Strong_Pass_123@localhost:5432/InventoryDB
```

Or set it inline:
```bash
DATABASE_URL=postgresql://... npx prisma migrate deploy
```

---

## Command Reference

### Essential commands

```bash
# Check DB connection and migration status
npx prisma migrate status

# Apply pending migrations (PRODUCTION SAFE)
npx prisma migrate deploy

# Create a new migration (DEV ONLY)
npx prisma migrate dev --name description_of_change

# Create migration SQL without applying it
npx prisma migrate dev --name description --create-only

# Regenerate Prisma Client after schema change
npx prisma generate

# Pull current DB structure into schema.prisma
npx prisma db pull

# Push schema to DB directly (no migration file)
npx prisma db push

# Open visual DB browser
npx prisma studio

# Validate schema syntax
npx prisma validate

# Format schema file
npx prisma format
```

### Diagnostic commands

```bash
# Show migration status
npx prisma migrate status

# Show difference between schema and DB
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma

# Print current DB schema (without saving)
npx prisma db pull --print
```

### Emergency commands (use with caution)

```bash
# Mark a failed migration as rolled back
npx prisma migrate resolve --rolled-back "migration_name"

# Mark a migration as already applied (skip it)
npx prisma migrate resolve --applied "migration_name"

# DESTROY and recreate dev DB (NEVER ON PRODUCTION)
npx prisma migrate reset
```

---

## Quick Decision Guide

```
Need to change the DB?
│
├─ Working alone / prototyping?
│  └─ npx prisma db push (fast, no migration file)
│
├─ Working in a team?
│  └─ npx prisma migrate dev --name description
│     └─ Commit schema + migration together
│
├─ Deploying to production?
│  └─ 1. Backup: pg_dump
│     2. npx prisma migrate deploy
│     3. Rebuild app
│
├─ Migration failed on production?
│  └─ 1. Restore from backup
│     2. npx prisma migrate resolve --rolled-back "name"
│     3. Fix and re-deploy
│
└─ Someone changed DB directly?
   └─ npx prisma db pull (sync schema from DB)
```
