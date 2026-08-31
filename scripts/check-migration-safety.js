// Refuse to commit a Prisma migration that drops a guarded metrics object.
//
//   node scripts/check-migration-safety.js        (or: npm run db:check-migration)
//
// WHY: the metrics ledger lives on objects Prisma cannot express - partial
// indexes, GiST, EXCLUDE constraints, triggers, functions, a GENERATED
// column. `prisma migrate dev` diffs the database against schema.prisma,
// sees objects it does not know, and emits destructive statements for them:
// not `DROP TABLE` (the tables ARE declared), but `DROP INDEX`,
// `ALTER TABLE ... DROP CONSTRAINT`, `DROP EXPRESSION`. Committed unread,
// a routine migration three months from now silently drops the EXCLUDE
// constraint that is the rebuild's test suite.
//
// WHAT IT DOES: scans every migration NEWER than the metrics-ledger
// migration (the ledger migration itself legitimately contains
// `DROP TRIGGER IF EXISTS` as part of its idempotent create-or-replace
// pattern) for destructive statements that touch a guarded name, and exits 1
// with the offending file + statement. See docs/PRISMA_UNMANAGED_OBJECTS.md
// for the workflow this enforces and the recovery move.

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const migrationsDir = path.join(repoRoot, "prisma", "migrations");

// Every migration whose name sorts AFTER this one is "new" and gets scanned.
const LEDGER_MIGRATION = "20260825000000_metrics_ledger_additive";

// Tables Prisma declares but whose hand-built parts it cannot see. Any
// `ALTER TABLE <one of these> ... DROP ...` (column, constraint, expression)
// is destructive by definition, guarded name or not.
const METRICS_TABLES = [
  "metric_state",
  "route_run",
  "item_state_event",
  "work_calendar_version",
  "work_span",
  "item_state_interval",
  "metrics_drift",
  "job_run",
  "metrics_schema_version",
];

// Named objects that must never be dropped: indexes, constraints, triggers
// and functions created by the ledger migration outside Prisma's model.
const GUARDED_NAMES = [
  // item_state_interval indexes + constraints
  "isi_no_overlap",
  "isi_one_open_per_item",
  "isi_range_live",
  "isi_item_time",
  "isi_closed",
  "isi_run",
  // item_state_event indexes (ise_super is partial — invisible to Prisma;
  // ise_key_uq is a table CONSTRAINT, caught by the ALTER TABLE rule)
  "ise_run",
  "ise_item",
  "ise_super",
  // route_run indexes
  "route_run_uq",
  "route_run_one_open",
  "route_run_closed",
  // calendar
  "wcv_one_current",
  "work_span_no_overlap",
  "work_span_ladder",
  // drift / ops
  "metrics_drift_open",
  "job_run_recent",
  // guards added to legacy tables
  "testing_routes_type_number_uq",
  "ir_item_fk",
  // triggers
  "trg_ise_immutable",
  "trg_isi_apply",
  "trg_metrics_drift",
  // functions
  "state_of",
  "deny_mutation",
  "work_calendar_build",
  "business_date",
  "current_calendar_version",
  "work_seconds_elapsed",
  "work_seconds_between",
  "metrics_open_run",
  "isi_apply_one",
  "isi_apply_event",
  "isi_rebuild_run",
  "metrics_detect_drift",
  "metrics_selfcheck",
  "metrics_record",
];

// The extended destructive regex from the migration plan (section 8, stage 2).
const DESTRUCTIVE_RE =
  /\b(DROP\s+TABLE|DROP\s+FUNCTION|DROP\s+TRIGGER|DROP\s+INDEX|DROP\s+CONSTRAINT|DROP\s+EXPRESSION|DROP\s+EXTENSION)\b/i;

const metricsTableRe = new RegExp(
  `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:"?public"?\\.)?"?(${METRICS_TABLES.join("|")})"?\\b[\\s\\S]*\\bDROP\\b`,
  "i",
);

// Word-boundary match: "isi_closed" must not fire inside a longer identifier
// like "isi_closed_sync" (whose own drops are caught by the ALTER TABLE rule).
function guardedNameIn(statement) {
  const lower = statement.toLowerCase();
  return GUARDED_NAMES.find((name) =>
    new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(lower),
  );
}

// Strip -- line comments so a commented-out DROP cannot fire, then split into
// statements on semicolons. Good enough for Prisma-generated SQL, which never
// puts a literal ';' inside a string in DDL it emits.
function statementsOf(sql) {
  const stripped = sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// An INTENTIONAL retirement, declared inside the migration that performs it:
//
//   -- metrics-guard: intentional-drop trg_metrics_drift, metrics_detect_drift
//
// The guard exists to catch drops nobody meant to write — `prisma migrate dev`
// regenerating a DROP for an object Prisma cannot express. It must not stand in
// the way of deliberately retiring one, but the exemption has to be narrow and
// visible: it names the exact objects, it lives in the file that drops them
// where a reviewer reads it, and it covers that file only. Deleting the names
// from GUARDED_NAMES instead would silently un-guard them for every future
// migration too.
const INTENTIONAL_RE = /--\s*metrics-guard:\s*intentional-drop\s+([^\n]+)/gi;

function intentionalDropsIn(rawSql) {
  const allowed = new Set();
  for (const m of rawSql.matchAll(INTENTIONAL_RE)) {
    for (const name of m[1].split(/[,\s]+/)) {
      const clean = name.trim().toLowerCase();
      if (clean) allowed.add(clean);
    }
  }
  return allowed;
}

const newMigrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  // Timestamp-prefixed names sort chronologically.
  .sort()
  .filter((name) => name > LEDGER_MIGRATION);

const findings = [];

for (const name of newMigrations) {
  const sqlPath = path.join(migrationsDir, name, "migration.sql");
  if (!fs.existsSync(sqlPath)) continue;
  const sql = fs.readFileSync(sqlPath, "utf8");
  const intentional = intentionalDropsIn(sql);

  for (const stmt of statementsOf(sql)) {
    const destructive = DESTRUCTIVE_RE.test(stmt);
    const metricsAlter = metricsTableRe.test(stmt);
    if (!destructive && !metricsAlter) continue;

    const guarded = guardedNameIn(stmt);
    const extensionDrop = /\bDROP\s+EXTENSION\b[\s\S]*\bbtree_gist\b/i.test(stmt);

    // A declared retirement passes; anything else in the same file still blocks.
    if (guarded && intentional.has(guarded)) continue;

    if (guarded || metricsAlter || extensionDrop) {
      findings.push({
        migration: name,
        object: guarded || (extensionDrop ? "btree_gist" : "a metrics table"),
        statement: stmt.replace(/\s+/g, " ").slice(0, 200),
      });
    }
  }
}

if (findings.length > 0) {
  console.error("");
  console.error("BLOCKED: migration(s) drop guarded metrics-ledger objects.");
  console.error("");
  for (const f of findings) {
    console.error(`  prisma/migrations/${f.migration}/migration.sql`);
    console.error(`    touches: ${f.object}`);
    console.error(`    ${f.statement}`);
    console.error("");
  }
  console.error(
    "Prisma cannot express these objects (partial/GiST indexes, EXCLUDE",
  );
  console.error(
    "constraints, triggers, functions, GENERATED columns), so `migrate dev`",
  );
  console.error(
    "regenerates drops for them. Do NOT commit this migration as-is:",
  );
  console.error(
    "delete the offending statements from the migration.sql by hand, or",
  );
  console.error(
    "regenerate with `prisma migrate dev --create-only` and edit before",
  );
  console.error(
    "applying. Full workflow: docs/PRISMA_UNMANAGED_OBJECTS.md",
  );
  console.error("");
  process.exit(1);
}

console.log(
  `check-migration-safety: OK (${newMigrations.length} migration(s) newer than the metrics ledger scanned, nothing destructive).`,
);
