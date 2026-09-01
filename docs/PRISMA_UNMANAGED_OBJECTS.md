# Prisma and the Metrics-Ledger Objects It Must Never Touch

The metrics ledger (migration `20260825000000_metrics_ledger_additive`) is
built from PostgreSQL features Prisma's schema language cannot express.
The tables are declared in `prisma/schema.prisma` (with
`Unsupported("tstzrange")` where needed) so Prisma knows they exist — but a
large part of what makes the ledger *correct* is invisible to Prisma, and
`prisma migrate dev` will try to "clean it up" in every future migration it
generates.

This document says exactly what Prisma manages, what it must never touch,
the workflow that keeps the two apart, and the recovery move when a
generated migration contains drops of guarded names.

---

## What Prisma manages

- Ordinary tables and columns declared in `schema.prisma` — the legacy
  application tables (`items`, `item_routes`, `testing_routes`, …) and the
  *declared shape* of the new metrics tables (`route_run`,
  `item_state_event`, `item_state_interval`, `work_calendar_version`,
  `work_span`, `metric_state`, `metrics_drift`, `job_run`,
  `metrics_schema_version`).
- Plain B-tree indexes and foreign keys that are expressed in the schema.
- The migration history in `_prisma_migrations`.

## What Prisma must never touch

Everything below was created by the ledger migration **outside** Prisma's
model. Prisma's diff engine sees these as "drift" and emits `DROP INDEX` /
`ALTER TABLE ... DROP CONSTRAINT` / `DROP EXPRESSION` statements for them —
not `DROP TABLE`, because the tables themselves *are* declared.

| Kind | Names |
|---|---|
| EXCLUDE / partial / GiST indexes and constraints on `item_state_interval` | `isi_no_overlap` (EXCLUDE gist, DEFERRABLE — **the invariant**), `isi_one_open_per_item` (EXCLUDE btree, DEFERRABLE — one open interval per item; a constraint rather than a partial unique index so isi_rebuild_run can defer it), `isi_range_live`, `isi_item_time`, `isi_closed`, `isi_run`, `isi_closed_sync`, `isi_closed_has_wall` |
| `item_state_event` indexes | `ise_super` (partial — declared indexes `ise_run`/`ise_item` and constraint `ise_key_uq` are Prisma-managed but guarded belt-and-braces) |
| `route_run` indexes | `route_run_uq`, `route_run_one_open`, `route_run_closed` |
| Calendar | `wcv_one_current`, `work_span_no_overlap` (EXCLUDE gist), `work_span_ladder` |
| Ops | `metrics_drift_open`, `job_run_recent` |
| Guards added to legacy tables | `testing_routes_type_number_uq` (unique index on `testing_routes`), `ir_item_fk` (FK `item_routes → items`, added `NOT VALID`) |
| Triggers | `trg_ise_immutable` (event immutability), `trg_isi_apply` (the fold), `trg_metrics_drift` (dual-run drift detector on `item_routes`) |
| Functions | `state_of`, `deny_mutation`, `work_calendar_build`, `business_date`, `current_calendar_version`, `work_seconds_elapsed`, `work_seconds_between`, `metrics_open_run`, `isi_apply_one`, `isi_apply_event`, `isi_rebuild_run`, `metrics_detect_drift`, `metrics_selfcheck`, `metrics_record`, `metrics_forget_item`, `metrics_resync_item_dims`, `metrics_refresh_run_plan` |
| Generated column | `item_state_interval.offhours_seconds` (`GENERATED` — Prisma emits `DROP EXPRESSION` for it) |
| Extension | `btree_gist` |

Dropping any of these does not fail loudly — the system keeps running and
the ledger silently stops being provably correct. `isi_no_overlap` and
`isi_one_open_per_item` are what *prove* every rebuild: without them a bad
replay commits instead of aborting.

---

## The required workflow: `--create-only` + diff review

Never run plain `prisma migrate dev` against a schema change and commit
whatever it produced. Always:

1. Edit `prisma/schema.prisma`.
2. Generate **without applying**:

   ```bash
   npx prisma migrate dev --create-only --name <change_name>
   ```

3. **Read the generated `migration.sql`.** Delete every statement that
   drops or alters one of the guarded names above — they are Prisma
   "correcting" drift it cannot understand, not part of your change.
4. Run the safety check (the same check that should gate every commit):

   ```bash
   npm run db:check-migration
   ```

5. Only when the check passes, apply and commit:

   ```bash
   npx prisma migrate dev
   npm run db:airgap-schema   # regenerates prod-deploy/db-server/init/02-app-schema.sql
   ```

### Hooking the check pre-commit

This repository currently has **no husky and no configured git hooks**
(`.git/hooks` is empty and `core.hooksPath` is unset), and installing new
dependencies for this is deliberately avoided. Until a hook manager is
adopted, the check runs manually — `npm run db:check-migration` before every
commit that touches `prisma/migrations/`.

To enforce it locally without any dependency, each developer can create
`.git/hooks/pre-commit` (not versioned, per-clone) containing:

```sh
#!/bin/sh
node scripts/check-migration-safety.js || exit 1
```

and make it executable (`chmod +x .git/hooks/pre-commit`; on Windows,
Git for Windows runs it as-is).

---

## Recovery: a generated migration contains drops of guarded names

**If it is not committed / not applied yet** — the normal case, this is
exactly what `--create-only` is for:

1. Open the generated `migration.sql` and delete the offending statements
   (`npm run db:check-migration` lists them file-by-file).
2. Re-run `npm run db:check-migration` until it passes, then apply.

**If it was already applied to a database** (dev machine, or worse):

1. Do **not** write a new Prisma migration to "put things back" — Prisma
   will fight you again on the next diff.
2. Re-create the dropped objects by re-running the ledger migration — every
   statement in `prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql`
   is idempotent (`IF NOT EXISTS` / `OR REPLACE`), so applying the whole
   file restores whatever is missing and skips what still exists:

   ```bash
   psql -v ON_ERROR_STOP=1 -d <db> -f prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql
   ```

   (On the air-gapped DB server this is `scripts\8-apply-metrics-ledger.ps1`,
   which wraps the same file.)
3. If interval data was mutated while constraints were missing, rebuild and
   let the constraints prove the result:

   ```sql
   SELECT isi_rebuild_run(route_run_id) FROM route_run ORDER BY route_run_id;
   ```

   A rebuild that violates `isi_no_overlap` aborts — that is the constraint
   doing its job; investigate per `docs/RUNBOOK_METRICS.md`.
4. Fix the migration file that caused it (step 3 of the workflow above was
   skipped), so the drops are not re-applied on the next machine.

---

## Why the safety net is a name list, not "no drops ever"

Ordinary migrations legitimately drop things — old app indexes, retired
columns. `scripts/check-migration-safety.js` therefore blocks only the
destructive statement classes from the migration plan
(`DROP TABLE|DROP FUNCTION|DROP TRIGGER|DROP INDEX|DROP CONSTRAINT|DROP EXPRESSION|DROP EXTENSION`
and any `ALTER TABLE <metrics table> ... DROP`) **when they touch a guarded
name**. Adding a new hand-built object to the ledger means adding its name
to `GUARDED_NAMES` in that script in the same PR.
