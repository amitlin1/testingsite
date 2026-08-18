// Build the settings-page reference data seed for the DB server.
//
//   node scripts/build-settings-seed.js
//   node scripts/build-settings-seed.js --db InventoryDB --container postgres
//
// Writes prod-deploy/db-server/settings-seed/settings-seed.sql, applied on the
// target machine by db-server/scripts/7-seed-settings.ps1.
//
// WHAT IT CAPTURES: the lookup/configuration tables behind every /settings page
// — customers, item types, sources, the two status lists, station types and
// stations, testing routes, photo types, reference items and their image
// records, and the work-hours calendar. NOT transactional data (items,
// shipments, test results, snapshots): a new installation starts empty of those.
// Identity ("who did this") is Keycloak-only now — no local `workers` table.
//
// THREE THINGS THIS FILE HAS TO GET RIGHT, each of which silently breaks the
// target otherwise:
//
//   1. FK ORDER. pg_dump emits tables alphabetically, which would insert
//      reference_item_images before reference_items and fail. TABLES below is in
//      dependency order and each table is dumped separately to preserve it.
//
//   2. SEQUENCE RESET. Rows carry explicit ids, but the sequences behind those
//      id columns stay at 1. Without setval the first row a user adds in the UI
//      collides with a seeded id — a duplicate-key error on an apparently
//      healthy system. Emitted from pg_get_serial_sequence, so a table without a
//      sequence (natural PK) is skipped automatically.
//
//   3. TRUE UPSERT SEMANTICS ARE NOT ATTEMPTED. The seed is for a NEW
//      installation. 7-seed-settings.ps1 refuses to run against tables that
//      already hold data unless told otherwise.
//
// Reference-item IMAGES also live in MinIO. The row carries bucket + object_key;
// the bytes are exported next to this file by the same script into
// settings-seed/minio-files/, and uploaded by step 7.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}
const CONTAINER = arg("container", "postgres");
const DB = arg("db", "InventoryDB");
const USER = arg("user", "appuser");
// The MinIO container name in the DEV compose (docker-compose.db.yml).
const MINIO_CONTAINER = arg("minio", "FileServiceDB");

// ---- the settings tables, in FK dependency order ---------------------------
// Verified against pg_constraint:
//   reference_items       -> item_types
//   test_stations         -> test_stations_type
//   testing_routes        -> item_types, test_stations_type
//   department_holidays   -> holiday_types
//   reference_item_images -> reference_items, photo_types
const TABLES = [
  // no dependencies
  "customers",
  "item_types",
  "sources",
  "item_status",
  "test_station_status",
  "test_stations_type",
  "photo_types",
  "holiday_types",
  "weekday_defaults",
  "workday_overrides",
  // depend on the above
  "reference_items",
  "test_stations",
  "testing_routes",
  "department_holidays",
  // depends on reference_items + photo_types
  "reference_item_images",
];

const outDir = path.join(__dirname, "..", "prod-deploy", "db-server", "settings-seed");
const outFile = path.join(outDir, "settings-seed.sql");
const filesDir = path.join(outDir, "minio-files");

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", USER, "-d", DB, "-tAX", "-c", sql],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }
  ).trim();
}

function pgDumpTable(table) {
  // --column-inserts: survives a column being added or reordered later.
  // --data-only + --no-owner: schema and ownership come from 02-app-schema.sql.
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "pg_dump", "-U", USER, "-d", DB,
      "--data-only", "--column-inserts", "--no-owner", "--no-privileges",
      "--table=public." + table],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 256 }
  );
}

// Keep only INSERT lines: pg_dump's SET/SELECT preamble is repeated per table
// and its `\restrict` meta-command cannot be parsed outside psql.
//
// ON CONFLICT DO NOTHING is appended to every row. Three of these tables
// (holiday_types, photo_types, weekday_defaults) are already populated by the
// MIGRATIONS on a fresh database, so a plain INSERT would abort the whole
// transaction on a duplicate key. With this, the load is idempotent and tops up
// only what is missing.
//
// Consequence worth knowing: a row that already exists is LEFT AS IS, so an
// edit made to one of those defaults in development is not carried over by a
// normal run. 7-seed-settings.ps1 -Force deletes first and therefore does apply
// them exactly.
function insertsOnly(dump) {
  return dump
    .split(/\r?\n/)
    .filter((l) => l.startsWith("INSERT INTO "))
    .map((l) => l.replace(/;\s*$/, " ON CONFLICT DO NOTHING;"))
    .join("\n");
}

const parts = [];
const counts = [];

for (const t of TABLES) {
  const n = parseInt(psql(`SELECT count(*) FROM public."${t}";`), 10) || 0;
  counts.push({ table: t, rows: n });
  const body = n > 0 ? insertsOnly(pgDumpTable(t)) : "";
  parts.push(
    `-- ---------------------------------------------------------------------------\n` +
    `-- ${t}  (${n} row${n === 1 ? "" : "s"})\n` +
    `-- ---------------------------------------------------------------------------\n` +
    (body ? body + "\n" : `-- (no rows)\n`)
  );
}

// ---- sequence resets -------------------------------------------------------
// Built from pg_get_serial_sequence so this tracks the schema rather than a
// hand-maintained list. setval(..., max(id)) with is_called=true means the NEXT
// value handed out is max+1.
const seqLines = [];
for (const t of TABLES) {
  const cols = psql(
    `SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = 'public."${t}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_get_serial_sequence('public."${t}"', a.attname) IS NOT NULL;`
  );
  for (const col of cols.split(/\r?\n/).filter(Boolean)) {
    // PERFORM, not SELECT: a bare SELECT setval() prints a one-row result set
    // per sequence, and fourteen of those bury the load's actual summary.
    seqLines.push(
      `    PERFORM setval(pg_get_serial_sequence('public."${t}"', '${col}'), ` +
      `COALESCE((SELECT MAX("${col}") FROM public."${t}"), 0) + 1, false);`
    );
  }
}

// ---- export the reference-item images out of MinIO --------------------------
let imageNote = "-- (no reference-item images)";
const imgRows = psql(
  `SELECT bucket || '|' || object_key FROM public.reference_item_images ORDER BY reference_item_image_id;`
);
const images = imgRows.split(/\r?\n/).filter(Boolean).map((l) => {
  const i = l.indexOf("|");
  return { bucket: l.slice(0, i), key: l.slice(i + 1) };
});

fs.rmSync(filesDir, { recursive: true, force: true });
if (images.length) {
  fs.mkdirSync(filesDir, { recursive: true });
  const manifest = [];
  for (const img of images) {
    // Flatten the object key into a single filename; the manifest maps it back.
    const flat = img.key.replace(/[\\/]/g, "__");
    const dest = path.join(filesDir, flat);
    try {
      // Pull through `mc` INSIDE the running MinIO container: it already holds
      // the root credentials in its own env, so nothing has to be passed in.
      // (Copying /data directly does not work - MinIO stores objects as xl.meta
      // structures, not as plain files.)
      execFileSync("docker", ["exec", MINIO_CONTAINER, "sh", "-c",
        `mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; ` +
        `mc cp "local/${img.bucket}/${img.key}" "/tmp/${flat}" >/dev/null 2>&1`,
      ], { stdio: "ignore" });
      execFileSync("docker", ["cp", `${MINIO_CONTAINER}:/tmp/${flat}`, dest], { stdio: "ignore" });
      execFileSync("docker", ["exec", MINIO_CONTAINER, "rm", "-f", `/tmp/${flat}`], { stdio: "ignore" });
    } catch { /* reported below via the existence check */ }
    manifest.push({ bucket: img.bucket, key: img.key, file: flat, ok: fs.existsSync(dest) });
  }
  fs.writeFileSync(path.join(filesDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const okCount = manifest.filter((m) => m.ok).length;
  imageNote = `-- ${okCount}/${manifest.length} reference-item image(s) exported to settings-seed/minio-files/`;
  console.log(`images exported: ${okCount}/${manifest.length}`);
}

// ---- assemble --------------------------------------------------------------
const header = `-- ===========================================================================
-- SETTINGS REFERENCE DATA - generated, do not edit by hand
-- ===========================================================================
-- Generated by scripts/build-settings-seed.js from the ${DB} database.
-- Applied by db-server/scripts/7-seed-settings.ps1.
--
-- Contents: the lookup/configuration tables behind the /settings pages. NOT
-- transactional data - a new installation starts with no items or shipments.
--
-- Tables are ordered by FOREIGN KEY dependency, not alphabetically, so this
-- file loads top to bottom without deferring constraints.
--
-- Row counts at generation time:
${counts.map((c) => `--   ${c.table.padEnd(24)} ${c.rows}`).join("\n")}
--
${imageNote}
-- ===========================================================================

BEGIN;

`;

const footer = `

-- ---------------------------------------------------------------------------
-- Sequence reset
-- ---------------------------------------------------------------------------
-- The rows above carry explicit ids while the sequences behind those columns
-- are still at 1. Without this, the first record a user creates in the UI
-- collides with a seeded id and fails on a duplicate key.
DO $seq$
BEGIN
${seqLines.join("\n")}
END
$seq$;

COMMIT;
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, header + parts.join("\n") + footer, "utf8");

console.log("wrote", outFile);
console.log("tables:", TABLES.length, "| total rows:", counts.reduce((a, c) => a + c.rows, 0));
console.log("sequence resets:", seqLines.length);
