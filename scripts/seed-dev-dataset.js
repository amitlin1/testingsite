// Fill a DEVELOPMENT database with a realistic 13-month dataset for the metrics
// dashboard — and, in the same run, exercise the real write path end to end.
//
//   # 1. the dev server has to be up, with IS_DEV=1 and a CRON_SECRET:
//   IS_DEV=1 NODE_ENV=development \
//   DATABASE_URL="postgresql://appuser:masha7300@localhost:5432/testingsite?schema=public" \
//   AUTH_SECRET=local_dev_secret_change_in_prod NEXTAUTH_SECRET=local_dev_secret_change_in_prod \
//   CRON_SECRET=seed-cron-secret npx next dev -p 3000
//
//   # 2. then, from the repo root:
//   node scripts/seed-dev-dataset.js --confirm --reset
//   node scripts/seed-dev-dataset.js --confirm --reset --months 13 --items-per-month 38
//   node scripts/seed-dev-dataset.js --confirm --skip-history      # API exercise only
//   node scripts/seed-dev-dataset.js --confirm --reset --skip-api  # history only (ref data must exist)
//
// EXIT CODE: 0 only when every call answered 2xx and every invariant held.
// Any system finding exits 1 — the findings are the point, not an afterthought.
// A full default run is ~2.5 minutes and produces ~610 items / ~9,800 events /
// ~6,200 intervals over 13 months.
//
// ---------------------------------------------------------------------------
// WHY IT IS BUILT THE WAY IT IS
// ---------------------------------------------------------------------------
// The dataset has to be correct by construction, so it is produced by the
// system's own logic wherever the system is able to produce it:
//
//   PHASE A — over real HTTP. Reference data, the work-hours calendar,
//   shipments, items, accessories and a RECENT window of genuine activity:
//   items walked through their routes with real start-test / results /
//   release-test calls, a real reaper run, and a deliberate set of items left
//   in flight so the live board is populated. Every response is status-checked;
//   a non-2xx is reported as a SYSTEM FINDING, never papered over.
//
//   PHASE B — DB-direct, backdated. The one thing the API cannot do is history:
//   metrics_record() stamps occurred_at with clock_timestamp() and the plan
//   (§4.2, §7.5) deliberately never trusts a client clock. So the older months
//   are written as item_state_event rows with explicit occurred_at, in
//   chronological order per item, after inserting the route_run. The AFTER
//   INSERT trigger (trg_isi_apply -> isi_apply_one) folds them into
//   item_state_interval exactly as it does for live traffic. The event SHAPES
//   are not invented: Phase A's events are read back out of the DB and their
//   (reason, kind, to_state, seq, station/type nullability, key format)
//   signatures are compared against everything Phase B emits — a mismatch is
//   reported as a finding, so history and live data stay structurally identical.
//
// TIME IS NOT UNIFORM. Phase B walks a cursor along work_span — the same
// calendar ladder the ledger itself uses — so every transition lands inside
// working hours (Sun-Thu 07:00-15:35, break 12:00-13:00) and long waits
// straddle nights and weekends. That gap is the entire point of the two-clock
// model (§2.8): a dataset where every queue interval fits inside one working
// day would report wall_seconds == work_seconds everywhere and prove nothing.
// The run FAILS LOUDLY if the straddle count comes out zero.
//
// THE LEDGER IS THE ORACLE, NOT THE SEEDER. item_state_interval carries
// EXCLUDE (item_id WITH =, valid_range WITH &&) plus one-open-interval-per-item;
// a wrong sequence aborts its own transaction instead of writing bad data. The
// run also ENABLEs trg_metrics_drift (§3.8, which ships disabled) so any
// disagreement between item_routes and the ledger surfaces immediately, and
// leaves it enabled afterwards.
//
// THE ONE CLOCK FORGERY, DECLARED. The stale-test reaper only reverts rows
// whose item_routes.processing_start_time is older than their station type's
// test_stations_type.stale_after_minutes (0 = that type is never reverted). To
// exercise it in a run that takes minutes, the seeder backdates
// processing_start_time past each parked row's OWN threshold — an item_routes
// column, nothing in the ledger. The released_stale events themselves are
// produced by the real POST /api/cron/release-stale-tests.
//
// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------
//   * --confirm is mandatory. Without it nothing runs.
//   * Refuses to start when `items` already holds rows, unless --reset.
//   * --reset TRUNCATEs the TRANSACTIONAL + LEDGER tables listed in RESET_TABLES
//     and nothing else — no DDL, no settings/reference data, no schema changes.
//     (item_state_event's append-only trigger is briefly disabled for the
//     TRUNCATE and re-enabled in the same transaction.)
//   * The target DB comes from --database-url or $DATABASE_URL. There is no
//     hardcoded database name in this file, and the run aborts if the URL's
//     database name looks like production (PROD_LOOKING).
//   * Reference rows (customers, item types, stations, routes) are
//     get-or-created by name, so re-running never duplicates them. Stations this
//     seeder did not create are removed only when the DELETE endpoint confirms
//     nothing references them (it answers 409 otherwise), and are DISABLED
//     (status 3, via the real PUT) when it does not — they would otherwise keep
//     attracting work and scatter the demo data. --keep-foreign-stations turns
//     that off.

const { Pool } = require("pg");
const crypto = require("crypto");

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
function flag(name) { return argv.includes("--" + name); }

const CONFIRM = flag("confirm");
const RESET = flag("reset");
const SKIP_API = flag("skip-api");
const SKIP_HISTORY = flag("skip-history");
const KEEP_FOREIGN_STATIONS = flag("keep-foreign-stations");
const MONTHS = parseInt(arg("months", "13"), 10);
const ITEMS_PER_MONTH = parseInt(arg("items-per-month", "38"), 10);
// Phase A is the API EXERCISE, not the bulk of the dataset. Every item it
// walks is created and finished inside the seed run, so each one it takes all
// the way to done piles another handful of interval closures onto today —
// server-owned timestamps leave no way to spread them. Keep it to the number
// needed to cover the endpoints and the branches, and let phase B supply the
// volume.
const API_ITEMS = parseInt(arg("api-items", "14"), 10);
const PORT = parseInt(arg("port", "3000"), 10);
const API_BASE = arg("api-base", `http://localhost:${PORT}`).replace(/\/+$/, "");
const SEED = parseInt(arg("seed", "20260825"), 10);
const DATABASE_URL = arg("database-url", process.env.DATABASE_URL || "");
const AUTH_SECRET = arg("auth-secret", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "local_dev_secret_change_in_prod");
const CRON_SECRET = arg("cron-secret", process.env.CRON_SECRET || "seed-cron-secret");

// A database whose name smells like production is refused outright: this script
// TRUNCATEs and then writes hundreds of fabricated items.
const PROD_LOOKING = /(^|[^a-z])(prod|production|inventorydb)([^a-z]|$)/i;

function usage(msg) {
  console.error("\n" + msg);
  console.error(`
usage: node scripts/seed-dev-dataset.js --confirm [options]

  --confirm                 required; nothing happens without it
  --reset                   TRUNCATE transactional + ledger tables first
  --months N                months of history INCLUDING the live one (default 13)
  --items-per-month N       routed parent items per month (default 38)
  --api-items N             parent items walked over real HTTP (default 14)
  --api-base URL            default http://localhost:<port>
  --port N                  default 3000 (only used to build the default api-base)
  --seed N                  deterministic RNG seed (default 20260825)
  --database-url URL        default $DATABASE_URL
  --skip-api                skip phase A (history only; reference data must exist)
  --skip-history            skip phase B (API exercise only)
  --keep-foreign-stations   do not disable stations this seeder did not create
`);
  process.exit(2);
}

if (!CONFIRM) usage("refusing to run without --confirm");
if (!DATABASE_URL) usage("no target database: pass --database-url or set DATABASE_URL");
const DB_NAME = (() => {
  try { return new URL(DATABASE_URL).pathname.replace(/^\//, ""); } catch { return ""; }
})();
if (!DB_NAME) usage("cannot parse a database name out of --database-url");
if (PROD_LOOKING.test(DB_NAME)) usage(`refusing to seed a production-looking database: "${DB_NAME}"`);
if (!(MONTHS >= 1 && MONTHS <= 36)) usage("--months must be 1..36");
if (!(ITEMS_PER_MONTH >= 1 && ITEMS_PER_MONTH <= 500)) usage("--items-per-month must be 1..500");
if (!(API_ITEMS >= 1 && API_ITEMS <= 500)) usage("--api-items must be 1..500");
if (SKIP_API && SKIP_HISTORY) usage("--skip-api together with --skip-history leaves nothing to do");

// ---- deterministic RNG -----------------------------------------------------
// mulberry32: the same --seed produces the same dataset, so a dashboard bug
// found on one run is reproducible on the next.
let rngState = SEED >>> 0;
function rnd() {
  rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// ---- the reference data the seeder wants to exist --------------------------
const CUSTOMERS = [
  { name: "מפעלי רדאר צפון", customer_code: "RDRN" },
  { name: "תעופה וחלל בעמ", customer_code: "AVIC" },
  { name: "מערכות ים תיכון", customer_code: "MEDS" },
  { name: "אלקטרוניקה הרצליה", customer_code: "ELHR" },
];
const SOURCES = ["החזרה מהשטח", "קו ייצור", "מלאי מרכזי"];
// stale_after_minutes is test_stations_type's reaper threshold: minutes an item
// may sit in test / in research on a station of this type with no result before
// /api/cron/release-stale-tests reverts it. 0 = never. These values are what
// decide the SHAPE of the dataset — how long a `testing` interval may be, and
// whether it may cross a night — so they are chosen to span the whole range the
// dashboard has to render, not just the flat 30 the endpoint used to hardcode.
const STATION_TYPES = [
  { key: "INT", desc: "אשף קליטה", parents_only: true,  stale_after_minutes: 30 },
  { key: "VIS", desc: "בדיקה ויזואלית", parents_only: false, stale_after_minutes: 30 },
  // A functional test is a bench session of up to a few hours.
  { key: "FUN", desc: "בדיקה תפקודית", parents_only: false, stale_after_minutes: 240 },
  // A climate chamber runs unattended overnight — the item is physically in the
  // chamber, so the bench stays locked for a day at a time.
  { key: "ENV", desc: "בדיקת סביבה", parents_only: false, stale_after_minutes: 1440 },
  // A research bench holds a unit open for days. There is no duration at which
  // "the researcher must have abandoned it" becomes a safe guess, so this type
  // opts out of the reaper entirely.
  { key: "RES", desc: "מעבדת מחקר", parents_only: false, stale_after_minutes: 0 },
];
const STATIONS = [
  { type: "INT", desc: "עמדת קליטה 1", is_research: false },
  { type: "VIS", desc: "ויזואלית 1", is_research: false },
  { type: "VIS", desc: "ויזואלית 2", is_research: false },
  { type: "FUN", desc: "תפקודית 1", is_research: false },
  { type: "FUN", desc: "תפקודית 2", is_research: false },
  { type: "FUN", desc: "תפקודית 3", is_research: false },
  { type: "ENV", desc: "תא אקלים 1", is_research: false },
  { type: "ENV", desc: "תא אקלים 2", is_research: false },
  { type: "RES", desc: "מעבדת מחקר 1", is_research: true },
  { type: "RES", desc: "מעבדת מחקר 2", is_research: true },
];
// route_steps hold STATION TYPE ids. 3-6 steps each. The two types that carry
// accessories start at the parents_only "אשף קליטה" step — that is what makes
// the intake wizard's accessory submissions (call site #15, the synthetic
// test_started/result_submitted pair) reachable at all.
const ITEM_TYPES = [
  { desc: "יחידת רדיו", accessory: false, routes: { 1: ["INT", "VIS", "FUN", "ENV", "FUN"] } },
  { desc: "מקלט VHF", accessory: false, routes: { 1: ["VIS", "FUN", "ENV"], 2: ["VIS", "FUN", "ENV", "VIS"] } },
  { desc: "מגבר הספק", accessory: false, routes: { 1: ["INT", "VIS", "FUN", "FUN", "ENV", "VIS"] } },
  { desc: "ספק כוח", accessory: false, routes: { 1: ["VIS", "FUN", "FUN"] } },
  { desc: "לוח בקרה", accessory: false, routes: { 1: ["INT", "FUN", "VIS", "ENV"] } },
  { desc: "אנטנה כיוונית", accessory: false, routes: { 1: ["VIS", "ENV", "FUN", "VIS"] } },
  { desc: "כבל תדר גבוה", accessory: true, routes: { 1: ["INT", "VIS", "FUN"] } },
  { desc: "ערכת מחברים", accessory: true, routes: { 1: ["INT", "VIS", "ENV"] } },
];
const ACCESSORY_PARENTS = ["יחידת רדיו", "מגבר הספק"];
const WORKERS = [
  { id: 4101, name: "אורי בן-דוד" }, { id: 4102, name: "נועה שגב" },
  { id: 4103, name: "רם אזולאי" }, { id: 4104, name: "מיכל בר-ששת" },
  { id: 4105, name: "יונתן כהן" }, { id: 4106, name: "שירה מזרחי" },
  { id: 4107, name: "אבי לוגסי" }, { id: 4108, name: "תמר גולן" },
];
const STOREKEEPERS = [
  { id: 4201, name: "דנה פרץ" }, { id: 4202, name: "עומר שלו" }, { id: 4203, name: "ליאת אדרי" },
];
const MANUFACTURERS = ["Rohde", "Tadiran", "Elbit", "Aeronautics", "Elta"];
const MODELS = ["RX-220", "PA-90", "PSU-12", "CTRL-7", "ANT-45", "VHF-3000"];
const COMMENTS_PASS = ["עבר בדיקה מלאה", "תקין ללא ממצאים", "נבדק לפי נוהל 12", "כויל ונמצא תקין"];
const COMMENTS_FAIL = ["חריגה בהספק המוצא", "רעש מוגבר בכניסה", "מחבר פגום הוחלף", "סטייה בתדר הנשא"];
const RESEARCH_NOTES = ["נפתחה יחידה לבדיקת מעגל", "בוצעה מדידה במחולל", "ממתין לחלף מהמחסן", "נמצא כשל בקבל C14"];
// Markers that let a re-run recognise, and remove, the work-hours rows a
// PREVIOUS run wrote. --reset does not touch settings tables.
const SEEDED_HOLIDAY = "חופשה מרוכזת קיץ";
const SEEDED_NOTES = new Set(["יום קצר לפני חג", "יום חופש מחלקתי"]);

// ---- tables the reset is allowed to touch ----------------------------------
// Ledger + transactional + trigger-derived counters. NOT settings/reference,
// NOT schema. Grouped so the list reads as an inventory.
const RESET_TABLES = [
  // ledger (plan §3)
  "item_state_interval", "item_state_event", "route_run", "metrics_drift", "job_run",
  // legacy transactional history the stage-5 parity harness reads
  "test_results", "research_history", "item_route_history", "finished_item",
  // core transactional
  "item_routes", "items", "shipment_items", "shipment_history", "shipments", "daily_counters",
  // trigger-derived
  "station_live_counters",
];

// ---- db --------------------------------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function q1(sql, params = []) { return (await q(sql, params))[0] || null; }

// ---- http ------------------------------------------------------------------
// Every call is counted per endpoint and status-checked. A non-2xx is a FINDING
// about the system under test: printed on the spot, summarised at the end.
const callStats = new Map();
const findings = [];
let sessionCookie = null;

function endpointLabel(method, path) {
  const clean = path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id");
  return `${method} ${clean}`;
}
function finding(endpoint, status, payload, body, extra) {
  findings.push({ endpoint, status, payload, body: String(body).slice(0, 600), extra });
  console.log(`  !! ${endpoint} -> ${status}${extra ? ` (${extra})` : ""}`);
  if (payload !== undefined && payload !== null) console.log(`     payload: ${JSON.stringify(payload).slice(0, 300)}`);
  console.log(`     body:    ${String(body).slice(0, 300)}`);
}

async function api(method, path, opts = {}) {
  const { body, cron = false, auth = true, expect = [200, 201], quiet = false } = opts;
  const label = opts.label || endpointLabel(method, path);
  const headers = { "content-type": "application/json" };
  if (auth && sessionCookie) headers.cookie = `authjs.session-token=${sessionCookie}`;
  if (cron) headers["x-cron-secret"] = CRON_SECRET;

  let res, text;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    const s = callStats.get(label) || { ok: 0, fail: 0 };
    s.fail++; callStats.set(label, s);
    finding(label, "NETWORK", body ?? null, e.message);
    return { ok: false, status: 0, json: null, text: String(e.message) };
  }
  const s = callStats.get(label) || { ok: 0, fail: 0 };
  const good = expect.includes(res.status);
  if (good) s.ok++; else s.fail++;
  callStats.set(label, s);

  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!good && !quiet) finding(label, res.status, body ?? null, text);
  return { ok: good, status: res.status, json, text };
}

/** Mint an Auth.js session cookie offline. IS_DEV=1 bypasses the middleware but
 *  NOT withAuth() (src/lib/auth/withAuth.ts calls auth() directly and has no dev
 *  bypass), and shipments + every work-hours route are wrapped in it. Roles
 *  deliberately EXCLUDE `storekeeper`: POST /api/shipments overwrites the
 *  receiving worker with the session's own employee number for storekeepers,
 *  and the seeder wants to vary that per shipment. */
async function mintSession() {
  const { encode } = await import("next-auth/jwt");
  const now = Math.floor(Date.now() / 1000);
  return encode({
    secret: AUTH_SECRET, salt: "authjs.session-token", maxAge: 86400 * 30,
    token: {
      sub: "seed-bot", name: "Seed Bot", email: "seed@example.local",
      preferred_username: "seedbot", employee_number: "9001",
      roles: ["manager", "mashan", "tester"],
      access_token: "seed", expires_at: (now + 86400 * 30) * 1000,
      refresh_expires_at: (now + 86400 * 30) * 1000, iat: now, exp: now + 86400 * 30,
    },
  });
}

// ---- small helpers ---------------------------------------------------------
const trim = (s) => (s == null ? "" : String(s).trim());
const uuid = () => crypto.randomUUID();
const pad = (n, w) => String(n).padStart(w, "0");
let serialCounter = 1000;
const nextSerial = (p) => `${p}-${++serialCounter}`;
const jerusalemYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);

/** microseconds-since-epoch -> a postgres-safe ISO string with µs precision.
 *  The ledger's tie-break is (occurred_at, seq, event_id) and metrics_record
 *  clamps colliding stamps to +1µs — history has to be able to express that. */
function usToIso(us) {
  const ms = Math.floor(us / 1000);
  const frac = us - ms * 1000;
  return new Date(ms).toISOString().replace("Z", pad(frac, 3) + "Z");
}

const counters = { apiItems: 0, apiAccessories: 0, histItems: 0, histAccessories: 0, histEvents: 0, skippedItems: 0 };

// ===========================================================================
// PHASE 0 — preflight
// ===========================================================================
async function preflight() {
  console.log("\n=== preflight ===");
  console.log(`database : ${DB_NAME}`);
  console.log(`api base : ${API_BASE}`);
  console.log(`seed     : ${SEED}   months: ${MONTHS}   items/month: ${ITEMS_PER_MONTH}`);

  const ver = await q1("SELECT version FROM metrics_schema_version WHERE id = 1");
  if (!ver) throw new Error("metrics_schema_version is empty — migration A (20260825000000_metrics_ledger_additive) is not applied");
  console.log(`metrics schema version: ${ver.version}`);

  const items = await q1("SELECT count(*)::int AS n FROM items");
  if (items.n > 0 && !RESET) {
    throw new Error(`refusing to seed: items already holds ${items.n} row(s). Re-run with --reset to TRUNCATE the transactional + ledger tables first.`);
  }

  // item_status / test_station_status are DISPLAY tables whose ids the ledger
  // maps onto (metric_state.legacy_status_id). Their ids are sequence-assigned
  // and cannot be chosen through the settings API, so verify — never create.
  const st = await q("SELECT item_status_id FROM item_status ORDER BY 1");
  const missing = [1, 2, 3, 4, 5].filter((i) => !st.some((r) => r.item_status_id === i));
  if (missing.length) {
    finding("DB item_status", "MISSING", missing,
      "item_status lacks the ids metric_state.legacy_status_id maps onto; the ledger would report 'unmapped'");
  }

  if (RESET) {
    console.log(`--reset: TRUNCATE ${RESET_TABLES.length} transactional/ledger tables`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // item_state_event is append-only by trigger and denies TRUNCATE. Disable
      // for this transaction only — ALTER TABLE ... DISABLE TRIGGER is
      // transactional in postgres, so a failure here rolls the trigger back on.
      await client.query("ALTER TABLE item_state_event DISABLE TRIGGER trg_ise_immutable");
      await client.query(`TRUNCATE ${RESET_TABLES.map((t) => `public."${t}"`).join(", ")} RESTART IDENTITY`);
      await client.query("ALTER TABLE item_state_event ENABLE TRIGGER trg_ise_immutable");
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }

  // §3.8: the drift detector ships DISABLED. Enable it for the run so any
  // disagreement between item_routes and the ledger aborts/records immediately,
  // and leave it enabled afterwards.
  await q("ALTER TABLE item_routes ENABLE TRIGGER trg_metrics_drift");
  console.log("trg_metrics_drift: ENABLED for the run (and left enabled)");
}

// ===========================================================================
// PHASE A.1 — reference data, over the real settings API
// ===========================================================================
const ref = {
  customers: [], sources: [], stationTypes: new Map(), stations: [],
  // test_station_type_id -> stale_after_minutes, read back from the DB/API so
  // the simulation is driven by what the reaper will actually enforce.
  staleByTypeId: new Map(),
  itemTypes: [], byTypeDesc: new Map(), researchStations: [], shipments: [],
  disabledStations: new Set(),
};

async function ensureReference() {
  console.log("\n=== phase A.1 — reference data (settings API) ===");

  // customers -------------------------------------------------------------
  const gotCustomers = await api("GET", "/api/settings/customers");
  const existingCustomers = gotCustomers.json || [];
  for (const c of CUSTOMERS) {
    const hit = existingCustomers.find((r) => trim(r.customer_code) === c.customer_code);
    if (hit) { ref.customers.push({ id: hit.id, ...c }); continue; }
    const res = await api("POST", "/api/settings/customers", { body: c });
    if (res.ok && res.json?.id) ref.customers.push({ id: res.json.id, ...c });
  }

  // sources ---------------------------------------------------------------
  const gotSources = await api("GET", "/api/settings/sources");
  const existingSources = gotSources.json || [];
  for (const s of SOURCES) {
    const hit = existingSources.find((r) => trim(r.source_desc) === s);
    if (hit) { ref.sources.push({ id: hit.source_id, desc: s }); continue; }
    const res = await api("POST", "/api/settings/sources", { body: { source_desc: s } });
    if (res.ok && res.json?.source_id) ref.sources.push({ id: res.json.source_id, desc: s });
  }

  // station types ---------------------------------------------------------
  const gotTypes = await api("GET", "/api/settings/test-stations-type");
  const existingTypes = gotTypes.json || [];
  for (const t of STATION_TYPES) {
    const hit = existingTypes.find((r) => trim(r.test_type_desc) === t.desc);
    if (hit) {
      ref.stationTypes.set(t.key, hit.test_station_type_id);
      // A type left over from an older run carries the column DEFAULT (30) and
      // would silently cap every test at half an hour again. Realign it through
      // the real PUT — same treatment the stations above already get.
      if (hit.stale_after_minutes !== t.stale_after_minutes) {
        await api("PUT", `/api/settings/test-stations-type/${hit.test_station_type_id}`, {
          body: {
            test_station_type_id: hit.test_station_type_id, test_type_desc: t.desc,
            parents_only: t.parents_only, stale_after_minutes: t.stale_after_minutes,
          },
        });
      }
      continue;
    }
    const res = await api("POST", "/api/settings/test-stations-type", {
      body: { test_type_desc: t.desc, parents_only: t.parents_only, stale_after_minutes: t.stale_after_minutes },
    });
    if (res.ok && res.json?.test_station_type_id) ref.stationTypes.set(t.key, res.json.test_station_type_id);
  }
  // Read the thresholds back from the DB rather than trusting STATION_TYPES:
  // a type the seeder did not create still routes work, and the walk generator
  // must plan against the value the reaper will read.
  for (const r of await q("SELECT test_station_type_id, stale_after_minutes FROM test_stations_type")) {
    ref.staleByTypeId.set(Number(r.test_station_type_id), Number(r.stale_after_minutes));
  }

  // stations --------------------------------------------------------------
  // status is passed explicitly: the POST handler defaults it to 0, which
  // matches no test_station_status row at all.
  const gotStations = await api("GET", "/api/settings/test-stations");
  const existingStations = gotStations.json || [];
  for (const s of STATIONS) {
    const typeId = ref.stationTypes.get(s.type);
    if (!typeId) continue;
    const hit = existingStations.find((r) => trim(r.test_station_desc) === s.desc);
    if (hit) {
      if (hit.status !== 2 || hit.is_research !== s.is_research || hit.test_station_type_id !== typeId) {
        await api("PUT", `/api/settings/test-stations/${hit.test_station_id}`, {
          body: { test_station_type_id: typeId, test_station_desc: s.desc, status: 2, is_research: s.is_research },
        });
      }
      ref.stations.push({ id: hit.test_station_id, typeKey: s.type, typeId, desc: s.desc, is_research: s.is_research });
      continue;
    }
    const res = await api("POST", "/api/settings/test-stations", {
      body: { test_station_type_id: typeId, test_station_desc: s.desc, status: 2, is_research: s.is_research },
    });
    if (res.ok && res.json?.test_station_id) {
      ref.stations.push({ id: res.json.test_station_id, typeKey: s.type, typeId, desc: s.desc, is_research: s.is_research });
    }
  }

  // Stations this seeder did not create still attract work (findBestStation and
  // findBestResearchStation only skip status = 3), which would scatter the demo
  // dataset across leftover junk rows. Disable them through the real endpoint —
  // reversible, no deletes.
  if (!KEEP_FOREIGN_STATIONS) {
    const mine = new Set(ref.stations.map((s) => s.id));
    const after = (await api("GET", "/api/settings/test-stations")).json || [];
    for (const r of after) {
      if (mine.has(r.test_station_id)) continue;
      // Try to remove it outright first — the DELETE handler answers 409 when
      // anything still references the row, so this can never take a station
      // that carries history with it. Whatever survives is disabled instead.
      const del = await api("DELETE", `/api/settings/test-stations/${r.test_station_id}`, { expect: [200, 409, 404] });
      if (del.status === 200) {
        console.log(`  removed unused foreign station #${r.test_station_id} "${trim(r.test_station_desc)}"`);
        continue;
      }
      if (r.status === 3) { ref.disabledStations.add(r.test_station_id); continue; }
      const res = await api("PUT", `/api/settings/test-stations/${r.test_station_id}`, {
        body: {
          test_station_type_id: r.test_station_type_id, test_station_desc: trim(r.test_station_desc),
          status: 3, is_research: r.is_research,
        },
      });
      if (res.ok) {
        ref.disabledStations.add(r.test_station_id);
        console.log(`  disabled foreign station #${r.test_station_id} "${trim(r.test_station_desc)}"`);
      }
    }
  }

  // item types ------------------------------------------------------------
  const gotItemTypes = await api("GET", "/api/settings/item-types");
  const existingItemTypes = gotItemTypes.json || [];
  for (const t of ITEM_TYPES) {
    const hit = existingItemTypes.find((r) => trim(r.item_type_desc) === t.desc);
    let id = hit?.item_type_id;
    if (!id) {
      const res = await api("POST", "/api/settings/item-types", { body: { item_type_desc: t.desc } });
      id = res.json?.item_type_id;
    }
    if (!id) continue;
    const entry = { id, desc: t.desc, accessory: t.accessory, routes: {} };
    ref.itemTypes.push(entry);
    ref.byTypeDesc.set(t.desc, entry);
  }

  // testing routes --------------------------------------------------------
  const gotRoutes = await api("GET", "/api/settings/testing-routes");
  const existingRoutes = gotRoutes.json || [];
  for (const t of ITEM_TYPES) {
    const entry = ref.byTypeDesc.get(t.desc);
    if (!entry) continue;
    for (const [numStr, keys] of Object.entries(t.routes)) {
      const routeNumber = Number(numStr);
      const steps = keys.map((k) => ref.stationTypes.get(k)).filter(Boolean);
      if (steps.length !== keys.length) {
        finding("reference", "INCOMPLETE", { itemType: t.desc, routeNumber }, "one or more station types could not be resolved");
        continue;
      }
      const hit = existingRoutes.find((r) => r.item_type_id === entry.id && r.route_number === routeNumber);
      if (hit) {
        const same = JSON.stringify(hit.route_steps) === JSON.stringify(steps);
        if (!same) {
          await api("PUT", `/api/settings/testing-routes/${hit.test_route_id}`, {
            body: { item_type_id: entry.id, route_number: routeNumber, route_steps: steps },
          });
        }
        entry.routes[routeNumber] = steps;
        continue;
      }
      const res = await api("POST", "/api/settings/testing-routes", {
        body: { item_type_id: entry.id, route_number: routeNumber, route_steps: steps },
      });
      if (res.ok) entry.routes[routeNumber] = steps;
    }
  }

  ref.researchStations = ref.stations.filter((s) => s.is_research);
  console.log(`customers=${ref.customers.length} sources=${ref.sources.length} stationTypes=${ref.stationTypes.size} stations=${ref.stations.length} itemTypes=${ref.itemTypes.length}`);
  if (!ref.customers.length || !ref.stations.length || !ref.itemTypes.length) {
    throw new Error("reference data incomplete — see findings above");
  }
}

/** --skip-api path: rebuild `ref` from the DB instead of the settings API. */
async function loadReferenceFromDb() {
  console.log("\n=== phase A.1 — reference data (read from DB, --skip-api) ===");
  for (const c of CUSTOMERS) {
    const r = await q1("SELECT id FROM customers WHERE trim(customer_code) = $1", [c.customer_code]);
    if (r) ref.customers.push({ id: r.id, ...c });
  }
  for (const s of SOURCES) {
    const r = await q1("SELECT source_id FROM sources WHERE trim(source_desc) = $1", [s]);
    if (r) ref.sources.push({ id: r.source_id, desc: s });
  }
  for (const t of STATION_TYPES) {
    const r = await q1("SELECT test_station_type_id FROM test_stations_type WHERE trim(test_type_desc) = $1", [t.desc]);
    if (r) ref.stationTypes.set(t.key, r.test_station_type_id);
  }
  for (const r of await q("SELECT test_station_type_id, stale_after_minutes FROM test_stations_type")) {
    ref.staleByTypeId.set(Number(r.test_station_type_id), Number(r.stale_after_minutes));
  }
  for (const s of STATIONS) {
    const r = await q1("SELECT test_station_id FROM test_stations WHERE trim(test_station_desc) = $1", [s.desc]);
    if (r) ref.stations.push({ id: r.test_station_id, typeKey: s.type, typeId: ref.stationTypes.get(s.type), desc: s.desc, is_research: s.is_research });
  }
  for (const t of ITEM_TYPES) {
    const r = await q1("SELECT item_type_id FROM item_types WHERE trim(item_type_desc) = $1", [t.desc]);
    if (!r) continue;
    const entry = { id: r.item_type_id, desc: t.desc, accessory: t.accessory, routes: {} };
    for (const numStr of Object.keys(t.routes)) {
      const rr = await q1("SELECT route_steps FROM testing_routes WHERE item_type_id = $1 AND route_number = $2", [r.item_type_id, Number(numStr)]);
      if (rr) entry.routes[Number(numStr)] = rr.route_steps;
    }
    ref.itemTypes.push(entry);
    ref.byTypeDesc.set(t.desc, entry);
  }
  ref.researchStations = ref.stations.filter((s) => s.is_research);
  const shipRows = await q("SELECT id, customer_id, shipment_date FROM shipments ORDER BY shipment_date");
  ref.shipments = shipRows.map((r) => ({ id: r.id, customerId: r.customer_id, date: new Date(r.shipment_date) }));
  if (!ref.customers.length || !ref.stations.length || !ref.itemTypes.length || !ref.shipments.length) {
    throw new Error("--skip-api: reference data / shipments are not present in the DB — run once without --skip-api first");
  }
}

// ===========================================================================
// PHASE A.2 — work-hours template + calendar rebuild
// ===========================================================================
async function ensureWorkHours() {
  console.log("\n=== phase A.2 — work hours + calendar ===");
  const template = { isWorking: true, start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" };
  for (let wd = 0; wd <= 6; wd++) {
    const body = wd <= 4 ? template : { isWorking: false, start: null, end: null, breakStart: null, breakEnd: null };
    await api("PUT", `/api/settings/work-hours/defaults/${wd}`, { body, label: "PUT /api/settings/work-hours/defaults/:weekday" });
  }

  // A couple of single-date exceptions and a department holiday, so work_seconds
  // is not a flat weekly pattern. Dates are civil dates in Asia/Jerusalem, and
  // they are anchored to the PREVIOUS month on purpose: pinned to the current
  // one, a run on the 10th, 17th, 24th or 25th declared the SEED DAY itself a
  // non-working day. Every event phase A then records over HTTP falls outside
  // the calendar with work_seconds = 0, the live board sits on a holiday, and
  // phase B cannot place work in the last two days at all. They still have to
  // fall inside the history window to shape work_seconds, so the month before
  // is where they belong.
  const today = new Date();
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const y = prevMonth.getFullYear();
  const pm = pad(prevMonth.getMonth() + 1, 2);
  const overrides = [
    { date: `${y}-${pm}-10`, kind: "short_day", start: "07:00", end: "12:30", breakStart: null, breakEnd: null, note: "יום קצר לפני חג" },
    { date: `${y}-${pm}-17`, kind: "vacation", start: null, end: null, breakStart: null, breakEnd: null, note: "יום חופש מחלקתי" },
  ];
  // --reset TRUNCATEs transactional tables only; work-hours settings survive it.
  // Without a sweep, an override or holiday written by an EARLIER run (on the
  // dates that run computed) stays in the calendar forever and quietly keeps
  // shaping work_seconds. Clear this seeder's own rows through the real DELETE
  // endpoints, then write them fresh.
  const staleOverrides = (await api("GET", "/api/settings/work-hours/overrides?from=2024-01-01&to=2030-12-31")).json || [];
  for (const o of staleOverrides) {
    if (!SEEDED_NOTES.has(trim(o.note))) continue;
    await api("DELETE", `/api/settings/work-hours/overrides/${o.id}`, { expect: [200, 204, 404] });
  }
  for (const o of overrides) {
    // A locked national day / Saturday is rejected by design (validateOverride);
    // that is not a finding, so 400 is an accepted status here.
    await api("POST", "/api/settings/work-hours/overrides", { body: o, expect: [200, 201, 400] });
  }

  const types = (await api("GET", "/api/settings/work-hours/holiday-types")).json || [];
  const holidayType = types.find((t) => t.name === "חופשה מרוכזת") || types[0];
  const staleHolidays = (await api("GET", "/api/settings/work-hours/holidays")).json || [];
  for (const h of staleHolidays) {
    if (trim(h.name) !== SEEDED_HOLIDAY) continue;
    await api("DELETE", `/api/settings/work-hours/holidays/${h.id}`, { expect: [200, 204, 404] });
  }
  if (holidayType) {
    await api("POST", "/api/settings/work-hours/holidays", {
      body: {
        name: SEEDED_HOLIDAY, typeId: holidayType.id,
        startDate: `${y}-${pm}-24`, endDate: `${y}-${pm}-25`,
        isHalfDay: false, halfDayEndTime: null, note: "השבתת מחלקה",
      },
      expect: [200, 201, 400],
    });
  }

  // The work-hours routes fire the rebuild and forget. Force a synchronous one
  // so every interval folded from here on carries the SAME calendar_version —
  // otherwise metrics_selfcheck reports intervals_stale_calendar > 0. A
  // fire-and-forget rebuild started by the writes above may still hold the
  // advisory lock, in which case the endpoint healthily reports
  // "skipped_overlap" and has done nothing: retry until it actually runs.
  let rebuilt = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    rebuilt = await api("POST", "/api/cron/rebuild-work-calendar", { cron: true, body: {} });
    if (!rebuilt.ok || rebuilt.json?.status !== "skipped_overlap") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`  calendar: ${JSON.stringify(rebuilt?.json)}`);
  if (rebuilt?.json?.status === "skipped_overlap") {
    finding("POST /api/cron/rebuild-work-calendar", "SKIPPED", null,
      "the rebuild kept losing the advisory lock to the fire-and-forget rebuilds started by the work-hours writes");
  }
  const cal = await q1("SELECT calendar_version, horizon_from, horizon_to FROM work_calendar_version WHERE is_current");
  if (!cal) throw new Error("no current work_calendar_version — work_seconds would be NULL everywhere");
  const needFrom = new Date(Date.now() - (MONTHS + 1) * 31 * 86400000);
  if (new Date(cal.horizon_from) > needFrom) {
    finding("work_calendar", "SHORT HORIZON", { horizon_from: cal.horizon_from },
      `calendar starts after the requested history window (${jerusalemYmd(needFrom)}) — work_seconds would be NULL for the oldest months`);
  }
  const wd = await q1("SELECT EXISTS (SELECT 1 FROM work_span WHERE calendar_version = current_calendar_version() AND span @> now()) AS working");
  if (!wd?.working) {
    console.log("  NOTE: this instant is OUTSIDE working hours in the seeded calendar.");
    console.log("        Phase A records over HTTP with a server clock, so everything it");
    console.log("        writes now lands with work_seconds = 0 and no item can be left");
    console.log("        legitimately mid-test. Seed inside Sun-Thu 07:00-15:35 for a");
    console.log("        live board that exercises the two-clock metrics.");
  }
  console.log(`  calendar_version=${cal.calendar_version} horizon ${cal.horizon_from.toISOString?.().slice(0, 10) ?? cal.horizon_from} .. ${cal.horizon_to.toISOString?.().slice(0, 10) ?? cal.horizon_to}`);
}

// ===========================================================================
// PHASE A.3 — shipments (backdated through the real API)
// ===========================================================================
// shipment_date is a CLIENT-supplied field, so the whole 13-month spread of
// shipments can legitimately go through POST /api/shipments. Only ledger event
// time is server-owned.
async function createShipments() {
  console.log("\n=== phase A.3 — shipments ===");
  const now = new Date();
  for (let back = MONTHS - 1; back >= 0; back--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - back, 1);
    for (const c of ref.customers) {
      const perMonth = rint(1, 2);
      for (let k = 0; k < perMonth; k++) {
        const day = rint(1, 26);
        const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, rint(8, 14), rint(0, 59));
        if (date > now) continue;
        const recv = pick(STOREKEEPERS);
        const send = pick(WORKERS);
        const chosen = [];
        const n = rint(1, 3);
        for (let i = 0; i < n; i++) {
          const t = pick(ref.itemTypes.filter((x) => !x.accessory));
          if (!chosen.some((x) => x.item_type_id === t.id)) {
            chosen.push({ item_type_id: t.id, quantity: rint(2, 12), makat: `MK-${t.id}${rint(100, 999)}` });
          }
        }
        const code = `SH-${date.getFullYear()}${pad(date.getMonth() + 1, 2)}-${c.customer_code}-${pad(k + 1, 2)}`;
        const body = {
          shipment_code: code, customer_id: c.id, shipment_date: date.toISOString(),
          makat: chosen[0].makat, amount: chosen.reduce((a, x) => a + x.quantity, 0),
          recieving_worker_id: recv.id, recieving_worker_name: recv.name,
          sending_worker_id: send.id, sending_worker_name: send.name,
          source_id: pick(ref.sources)?.id ?? null,
          poc_details: `POC ${send.id}`, shipment_items: chosen,
        };
        const res = await api("POST", "/api/shipments", { body });
        if (res.ok && res.json?.id) ref.shipments.push({ id: res.json.id, customerId: c.id, date });
      }
    }
  }
  // Exercise the update path once (a corrected amount on the newest shipment).
  const last = ref.shipments[ref.shipments.length - 1];
  if (last) {
    const row = await q1("SELECT shipment_code, customer_id, shipment_date, amount, makat FROM shipments WHERE id = $1", [last.id]);
    if (row) {
      await api("PUT", `/api/shipments/${last.id}`, {
        body: {
          shipment_code: row.shipment_code, customer_id: row.customer_id,
          shipment_date: new Date(row.shipment_date).toISOString(), amount: row.amount + 1,
          makat: row.makat, shipment_items: [],
        },
      });
    }
  }
  console.log(`  shipments created: ${ref.shipments.length}`);
}

// ===========================================================================
// PHASE A.4 — the live window: real items walked over real HTTP
// ===========================================================================
const liveItems = [];      // every item created in phase A
const stalePending = [];   // items parked in-test on purpose, for the reaper

function makeItemBody(customer, shipment, typeEntry, routeNumber) {
  return {
    customer: customer.id, itemType: typeEntry.id, serialNumber: nextSerial("SN"),
    makat: `MK-${typeEntry.id}${rint(100, 999)}`, model: pick(MODELS),
    manufacturer: pick(MANUFACTURERS), manufacturerNo: `${rint(1000, 9999)}`,
    shipment: shipment.id, routeNumber,
  };
}

const reportedDisabled = new Set();
async function locate(itemId) {
  const res = await api("GET", `/api/testing/locate-by-barcode?barcode=${itemId}`, {
    label: "GET /api/testing/locate-by-barcode", expect: [200],
  });
  const j = res.ok ? res.json : null;
  // The barcode lookup picks a station with no status filter, unlike every
  // other assignment path (findBestStation / findBestResearchStation / the
  // results recommendation all require status <> 3). A DISABLED station handed
  // back here is then flipped to "in use" by start-test.
  if (j && j.stationId && ref.disabledStations.has(j.stationId) && !reportedDisabled.has(j.stationId)) {
    reportedDisabled.add(j.stationId);
    finding("GET /api/testing/locate-by-barcode", "DISABLED STATION", { itemId },
      `returned station #${j.stationId}, which is disabled (test_stations.status = 3); start-test then sets that station to status 1`);
  }
  return j;
}

async function queueRead(stationId, itemId) {
  const res = await api("GET", `/api/testing/items?stationId=${stationId}`, { label: "GET /api/testing/items" });
  if (!res.ok || !Array.isArray(res.json)) return null;
  return res.json.find((r) => Number(r.item_id) === Number(itemId)) || null;
}

async function startTest(itemId, stationId, worker) {
  return api("POST", "/api/testing/start-test", {
    body: { itemId, stationId, workerId: worker.id, workerName: worker.name, actionUuid: uuid() },
  });
}

async function releaseTest(itemId, stationId, worker) {
  return api("POST", "/api/testing/release-test", {
    body: { itemId, stationId, workerId: worker.id, workerName: worker.name, actionUuid: uuid() },
  });
}

/** One results submission. `extra` carries the branch flags (sendToResearch /
 *  returnToRoute / finishRoute) and, when a queue read was done, the client-side
 *  route fields; omitting those exercises the handler's resolve-from-DB path
 *  (the intake wizard's shape). */
async function submitResult(itemId, stationId, worker, extra = {}, qrow = null) {
  const passed = extra.passed ?? chance(0.86);
  const body = {
    ItemID: itemId, StationID: stationId, Result: passed ? 1 : 0, Passed: passed,
    Comments: passed ? pick(COMMENTS_PASS) : pick(COMMENTS_FAIL),
    WorkerID: worker.id, WorkerName: worker.name, SubmitID: uuid(),
    ...(extra.body || {}),
  };
  if (qrow) {
    body.CurrentRouteStep = qrow.current_route_step;
    body.RouteStepsLength = (qrow.route_steps || []).length;
    body.QueueStartTime = qrow.queue_start_time;
    body.ProcessingStartTime = qrow.processing_start_time ?? null;
    body.ItemTypeId = qrow.item_type_id;
    body.CreatedAt = qrow.created_at;
  }
  return api("POST", "/api/testing/results", { body });
}

/**
 * Walk one item through the real endpoints until its plan says stop.
 * Driven by the item's CURRENT status as the API reports it — the same way the
 * testing screen works — rather than by a script-side model of where it "should"
 * be, so a divergence shows up as a wrong branch instead of being papered over.
 */
async function walkItem(it, plan) {
  let guard = 0;
  while (guard++ < 40) {
    const loc = await locate(it.itemId);
    if (!loc) return "locate-failed";
    if (loc.finished) return "done";

    const status = loc.currentStatus;
    const stationId = loc.stationId;
    const worker = pick(WORKERS);

    // deliberate stop -> the item stays on the live board in this state
    if (plan.stopAt === status) return `in-flight:${status}`;

    if (status === 2) {
      // First contact with a station also does the queue read a worker's screen
      // does; later steps omit the route fields and exercise the resolve path.
      const qrow = it.readsDone++ === 0 ? await queueRead(stationId, it.itemId) : null;
      // Only park on a station type that opted into the reaper. Parking on a
      // never-reaped bench would leave the item stuck in status 1 for the rest
      // of the run — correctly, which is exactly why it must not be planned.
      if (plan.staleAtStep && !it.staleUsed && staleSecsForStation(stationId) > 0) {
        const r = await startTest(it.itemId, stationId, worker);
        if (!r.ok) return "start-failed";
        it.staleUsed = true;
        stalePending.push({ it, plan });
        return "parked-for-reaper";
      }
      const r = await startTest(it.itemId, stationId, worker);
      if (!r.ok) return "start-failed";
      // A queued item is started AND submitted in the same pass, so an item
      // meant to be left "in test" has to be dropped right here — by the next
      // iteration it would already be back in a queue.
      if (plan.stopAt === 1) return "in-flight:1";
      if (plan.releaseAtStep && !it.releaseUsed) {
        it.releaseUsed = true;
        await releaseTest(it.itemId, stationId, worker);
        continue;
      }
      const step = qrow?.current_route_step ?? null;
      const wantResearch = plan.researchAtStep && !it.researchUsed &&
        (step === null || step >= plan.researchAtStep);
      if (wantResearch) {
        it.researchUsed = true;
        await submitResult(it.itemId, stationId, worker, {
          passed: false, body: { sendToResearch: true, SentAt: new Date().toISOString() },
        }, qrow);
        continue;
      }
      await submitResult(it.itemId, stationId, worker, {}, qrow);
      continue;
    }

    if (status === 1) {
      // Reached only when a previous iteration left the item in test (a plan
      // stop lands here). Submit normally.
      await submitResult(it.itemId, stationId, worker, {});
      continue;
    }

    if (status === 4) {
      const r = await startTest(it.itemId, stationId, worker);
      if (!r.ok) return "start-research-failed";
      continue;
    }

    if (status === 5) {
      if (plan.staleInResearch && !it.staleResearchUsed) {
        it.staleResearchUsed = true;
        stalePending.push({ it, plan });
        return "parked-for-reaper-research";
      }
      for (let n = 0; n < plan.researchNotes; n++) {
        await submitResult(it.itemId, stationId, worker, {
          passed: false, body: { Comments: pick(RESEARCH_NOTES) },
        });
      }
      plan.researchNotes = 0;
      if (plan.researchFinish) {
        await submitResult(it.itemId, stationId, worker, { passed: false, body: { finishRoute: true } });
        return "done";
      }
      await submitResult(it.itemId, stationId, worker, {
        passed: true, body: { returnToRoute: true, ReturnAt: new Date().toISOString() },
      });
      continue;
    }

    if (status === 3) return "done";
    return `unexpected-status:${status}`;
  }
  return "guard-exhausted";
}

function makePlan(routeLen, opts = {}) {
  const plan = {
    researchAtStep: null, researchFinish: false, researchNotes: 0,
    releaseAtStep: null, staleAtStep: null, staleInResearch: false, stopAt: null,
  };
  if (opts.research || chance(0.14)) {
    plan.researchAtStep = rint(1, Math.max(1, routeLen - 1));
    plan.researchFinish = opts.researchFinish ?? chance(0.3);
    plan.researchNotes = rint(0, 2);
  }
  if (opts.release || chance(0.1)) plan.releaseAtStep = rint(1, routeLen);
  if (opts.stale || chance(0.08)) plan.staleAtStep = rint(1, routeLen);
  // A bench abandoned in RESEARCH: the reaper reverts 5 -> 4, not 1 -> 2, so it
  // is a distinct ledger shape (released_stale -> queued_research). Phase B's
  // multi-session research episodes emit it, and the parity check only accepts
  // shapes the live API has actually produced — so the live window has to
  // produce it at least once. It can ONLY exist when some research station type
  // carries stale_after_minutes > 0; when every research bench opts out (the
  // default this seeder ships, because a researcher legitimately keeps a unit
  // open for days) neither phase produces the shape and parity still holds.
  if (opts.researchStale && ref.researchStations.some((st) => isReapable(st.typeId))) {
    plan.researchAtStep = rint(1, Math.max(1, routeLen - 1));
    plan.researchNotes = rint(0, 1);
    plan.staleInResearch = true;
  }
  if (opts.stopAt) plan.stopAt = opts.stopAt;
  return plan;
}

async function phaseALive() {
  console.log("\n=== phase A.4 — live window (real HTTP walks) ===");
  const now = new Date();
  const monthShipments = ref.shipments.filter(
    (s) => s.date.getFullYear() === now.getFullYear() && s.date.getMonth() === now.getMonth(),
  );
  const shipPool = monthShipments.length ? monthShipments : ref.shipments;
  const mainTypes = ref.itemTypes.filter((t) => !t.accessory);
  const accTypes = ref.itemTypes.filter((t) => t.accessory);

  // A believable live board: most items finish, a slice is deliberately left in
  // every non-terminal state.
  const n = API_ITEMS;
  const FORCED_COUNT = 6;                    // see `forced` below — these walk to the end
  const stopPlan = [];
  for (let i = 0; i < n; i++) {
    const k = i - FORCED_COUNT;
    if (k < 0) stopPlan.push(null);
    else if (k < Math.round(n * 0.24)) stopPlan.push(2);        // waiting in a queue
    else if (k < Math.round(n * 0.34)) stopPlan.push(1);        // in test right now
    else if (k < Math.round(n * 0.44)) stopPlan.push(4);        // waiting for research
    else if (k < Math.round(n * 0.54)) stopPlan.push(5);        // in research right now
    else stopPlan.push(null);
  }

  // The first few items are FORCED through the rarer branches instead of being
  // left to the dice: every one of them is a distinct ledger shape, and the
  // history phase uses phase A's shapes as its template — a branch the live
  // window never takes has no template for the parity check to match against.
  const forced = [
    { research: true, researchFinish: true },   // research -> finishRoute
    { research: true, researchFinish: false },  // research -> returnToRoute
    { release: true },                          // user release
    { stale: true },                            // reaper (attempt_no > 1)
    {},                                         // accessories (see below)
    { researchStale: true },                    // reaper ON A RESEARCH BENCH
  ];

  for (let i = 0; i < n; i++) {
    const forceAccessories = i === 4;
    const typeEntry = forceAccessories
      ? (ref.byTypeDesc.get(ACCESSORY_PARENTS[0]) || pick(mainTypes))
      : pick(mainTypes);
    const routeNumbers = Object.keys(typeEntry.routes).map(Number);
    const routeNumber = pick(routeNumbers);
    const steps = typeEntry.routes[routeNumber];
    const ship = pick(shipPool);
    const customer = ref.customers.find((c) => c.id === ship.customerId) || pick(ref.customers);

    const wantsAccessories = ACCESSORY_PARENTS.includes(typeEntry.desc) && (forceAccessories || chance(0.55)) && accTypes.length > 0;
    const inlineSubs = [];
    if (wantsAccessories) {
      const k = rint(1, 2);
      for (let a = 0; a < k; a++) {
        const at = pick(accTypes);
        if (!at.routes[routeNumber]) continue;             // route variant must exist for the child
        inlineSubs.push({ ...makeItemBody(customer, ship, at, routeNumber), typeEntry: at });
      }
    }

    const body = makeItemBody(customer, ship, typeEntry, routeNumber);
    if (inlineSubs.length) body.subItems = inlineSubs.map(({ typeEntry: _t, ...rest }) => rest);
    const created = await api("POST", "/api/items", { body });
    if (!created.ok || !created.json?.itemId) continue;
    counters.apiItems++;

    const parent = {
      itemId: created.json.itemId, typeId: typeEntry.id, routeNumber, steps,
      readsDone: 0, accessory: false,
    };
    liveItems.push(parent);

    // children created inline by POST /api/items get their ids from the DB (the
    // endpoint returns only the parent's id) — this is the seeder reading back
    // what the system generated, not inventing ids.
    const kids = await q(
      "SELECT item_id, item_type_id FROM items WHERE parent_item_id = $1 ORDER BY item_id",
      [parent.itemId],
    );
    const accessories = kids.map((r) => {
      const te = ref.itemTypes.find((t) => t.id === r.item_type_id);
      counters.apiAccessories++;
      return {
        itemId: Number(r.item_id), typeId: r.item_type_id, routeNumber,
        steps: te?.routes[routeNumber] || [], readsDone: 0, accessory: true,
      };
    });

    // the "add a missing accessory" path — a separate endpoint from the wizard's
    // inline subItems, and worth exercising on its own.
    if (wantsAccessories && chance(0.35) && accTypes.length) {
      const at = pick(accTypes);
      if (at.routes[routeNumber]) {
        const res = await api("POST", "/api/testing/accessory", {
          body: {
            parentItemId: parent.itemId, itemType: at.id, serialNumber: nextSerial("ACC"),
            makat: `MK-${at.id}${rint(100, 999)}`, model: pick(MODELS),
            manufacturer: pick(MANUFACTURERS), manufacturerNo: `${rint(1000, 9999)}`,
          },
        });
        if (res.ok && res.json?.itemId) {
          counters.apiAccessories++;
          accessories.push({
            itemId: res.json.itemId, typeId: at.id, routeNumber,
            steps: at.routes[routeNumber], readsDone: 0, accessory: true,
          });
        }
      }
    }
    liveItems.push(...accessories);

    // The intake wizard: the parent is opened at the parents_only station and
    // every accessory's result is submitted from there WITHOUT a start-test —
    // the synthetic test_started/result_submitted pair (call site #15).
    const firstTypeIsWizard = steps[0] === ref.stationTypes.get("INT");
    if (accessories.length && firstTypeIsWizard) {
      const loc = await locate(parent.itemId);
      if (loc && !loc.finished && loc.currentStatus === 2) {
        const worker = pick(WORKERS);
        const qrow = await queueRead(loc.stationId, parent.itemId);
        parent.readsDone++;
        const st = await startTest(parent.itemId, loc.stationId, worker);
        if (st.ok) {
          for (const acc of accessories) {
            await submitResult(acc.itemId, loc.stationId, worker, {
              body: { Details: { wizard: { visual: "תקין", packaging: "שלמה", parent: parent.itemId } } },
            });
          }
          await submitResult(parent.itemId, loc.stationId, worker, {
            body: { Details: { wizard: { accessories: accessories.length } } },
          }, qrow);
        }
      }
    }

    // an item parked in 4/5 has to have been diverted to research first
    const stopNeedsResearch = stopPlan[i] === 4 || stopPlan[i] === 5;
    const plan = makePlan(steps.length, {
      stopAt: stopPlan[i], ...(forced[i] || {}), ...(stopNeedsResearch ? { research: true } : {}),
    });
    const outcome = await walkItem(parent, plan);
    for (const acc of accessories) {
      await walkItem(acc, makePlan(acc.steps.length, { stopAt: chance(0.25) ? 2 : null }));
    }
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${n} items walked (last: ${outcome})`);
  }
  console.log(`  live items: ${counters.apiItems} parents + ${counters.apiAccessories} accessories`);
}

// ---- the reaper ------------------------------------------------------------
// released_stale with attempt_no > 1 cannot happen inside a minutes-long run
// unless the clock moves. Backdate ONLY item_routes.processing_start_time for
// the parked items and let the real cron endpoint produce the events.
// The backdate is PER ROW, by that item's own station type threshold: a flat
// 45 minutes would reap a visual bench and silently miss a climate chamber
// (1440), and the count check below would then read as a bug in the endpoint.
// Rows whose type opted out (0) are skipped entirely — there is nothing to
// reap there, by design — so `upd.length` stays the honest expectation.
async function runReaper() {
  console.log("\n=== phase A.5 — stale-test reaper ===");
  if (!stalePending.length) { console.log("  nothing parked in test"); return; }
  const ids = stalePending.map((p) => String(p.it.itemId));
  const upd = await q(
    `UPDATE item_routes ir
        SET processing_start_time = NOW() - ((th.minutes + 15) * interval '1 minute')
       FROM (
         SELECT ir2.item_id,
                COALESCE(tt.stale_after_minutes, 30) AS minutes
           FROM item_routes ir2
           LEFT JOIN test_stations ts ON ts.test_station_id = ir2.test_station_id
           LEFT JOIN test_stations_type tt ON tt.test_station_type_id = ts.test_station_type_id
       ) th
      WHERE ir.item_id = th.item_id
        AND ir.item_id = ANY($1::bigint[])
        AND ir.current_status IN (1,5)
        AND ir.processing_start_time IS NOT NULL
        AND th.minutes > 0
      RETURNING ir.item_id`, [ids],
  );
  console.log(`  backdated processing_start_time on ${upd.length} row(s)`);
  const res = await api("POST", "/api/cron/release-stale-tests", { cron: true, body: {} });
  if (res.ok) {
    console.log(`  reaper: released=${res.json?.releasedCount} stationsFreed=${res.json?.stationsFreed}`);
    if (Number(res.json?.releasedCount || 0) !== upd.length) {
      finding("POST /api/cron/release-stale-tests", "COUNT MISMATCH",
        { backdated: upd.length }, JSON.stringify(res.json),
        "the reaper released a different number of items than were backdated");
    }
  }
  // carry the reaped items on to completion (a second pass through the queue)
  for (const p of stalePending) {
    p.plan.staleAtStep = null;
    p.plan.staleInResearch = false;
    await walkItem(p.it, p.plan);
  }
}

// ===========================================================================
// PHASE B — backdated history, written straight into the ledger
// ===========================================================================

/** The work_span ladder of the CURRENT calendar version, as absolute instants.
 *  Phase B never invents a working hour: it walks this. */
async function loadLadder() {
  const rows = await q(
    `SELECT lower(span) AS lo, upper(span) AS hi, span_seconds
       FROM work_span WHERE calendar_version = current_calendar_version()
      ORDER BY lower(span)`,
  );
  const spans = rows.map((r) => ({
    lo: new Date(r.lo).getTime() * 1000,
    hi: new Date(r.hi).getTime() * 1000,
    secs: r.span_seconds,
  }));
  // Running total of WORK microseconds before each span. With it the ladder can
  // be read in both directions: "what instant is X work-seconds after this one"
  // (addWork) and "what instant is X work-seconds BEFORE this one"
  // (latestStart). The backwards direction is what lets a walk be placed so it
  // ends exactly where it is wanted — at a chosen age on the live board, or
  // just before "now" — instead of being sampled and retried until it fits.
  let acc = 0;
  for (const s of spans) { s.cum = acc; acc += s.hi - s.lo; }
  return spans;
}

function spanIndexEndingAfter(ladder, us) {
  let lo = 0, hi = ladder.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ladder[mid].hi > us) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

/** Work microseconds elapsed from the start of the ladder to `us`. Non-working
 *  time contributes nothing, so this is the item's own clock. */
function workOffsetOf(ladder, us) {
  const i = spanIndexEndingAfter(ladder, us);
  if (i < 0) {
    const last = ladder[ladder.length - 1];
    return last.cum + (last.hi - last.lo);
  }
  return ladder[i].cum + Math.max(0, us - ladder[i].lo);
}

/** The inverse: the instant sitting `off` work microseconds into the ladder.
 *  null when `off` falls outside the calendar horizon. */
function instantAtWorkOffset(ladder, off) {
  if (off < 0) return null;
  let lo = 0, hi = ladder.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ladder[mid].cum <= off) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  const s = ladder[ans];
  const t = s.lo + (off - s.cum);
  if (t < s.hi) return t;
  return ans + 1 < ladder.length ? ladder[ans + 1].lo : null;
}

/** Advance `workSeconds` of WORKING time from `us`, landing strictly inside a
 *  work span. Nights, weekends and holidays are skipped, which is exactly what
 *  makes wall_seconds and work_seconds diverge. */
function addWork(ladder, us, workSeconds) {
  return instantAtWorkOffset(ladder, workOffsetOf(ladder, us) + Math.round(workSeconds * 1e6));
}

/** Run the clock BACKWARDS: the latest instant a walk of `workSeconds` can
 *  start from and still be over by `endUs`. */
function latestStart(ladder, endUs, workSeconds) {
  return instantAtWorkOffset(ladder, workOffsetOf(ladder, endUs) - Math.round(workSeconds * 1e6));
}

function randomWorkInstant(ladder, fromUs, toUs) {
  const first = spanIndexEndingAfter(ladder, fromUs);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < ladder.length && ladder[last + 1].lo < toUs) last++;
  if (last < first) return null;
  const i = rint(first, last);
  const lo = Math.max(ladder[i].lo, fromUs);
  const hi = Math.min(ladder[i].hi, toUs);
  if (hi - lo < 60e6) return lo;
  return lo + Math.floor(rnd() * (hi - lo - 60e6));
}

// Durations in WORK seconds. Heavy-tailed on purpose: a queue that always
// clears the same day makes wall_seconds == work_seconds and proves nothing.
const H = 3600;
function queueWait() {
  const r = rnd();
  if (r < 0.62) return rint(15 * 60, 4 * H);       // same working day
  if (r < 0.9) return rint(4 * H, 14 * H);         // 1-2 working days
  return rint(14 * H, 40 * H);                     // a week-ish
}
// NOT free parameters. Every duration below is WALL seconds and is bounded by
// /api/cron/release-stale-tests, which reverts an item that has sat in status
// 1/5 with no result for longer than ITS STATION TYPE'S stale_after_minutes
// (0 = that type is never auto-released) and which run_release_stale_tests.bat
// schedules every 5 minutes. That threshold used to be one hardcoded 30 for
// every bench, which is why no dataset this seeder produced could contain a
// test longer than ~35 minutes, a test that spans a night, or a research
// episode that was anything but a chain of short sessions. Reading the real
// column is what lets those shapes exist at all.

/** The endpoint's own fallback for a row whose station — hence type — is unknown. */
const DEFAULT_STALE_MINUTES = 30;
/** A station type's reaper threshold in WALL seconds. 0 means "never reaped". */
function staleSecsFor(typeId) {
  const m = ref.staleByTypeId.has(typeId) ? ref.staleByTypeId.get(typeId) : DEFAULT_STALE_MINUTES;
  return m * 60;
}
/** Same, for the station an item is standing at (phase A knows ids, not types). */
function staleSecsForStation(stationId) {
  const st = ref.stations.find((x) => x.id === stationId);
  return st ? staleSecsFor(st.typeId) : DEFAULT_STALE_MINUTES * 60;
}
const isReapable = (typeId) => staleSecsFor(typeId) > 0;

// How long one test actually takes, shaped by the bench it runs on:
//   * a 30-minute type (intake, visual) — minutes, never crossing a night;
//   * a few-hours type (functional) — mostly a normal bench session, with a
//     tail that uses the headroom and can run into the evening;
//   * a chamber-length or never-reaped type — an unattended run that
//     legitimately spans nights and weekends, the item sitting in the chamber
//     the whole time. That is the case the flat 30 made impossible.
function testDuration(typeId) {
  const cap = staleSecsFor(typeId);
  if (cap === 0) return rint(6 * H, 30 * H);
  if (cap <= 60 * 60) return rint(4 * 60, cap - 3 * 60);
  return chance(0.35) ? rint(40 * 60, cap - 10 * 60) : rint(6 * 60, 40 * 60);
}
// A user closing the dialog is a human act inside a bench session: it happens
// on a human timescale whatever headroom the type allows, and always before the
// reaper would have fired.
function releaseDuration(typeId) {
  const cap = staleSecsFor(typeId);
  const hi = cap === 0 ? 25 * 60 : Math.min(25 * 60, cap - 5 * 60);
  return rint(2 * 60, Math.max(3 * 60, hi));
}
/** run_release_stale_tests.bat is scheduled every 5 minutes — the reaper's
 *  worst-case detection latency, and therefore the only slack an occupied bench
 *  is allowed past its type's threshold. The consistency check at the end of the
 *  run asserts that bound, so both must read the same constant. */
const CRON_PERIOD_SECS = 5 * 60;
// How long an abandoned bench sits before the cron notices: that type's own
// threshold plus up to one cron period. Also WALL: the reaper compares
// processing_start_time to the real clock, so it fires at 15:50 for a bench
// abandoned at 15:20 even though the shift ended at 15:35. Only ever called for
// a type that is reapable at all.
const reaperDelay = (typeId) => staleSecsFor(typeId) + rint(30, CRON_PERIOD_SECS);
const researchWait = () => rint(2 * H, 20 * H);
// A research episode on a bench the reaper never touches is ONE long interval:
// the unit stays open on the bench across nights and weekends, which is what a
// multi-day investigation looks like on a real floor. When a research station
// type DOES carry a threshold, the same episode degrades into the chain of
// short sessions separated by released_stale that the flat 30 used to force on
// everything. Both shapes are generated — the data decides which.
function researchSession(typeId) {
  const cap = staleSecsFor(typeId);
  if (cap === 0) return rint(3 * H, 52 * H);
  return rint(4 * 60, Math.max(5 * 60, cap - 3 * 60));
}
/** How old an OPEN testing/in_research interval on the live board may be: just
 *  under the reaper's threshold for that station's type, or — when the type
 *  opts out of the reaper — a genuinely long occupancy. Anything older than the
 *  threshold could not still be sitting there; the cron would have taken it. */
function wipAgeCeiling(station, lo) {
  const cap = station ? staleSecsFor(station.typeId) : DEFAULT_STALE_MINUTES * 60;
  return cap === 0 ? 30 * H : Math.max(lo + 60, cap - 8 * 60);
}

/** Items do not trickle in evenly. They arrive with a shipment and are opened
 *  over the following working day or so, which is what gives per-day throughput
 *  its real shape — busy intake days and quiet ones — instead of the flat line
 *  a uniform sample over the month produces. */
function creationInstant(ladder, fromUs, toUs, ship) {
  if (toUs <= fromUs) return null;
  const shipUs = ship?.date ? ship.date.getTime() * 1000 : 0;
  if (shipUs >= fromUs && shipUs < toUs) {
    const spread = addWork(ladder, shipUs, rint(20 * 60, 9 * H));
    const hi = Math.min(toUs, spread === null ? toUs : spread);
    if (hi > shipUs) {
      const inst = randomWorkInstant(ladder, shipUs, hi);
      if (inst !== null && inst >= fromUs && inst < toUs) return inst;
    }
  }
  const fallback = randomWorkInstant(ladder, fromUs, toUs);
  return fallback !== null && fallback >= fromUs && fallback < toUs ? fallback : null;
}

// The item id is only known AFTER the plan's total work time has decided where
// the walk can start (the id embeds its creation date, exactly as
// create-item.ts builds it), while the event_keys embed the id. Plan with a
// token, substitute at write time.
const ITEM_ID_TOKEN = "@ITEM@";

/**
 * Build the full event plan for one history item, mirroring the exact shapes
 * phase A produced. Returns { events, totalWork, finalState } where each event
 * is the argument list of one item_state_event INSERT plus the legacy rows it
 * anchors.
 */
function planHistoryItem(ctx) {
  const { steps, stationsByType, researchStations, itemId, wizardFirst, isAccessory } = ctx;
  // `stop` leaves the item ON THE LIVE BOARD instead of walking it to done:
  // { state: 'queued' | 'testing' | 'queued_research' | 'in_research' }. The
  // walk is cut the moment it first enters that state, and the caller then
  // backdates the whole chain so the open interval has a real age.
  const stop = ctx.stop || null;
  const ev = [];
  const legacy = { history: [], results: [], research: [] };
  let work = 0;
  const stationTypeOf = (n) => steps[n - 1] ?? null;
  const stopHere = (state, s, station) =>
    ({ ev, legacy, work, finalStep: s, finalState: state, finalStation: station });

  // #1 item_created -> queued step 1
  ev.push({ dt: 0, key: `item_created:${itemId}`, kind: "transition", to: "queued", step: 1,
    station: null, stationType: stationTypeOf(1), worker: null, reason: "item_created", seq: 0, payload: {} });

  let step = 1;
  let finalStation = null;
  let researchDone = false;
  const needsResearch = stop && (stop.state === "queued_research" || stop.state === "in_research");
  const doResearch = needsResearch || (!isAccessory && chance(0.13));
  const researchStep = doResearch ? rint(1, Math.max(1, steps.length - 1)) : -1;
  // An item parked in a queue is parked at a random point along its route, not
  // always at step 1 — otherwise every waiting item on the board is brand new.
  const stopStep = stop ? rint(1, steps.length) : -1;
  if (stop && stop.state === "queued" && stopStep === 1) {
    const st1 = stationsByType.get(stationTypeOf(1)) || [];
    return stopHere("queued", 1, st1.length ? pick(st1) : null);
  }
  const doRelease = chance(0.09);
  const releaseStep = doRelease ? rint(1, steps.length) : -1;
  // A released_stale can only be planned on a step whose station type opted
  // into the reaper. On a route made only of never-reaped types there is no
  // such event to plan — and phase A obeys the same rule, so the structural
  // parity check still finds every history shape in the live template.
  const reapableSteps = steps.map((t, i) => (isReapable(t) ? i + 1 : 0)).filter(Boolean);
  const doStale = reapableSteps.length > 0 && chance(0.07);
  const staleStep = doStale ? pick(reapableSteps) : -1;
  let released = false, staled = false;

  let guard = 0;
  while (step <= steps.length && guard++ < 30) {
    const typeId = stationTypeOf(step);
    const stations = stationsByType.get(typeId) || [];
    if (!stations.length) break;
    const station = pick(stations);
    const worker = pick(WORKERS);
    finalStation = station;

    const wait = queueWait();
    work += wait;

    // The wizard pair: an accessory tested under its parent never goes through
    // start-test, so results/route.ts emits a synthetic test_started (seq 0) and
    // the submission shifts to seq 1 (call site #15).
    const wizardPair = isAccessory && wizardFirst && step === 1;
    const submitId = crypto.randomUUID();

    if (wizardPair) {
      ev.push({ dt: wait, key: `test_started:${submitId}:${itemId}:0`, kind: "transition", to: "testing",
        step, station: station.id, stationType: station.typeId, worker, reason: "test_started", seq: 0,
        payload: { synthetic_pair: true } });
    } else {
      ev.push({ dt: wait, key: `test_started:${crypto.randomUUID()}`, kind: "transition", to: "testing",
        step, station: station.id, stationType: station.typeId, worker, reason: "test_started", seq: 0, payload: {} });
    }
    // `room` tells the stamper how much UNBROKEN wall time this test needs. A
    // worker does not start a 25-minute test six minutes before the shift ends
    // — and if they did, the reaper would take it. The stamper pushes the start
    // to the next working morning instead, which simply lengthens the queue
    // wait in front of it.
    const startEv = ev[ev.length - 1];
    if (stop && stop.state === "testing" && step === stopStep) return stopHere("testing", step, station);

    if (step === releaseStep && !released) {
      released = true;
      const d = releaseDuration(station.typeId); work += d; startEv.room = d;
      ev.push({ dt: d, wallDt: true, key: `released_by_user:${crypto.randomUUID()}`, kind: "transition", to: "queued",
        step, station: null, stationType: station.typeId, worker, reason: "released_by_user", seq: 0, payload: {} });
      continue;
    }
    if (step === staleStep && !staled) {
      staled = true;
      const d = reaperDelay(station.typeId); work += d;
      ev.push({ dt: d, wallDt: true, kind: "transition", to: "queued", step, station: null, stationType: null,
        worker: null, reason: "released_stale", seq: 0, payload: {}, staleKey: true });
      continue;
    }

    const dur = testDuration(station.typeId); work += dur; startEv.room = dur;
    // A run longer than half a working day ends unattended, often at night. The
    // RESULT is still typed in by a person, so the closing event snaps into the
    // next working hours instead of landing at 03:00.
    const longRun = dur > 4 * H;
    // ...but only as far as the bench's own threshold still allows. The snap is
    // WALL time added after the run itself, and the reaper measures WALL time
    // from processing_start_time: a result typed in later than
    // stale_after_minutes describes a state production can never reach, because
    // the cron would have reverted the item and freed the station first. null =
    // this type opts out of the reaper (0), so nothing bounds its snap.
    const runCap = staleSecsFor(station.typeId);
    const snapCap = runCap === 0 ? null : Math.max(0, runCap - dur);

    if (step === researchStep && !researchDone) {
      researchDone = true;
      ev.push({ dt: dur, wallDt: true, snapWork: longRun, snapCap, key: `sent_to_research:${submitId}:${itemId}:0`, kind: "transition", to: "queued_research",
        step, station: null, stationType: null, worker, reason: "sent_to_research", seq: 0, payload: {},
        anchor: "research_out" });
      const resStation = pick(researchStations);
      ev.push({ dt: 0, key: `station_reassigned:${submitId}:${itemId}:3`, kind: "note", to: null,
        step, station: resStation.id, stationType: null, worker, reason: "station_reassigned", seq: 3,
        payload: { station_id: resStation.id, site: "find_best_research_station" }, us1: true });
      ev.push({ dt: 0, key: `station_reassigned:${submitId}:${itemId}:2`, kind: "note", to: null,
        step, station: resStation.id, stationType: resStation.typeId, worker, reason: "station_reassigned", seq: 2,
        payload: { station_id: resStation.id, site: "research_load_balancing" }, us1: true });

      finalStation = resStation;
      if (stop && stop.state === "queued_research") return stopHere("queued_research", step, resStation);

      // The research episode: 1-4 short sessions. Each begins with a real
      // start-test (queued_research -> in_research), lasts LESS than the 30
      // minutes the reaper allows, and ends either with the researcher's
      // submission or — when the bench is abandoned — with the cron's
      // released_stale, which drops the item back into queued_research to wait
      // for the next session. That is the only way a multi-day research episode
      // can actually look in this system.
      // Sessions only chain when the research bench is reapable: the chain
      // exists BECAUSE the cron keeps taking the item back. A bench with
      // stale_after_minutes = 0 holds the unit for the whole episode.
      const resReapable = isReapable(resStation.typeId);
      const sessions = resReapable ? 1 + (chance(0.45) ? rint(1, 3) : 0) : 1;
      for (let sIdx = 0; sIdx < sessions; sIdx++) {
        const gap = researchWait(); work += gap;
        ev.push({ dt: gap, key: `test_started:${crypto.randomUUID()}`, kind: "transition", to: "in_research",
          step, station: resStation.id, stationType: resStation.typeId, worker, reason: "test_started", seq: 0, payload: {} });
        const sessionStartEv = ev[ev.length - 1];
        if (stop && stop.state === "in_research") return stopHere("in_research", step, resStation);

        const last = sIdx === sessions - 1;
        let spent = 0;
        if (chance(0.55)) {
          const nd = resReapable ? rint(3 * 60, 12 * 60) : rint(20 * 60, 4 * H); spent += nd; work += nd;
          const nsid = crypto.randomUUID();
          ev.push({ dt: nd, wallDt: true, key: `research_note:${nsid}:${itemId}`, kind: "note", to: null, step,
            station: resStation.id, stationType: resStation.typeId, worker, reason: "research_note", seq: 0,
            payload: {}, anchor: "research_note", researchStation: resStation });
        }
        if (!last) {
          // abandoned bench -> the reaper takes it back to queued_research
          const d = Math.max(60, reaperDelay(resStation.typeId) - spent); work += d;
          ev.push({ dt: d, wallDt: true, kind: "transition", to: "queued_research", step, station: null, stationType: null,
            worker: null, reason: "released_stale", seq: 0, payload: {}, staleKey: true });
          continue;
        }
        const rd = Math.max(60, researchSession(resStation.typeId) - spent); work += rd;
        sessionStartEv.room = spent + rd;
        const longSession = spent + rd > 4 * H;
        // Same budget as a bench run: the whole session — notes included — has
        // already spent `spent + rd` of this research type's threshold.
        const sessCap = staleSecsFor(resStation.typeId);
        const sessSnapCap = sessCap === 0 ? null : Math.max(0, sessCap - (spent + rd));
        const sid2 = crypto.randomUUID();
        if (chance(0.3)) {
          ev.push({ dt: rd, wallDt: true, snapWork: longSession, snapCap: sessSnapCap, key: `result_submitted:${sid2}:${itemId}:0`, kind: "transition", to: "done",
            step, station: resStation.id, stationType: resStation.typeId, worker, reason: "result_submitted", seq: 0,
            payload: {}, anchor: "research_finish", researchStation: resStation });
          return { ev, legacy, work, finalStep: step, finalState: "done", finalStation: resStation };
        }
        ev.push({ dt: rd, wallDt: true, snapWork: longSession, snapCap: sessSnapCap, key: `returned_to_route:${sid2}:${itemId}:0`, kind: "transition", to: "queued",
          step, station: null, stationType: null, worker, reason: "returned_to_route", seq: 0, payload: {},
          anchor: "research_return", researchStation: resStation });
      }
      finalStation = null;
      continue;
    }

    // normal submission
    const seqOffset = wizardPair ? 1 : 0;
    const last = step === steps.length;
    ev.push({ dt: dur, wallDt: true, snapWork: longRun, snapCap, key: `result_submitted:${submitId}:${itemId}:${seqOffset}`, kind: "transition", to: "queued",
      step: step + 1, station: null, stationType: null, worker, reason: "result_submitted", seq: seqOffset,
      payload: {}, anchor: last ? null : "submit", submitStation: station });
    if (!last) {
      // A normal advance emits TWO station_reassigned notes, exactly as
      // results/route.ts does: the in-transaction step assignment (:235, seq 2,
      // no station_type_id) and then the load-balancing pick (:545, seq 3, with
      // the type) which may land on a different station and overwrite it.
      const nextStations = stationsByType.get(stationTypeOf(step + 1)) || [];
      const ns = nextStations.length ? pick(nextStations) : null;
      if (ns) {
        ev.push({ dt: 0, key: `station_reassigned:${submitId}:${itemId}:2`, kind: "note", to: null,
          step: step + 1, station: ns.id, stationType: null, worker, reason: "station_reassigned", seq: 2,
          payload: { station_id: ns.id, site: "route_step_assignment" }, us1: true });
        const ns2 = pick(nextStations);
        ev.push({ dt: 0, key: `station_reassigned:${submitId}:${itemId}:3`, kind: "note", to: null,
          step: step + 1, station: ns2.id, stationType: ns2.typeId, worker, reason: "station_reassigned", seq: 3,
          payload: { station_id: ns2.id, site: "next_station_load_balancing" }, us1: true });
        finalStation = ns2;
      }
      step++;
      if (stop && stop.state === "queued" && step === stopStep) return stopHere("queued", step, finalStation);
      continue;
    }
    // last step: the queued(step n+1) and done events land in ONE transaction,
    // 1µs apart — exactly what metrics_record's clamp produces live.
    ev.push({ dt: 0, key: `result_submitted:${submitId}:${itemId}:${1 + seqOffset}`, kind: "transition", to: "done",
      step: step + 1, station: station.id, stationType: station.typeId, worker, reason: "result_submitted",
      seq: 1 + seqOffset, payload: {}, us1: true, anchor: "submit_final", submitStation: station });
    return { ev, legacy, work, finalStep: step + 1, finalState: "done", finalStation: station };
  }
  return { ev, legacy, work, finalStep: step, finalState: "open", finalStation };
}

const STATE_TO_STATUS = { queued: 2, testing: 1, done: 3, queued_research: 4, in_research: 5 };

async function phaseBHistory() {
  console.log("\n=== phase B — backdated history (DB-direct, folded by the trigger) ===");
  const ladder = await loadLadder();
  if (!ladder.length) throw new Error("work_span is empty for the current calendar version");
  console.log(`  ladder: ${ladder.length} work spans, ${new Date(ladder[0].lo / 1000).toISOString().slice(0, 10)} .. ${new Date(ladder[ladder.length - 1].hi / 1000).toISOString().slice(0, 10)}`);

  const stationsByType = new Map();
  for (const s of ref.stations) {
    if (s.is_research) continue;
    if (!stationsByType.has(s.typeId)) stationsByType.set(s.typeId, []);
    stationsByType.get(s.typeId).push(s);
  }
  const researchStations = ref.researchStations.length ? ref.researchStations : ref.stations.slice(0, 1);
  const mainTypes = ref.itemTypes.filter((t) => !t.accessory);
  const accTypes = ref.itemTypes.filter((t) => t.accessory);
  const intTypeId = ref.stationTypes.get("INT");

  const now = new Date();
  // History runs right up to ~20 minutes ago. Stopping it at the start of the
  // current month (as this used to) left a hole between the last history month
  // and the seed run itself: weeks with zero throughput, then every phase-A
  // interval closing on one impossible day. Phase A owns the last few minutes;
  // phase B owns everything before them, month boundaries included.
  const historyEndUs = now.getTime() * 1000 - 20 * 60 * 1e6;
  // per-date item counter, mirroring daily_counters in create-item.ts. SEEDED
  // FROM daily_counters, because phase A's real POST /api/items already handed
  // out ids for today — a fresh counter would rebuild ids that already exist.
  const dayCounter = new Map();
  // date_key::text is load-bearing: the column is a DATE, so node-pg hands back
  // a Date object, and a Map keyed by Date objects never matches the
  // "YYYY-MM-DD" strings nextItemId builds. Without the cast the counter for
  // TODAY silently restarts at 1 and rebuilds ids phase A already inserted —
  // a duplicate key on items_pkey, and only for items placed on the seed day.
  for (const r of await q("SELECT date_key::text AS date_key, counter FROM daily_counters")) {
    dayCounter.set(r.date_key, Number(r.counter));
  }
  for (const r of await q("SELECT item_id FROM items")) issuedItemIds.add(Number(r.item_id));

  const client = await pool.connect();
  try {
    for (let back = MONTHS - 1; back >= 0; back--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      const createTo = Math.min(mEnd.getTime() * 1000, historyEndUs);
      if (createTo <= mStart.getTime() * 1000) continue;
      const monthShipments = ref.shipments.filter(
        (s) => s.date >= mStart && s.date < mEnd,
      );
      const shipPool = monthShipments.length ? monthShipments : ref.shipments.filter((s) => s.date < mEnd);
      if (!shipPool.length) { console.log(`  month -${back}: no shipment to attach to, skipped`); continue; }

      let made = 0;
      for (let i = 0; i < ITEMS_PER_MONTH; i++) {
        const typeEntry = pick(mainTypes);
        const routeNumber = pick(Object.keys(typeEntry.routes).map(Number));
        const steps = typeEntry.routes[routeNumber];
        if (!steps || !steps.length) continue;
        const ship = pick(shipPool);
        const customer = ref.customers.find((c) => c.id === ship.customerId) || pick(ref.customers);

        const wizardFirst = steps[0] === intTypeId;
        const accessorySpecs = [];
        if (ACCESSORY_PARENTS.includes(typeEntry.desc) && wizardFirst && chance(0.45)) {
          const k = rint(1, 2);
          for (let a = 0; a < k; a++) {
            const at = pick(accTypes);
            if (at.routes[routeNumber]) accessorySpecs.push(at);
          }
        }

        try {
          await client.query("BEGIN");
          const parentPlan = planHistoryItem({
            steps, stationsByType, researchStations, itemId: ITEM_ID_TOKEN, wizardFirst, isAccessory: false,
          });
          // Place the creation instant so the whole walk is over by historyEndUs.
          // Running the calendar backwards gives the last instant that can work,
          // so the walk is placed rather than sampled-and-retried.
          const winFrom = Math.max(mStart.getTime() * 1000, ladder[0].lo);
          const latest = latestStart(ladder, createTo, parentPlan.work);
          const winTo = latest === null ? null : Math.min(createTo, latest);
          const t0 = winTo === null || winTo <= winFrom ? null : creationInstant(ladder, winFrom, winTo, ship);
          if (t0 === null) { await client.query("ROLLBACK"); counters.skippedItems++; continue; }

          const parentId = nextItemId(customer.id, t0, dayCounter);
          const parent = await writeHistoryItem(client, {
            ladder, t0, itemId: parentId, customer, ship, typeEntry, routeNumber, steps,
            plan: parentPlan, parentItemId: null, stationsByType, maxAt: historyEndUs,
          });
          counters.histItems++;
          made++;

          for (const at of accessorySpecs) {
            const aSteps = at.routes[routeNumber];
            const aPlan = planHistoryItem({
              steps: aSteps, stationsByType, researchStations, itemId: ITEM_ID_TOKEN,
              wizardFirst: aSteps[0] === intTypeId, isAccessory: true,
            });
            const aStart = addWork(ladder, t0, rint(60, 900));
            if (aStart === null) continue;
            const aEnd = addWork(ladder, aStart, aPlan.work);
            if (aEnd === null || aEnd >= historyEndUs) continue;
            const accId = nextItemId(customer.id, aStart, dayCounter);
            await writeHistoryItem(client, {
              ladder, t0: aStart, itemId: accId, customer, ship, typeEntry: at, routeNumber,
              steps: aSteps, plan: aPlan, parentItemId: parentId.id, stationsByType, maxAt: historyEndUs,
            });
            counters.histAccessories++;
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          // "overran its window" is the placement giving up, not the ledger
          // rejecting anything — it is a skip, not a system finding.
          if (!/overran its window/.test(e.message)) {
            finding("DB phase B", "INSERT FAILED", { month: `-${back}` }, e.message);
          }
          counters.skippedItems++;
        }
      }
      console.log(`  month -${back} (${jerusalemYmd(mStart)}): ${made} items`);
    }

    // ---- aged work in progress -------------------------------------------
    // Everything phase A leaves on the board entered its state minutes ago,
    // because the server stamps the clock. A live board where the oldest item
    // has been waiting four minutes cannot exercise a single ageing metric —
    // "oldest in queue", WIP age buckets, SLA breaches all read zero. These
    // items are walked normally and then CUT the moment they enter their
    // current state, with the whole chain backdated so the open interval has a
    // real age behind it.
    const wipSpec = [
      { state: "queued", n: Math.max(4, Math.round(ITEMS_PER_MONTH * 0.24)), lo: 1 * H, hi: 42 * H },
      { state: "queued_research", n: 3, lo: 2 * H, hi: 20 * H },
      // Measured on the WALL clock — that is the clock the reaper compares
      // against, so an item whose "26 working minutes" span a night would in
      // reality have been released hours ago. `hi` is resolved per item from
      // the station type the walk actually stopped on (wipAgeCeiling): an item
      // in a climate chamber may legitimately have been in test since
      // yesterday; an item on a 30-minute visual bench may not.
      { state: "testing", n: 3, lo: 3 * 60, hi: null, wall: true },
      { state: "in_research", n: 2, lo: 3 * 60, hi: null, wall: true },
    ];
    let wipMade = 0;
    const busyStations = new Set();
    for (const spec of wipSpec) {
      for (let i = 0; i < spec.n; i++) {
        const typeEntry = pick(mainTypes);
        const routeNumber = pick(Object.keys(typeEntry.routes).map(Number));
        const steps = typeEntry.routes[routeNumber];
        if (!steps || !steps.length) continue;
        const ship = pick(ref.shipments);
        if (!ship) continue;
        const customer = ref.customers.find((c) => c.id === ship.customerId) || pick(ref.customers);
        try {
          await client.query("BEGIN");
          const plan = planHistoryItem({
            steps, stationsByType, researchStations, itemId: ITEM_ID_TOKEN,
            wizardFirst: steps[0] === intTypeId, isAccessory: false, stop: { state: spec.state },
          });
          if (plan.finalState !== spec.state) { await client.query("ROLLBACK"); continue; }
          // age -> where the LAST event must land -> where the walk must start
          const age = rint(spec.lo, spec.hi ?? wipAgeCeiling(plan.finalStation, spec.lo));
          let enteredAt;
          if (spec.wall) {
            // measured from NOW, not historyEndUs: the reaper counts its
            // threshold from the real clock, and historyEndUs is 20 min behind it
            enteredAt = now.getTime() * 1000 - age * 1e6;
            // Only meaningful if that instant is inside working hours; when the
            // seed run happens outside them there is no such item to model.
            const si = spanIndexEndingAfter(ladder, enteredAt);
            if (si < 0 || ladder[si].lo > enteredAt) { await client.query("ROLLBACK"); continue; }
          } else {
            enteredAt = latestStart(ladder, historyEndUs, age);
          }
          const t0 = enteredAt === null ? null : latestStart(ladder, enteredAt, plan.work);
          if (t0 === null || t0 < ladder[0].lo) { await client.query("ROLLBACK"); counters.skippedItems++; continue; }
          const wid = nextItemId(customer.id, t0, dayCounter);
          await writeHistoryItem(client, {
            ladder, t0, itemId: wid, customer, ship, typeEntry, routeNumber, steps,
            plan, parentItemId: null, stationsByType, maxAt: now.getTime() * 1000,
          });
          if (plan.finalStation && (spec.state === "testing" || spec.state === "in_research")) {
            busyStations.add(plan.finalStation.id);
          }
          await client.query("COMMIT");
          counters.histItems++;
          wipMade++;
        } catch (e) {
          await client.query("ROLLBACK");
          if (!/overran its window/.test(e.message)) {
            finding("DB phase B (wip)", "INSERT FAILED", { state: spec.state }, e.message);
          }
        }
      }
    }
    // A bench holding an item is not free. start-test sets the station to 1;
    // these items never went through start-test, so say so here.
    if (busyStations.size) {
      await client.query("UPDATE test_stations SET status = 1 WHERE test_station_id = ANY($1::int[])",
        [[...busyStations]]);
    }
    console.log(`  aged work in progress: ${wipMade} items left on the board with real ageing behind them`);
  } finally {
    client.release();
  }
  console.log(`  history: ${counters.histItems} parents + ${counters.histAccessories} accessories, ${counters.histEvents} events`
    + (counters.skippedItems ? `  (${counters.skippedItems} skipped — no room left in the month)` : ""));
}

/** item id exactly as create-item.ts builds it: [customer(3)][ddMMyy][counter].
 *  parseInt() drops the leading zeros of the customer segment, so the mapping is
 *  not injective — issued ids are tracked and the counter advanced until the id
 *  is genuinely free, rather than letting items_pkey decide. */
const issuedItemIds = new Set();
function nextItemId(customerId, us, dayCounter) {
  const d = new Date(us / 1000);
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  const dateStr = `${pad(d.getDate(), 2)}${pad(d.getMonth() + 1, 2)}${String(d.getFullYear()).slice(-2)}`;
  for (;;) {
    const c = (dayCounter.get(key) || 0) + 1;
    dayCounter.set(key, c);
    const id = parseInt(`${pad(customerId, 3)}${dateStr}${c}`, 10);
    if (issuedItemIds.has(id)) continue;
    issuedItemIds.add(id);
    return { id, dateKey: key, counter: c };
  }
}

/** Write one history item: items + item_routes + route_run + the event chain +
 *  the legacy rows. Runs inside the caller's transaction, so the DEFERRED drift
 *  trigger sees the final, consistent state at COMMIT. */
async function writeHistoryItem(client, a) {
  const { ladder, t0, itemId, customer, ship, typeEntry, routeNumber, steps, plan, parentItemId } = a;
  const id = itemId.id;

  await client.query(
    `INSERT INTO daily_counters (date_key, counter) VALUES ($1, $2)
       ON CONFLICT (date_key) DO UPDATE SET counter = GREATEST(daily_counters.counter, EXCLUDED.counter)`,
    [itemId.dateKey, itemId.counter],
  );

  const serial = nextSerial(parentItemId ? "ACC" : "SN");
  await client.query(
    `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model,
                        manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, customer.id, typeEntry.id, serial, `MK-${typeEntry.id}${rint(100, 999)}`,
      pick(MODELS), pick(MANUFACTURERS), String(rint(1000, 9999)), ship.id, parentItemId],
  );

  // Absolute timestamps for the planned events. Two clocks, deliberately:
  //   e.dt WORK seconds  — queue waits, which run through nights and weekends
  //                        and are what make wall_seconds and work_seconds
  //                        diverge (§2.8).
  //   e.wallDt           — everything bounded by the stale-test reaper, which
  //                        compares processing_start_time to the REAL clock.
  //                        Advancing those on the work ladder would produce
  //                        `testing` intervals spanning a night, which the cron
  //                        would have force-released hours earlier.
  let cursor = t0;
  const stamped = [];
  for (const e of plan.ev) {
    if (e.us1) {
      cursor = cursor + 1;                       // same transaction, +1µs (the clamp)
    } else if (e.dt > 0) {
      if (e.wallDt) {
        cursor = cursor + Math.round(e.dt * 1e6);
      } else {
        const next = addWork(ladder, cursor, e.dt);
        if (next === null) break;
        cursor = next;
      }
    }
    // An unattended run ends whenever it ends — often at 03:00 — but the RESULT
    // is typed in by a person. Snap the closing event of such a run forward to
    // the next working hours, so the dataset does not claim submissions at
    // night. (Only long runs carry the flag; the reaper's own released_stale
    // events deliberately do NOT, because the cron really does fire at 3am.)
    // The snap is bounded by e.snapCap — the WALL seconds of this bench's
    // stale_after_minutes the run has not already eaten (null on a type that
    // opts out of the reaper, where the snap is free). Snapping further would
    // date the submission after the moment the cron would have reverted the
    // item and freed the station, which is a row the system cannot produce; a
    // chamber whose next shift is a weekend away really did get its result
    // typed in at 03:00.
    if (e.snapWork) {
      const si = spanIndexEndingAfter(ladder, cursor);
      if (si < 0) break;
      const snapped = Math.max(cursor, ladder[si].lo);
      if (e.snapCap == null || snapped - cursor <= e.snapCap * 1e6) cursor = snapped;
    }
    // A bench needs `room` minutes of unbroken shift in front of it. If the
    // shift ends first, the work does not start today.
    if (e.room) {
      const si = spanIndexEndingAfter(ladder, cursor);
      if (si < 0) break;
      const start = Math.max(cursor, ladder[si].lo);
      const need = Math.round(e.room * 1e6);
      if (need > ladder[si].hi - ladder[si].lo) {
        // Longer than the whole shift: a chamber burn-in, or a research bench
        // holding a unit for days. There is no shift that could contain it, so
        // waiting for one would push the walk forward forever. The bench is
        // occupied through the night ON PURPOSE — the station type says the
        // reaper will not touch it — so the run simply starts when work does.
        cursor = start;
      } else if (start + need > ladder[si].hi) {
        if (si + 1 >= ladder.length) break;
        cursor = ladder[si + 1].lo + rint(0, 20 * 60) * 1e6;
      } else {
        cursor = start;
      }
    }
    stamped.push({ ...e, at: cursor });
  }
  if (!stamped.length) throw new Error("no events planned");
  // The room adjustment can push a walk past the deadline the caller placed it
  // against. Refuse rather than write an event in the future.
  if (a.maxAt && stamped[stamped.length - 1].at > a.maxAt) throw new Error("walk overran its window");

  const openedAt = usToIso(stamped[0].at);
  const runRows = await client.query(
    `INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                            opened_at, customer_id, shipment_id, parent_item_id, unit_id,
                            is_accessory, serial_no, is_trusted)
     VALUES ($1, 1, $2, $3, $4::int[], md5($4::int[]::text), $5::timestamptz,
             $6, $7, $8, $9, $10, $11, true)
     RETURNING route_run_id`,
    [id, routeNumber, typeEntry.id, steps, openedAt, customer.id, ship.id,
      parentItemId, parentItemId ?? id, parentItemId !== null, serial],
  );
  const runId = runRows.rows[0].route_run_id;

  // item_routes must exist before the events for the drift trigger to have
  // something to compare at COMMIT; it is written at its FINAL state directly
  // (nothing in the fold reads it).
  const finalStatus = plan.finalState === "done" ? 3 : STATE_TO_STATUS[plan.finalState] || 2;
  const lastAt = stamped[stamped.length - 1].at;
  const finalStationId = plan.finalStation ? plan.finalStation.id : null;
  // The two legacy clocks the floor screens and the reaper read. An item left
  // in 1/5 with a NULL processing_start_time is invisible to
  // /api/cron/release-stale-tests and shows no elapsed time on the tester's
  // screen — so they are derived from the event chain, not left null.
  let qStartAt = stamped[0].at, pStartAt = null;
  for (const e of stamped) {
    if (e.to === "queued" || e.to === "queued_research") { qStartAt = e.at; pStartAt = null; }
    if (e.reason === "test_started") pStartAt = e.at;
  }
  const inTest = finalStatus === 1 || finalStatus === 5;
  await client.query(
    `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id,
                              created_at, finished_at, is_finished, queue_start_time, processing_start_time, route_number)
     VALUES ($1,$2,$3,$4,$5,
             $6::timestamptz AT TIME ZONE 'UTC',
             $7::timestamptz AT TIME ZONE 'UTC', $8,
             $9::timestamptz AT TIME ZONE 'UTC',
             $10::timestamptz AT TIME ZONE 'UTC', $11)`,
    [id, typeEntry.id, finalStatus, plan.finalStep, finalStationId,
      openedAt, finalStatus === 3 ? usToIso(lastAt) : null, finalStatus === 3,
      usToIso(qStartAt), inTest && pStartAt ? usToIso(pStartAt) : null, routeNumber],
  );

  // ---- the event chain. One INSERT each, in chronological order: the AFTER
  // INSERT trigger folds every row into item_state_interval as it lands, and
  // the EXCLUDE constraint aborts the whole item if the order is ever wrong.
  let queueStart = null, processingStart = null;
  for (const e of stamped) {
    const key = e.staleKey
      ? `released_stale:${id}:${new Date(e.at / 1000).toISOString().slice(0, 16).replace(/[-T:]/g, "")}`
      : e.key.split(ITEM_ID_TOKEN).join(String(id));
    const row = await client.query(
      `INSERT INTO item_state_event
         (event_key, route_run_id, item_id, occurred_at, recorded_at, seq, kind, to_state, step_no,
          station_id, station_type_id, worker_id, worker_name, reason, submit_id, is_trusted, payload)
       VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15::jsonb)
       RETURNING event_id`,
      [key, runId, id, usToIso(e.at), e.seq, e.kind, e.to, e.step,
        e.station, e.stationType, e.worker?.id ?? null, e.worker?.name ?? null, e.reason,
        submitIdOf(key), JSON.stringify(e.payload || {})],
    );
    counters.histEvents++;
    const eventId = row.rows[0].event_id;

    // ---- the legacy rows the stage-5 parity harness reads --------------
    if (e.reason === "test_started") { processingStart = e.at; }
    if (e.to === "queued" || e.to === "queued_research") { queueStart = e.at; }

    if (e.anchor === "submit" || e.anchor === "submit_final" || e.anchor === "research_finish" || e.anchor === "research_return") {
      const station = e.submitStation || e.researchStation || plan.finalStation;
      const stepForRow = e.anchor === "submit" || e.anchor === "submit_final" ? e.step - 1 : e.step;
      await client.query(
        `INSERT INTO item_route_history (item_id, test_station_id, current_route_step,
             queue_start_time, processing_start_time, processing_end_time, worker_id, route_number)
         VALUES ($1,$2,$3,
                 $4::timestamptz AT TIME ZONE 'UTC',
                 $5::timestamptz AT TIME ZONE 'UTC',
                 $6::timestamptz AT TIME ZONE 'UTC',$7,$8)`,
        [id, station?.id ?? null, stepForRow,
          queueStart ? usToIso(queueStart) : null, processingStart ? usToIso(processingStart) : null,
          usToIso(e.at), e.worker?.id ?? null, routeNumber],
      );
    }
    if (e.anchor && e.anchor !== "research_out") {
      const station = e.submitStation || e.researchStation || plan.finalStation;
      const passed = chance(0.86);
      const stepForRow = e.anchor === "submit" || e.anchor === "submit_final" ? e.step - 1 : e.step;
      await client.query(
        `INSERT INTO test_results (item_id, test_station_id, test_station_type_id, route_number, route_step,
             worker_id, passed, result, comments, details, created_at, state_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12)`,
        [id, station?.id ?? null, station?.typeId ?? null, routeNumber, stepForRow,
          e.worker?.id ?? null, passed, passed ? 1 : 0,
          passed ? pick(COMMENTS_PASS) : pick(COMMENTS_FAIL), null, usToIso(e.at), eventId],
      );
    }
    if (e.anchor === "research_out" || e.anchor === "research_note" || e.anchor === "research_finish" || e.anchor === "research_return") {
      const station = e.researchStation || plan.finalStation;
      await client.query(
        `INSERT INTO research_history (item_id, station_id, result, comments, worker_id, sent_at, return_at)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz AT TIME ZONE 'UTC',$7::timestamptz AT TIME ZONE 'UTC')`,
        [id, station?.id ?? null, 0, pick(RESEARCH_NOTES), e.worker?.id ?? null,
          usToIso(e.at), e.anchor === "research_return" || e.anchor === "research_finish" ? usToIso(e.at) : null],
      );
    }
  }
  return { id };
}

/** submit_id for the event row: taken back out of the event_key when the key
 *  carries one, so history and live rows agree on that column too. */
function submitIdOf(key) {
  const m = key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

// ===========================================================================
// STRUCTURAL PARITY — phase A's events as the template for phase B's
// ===========================================================================
/** A signature is what makes two events "the same shape": the reason, the kind,
 *  the target state, the seq, whether station/station_type are populated, and
 *  the event_key format with its variable parts masked out. */
function signatureRow(r) {
  return [
    r.reason, r.kind, r.to_state ?? "-", r.seq,
    r.station_id == null ? "no-station" : "station",
    r.station_type_id == null ? "no-type" : "type",
    maskKey(r.event_key),
  ].join(" | ");
}
function maskKey(k) {
  return String(k)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{uuid}")
    .replace(/\d{12}/g, "{minute}")
    .replace(/\d{6,}/g, "{item}");
}

async function checkStructuralParity(phaseAEventIds) {
  console.log("\n=== structural parity: phase B events vs the phase A template ===");
  if (!phaseAEventIds) { console.log("  (no phase A run in this invocation — skipped)"); return; }
  const tmplRows = await q(
    `SELECT event_key, reason, kind, to_state, seq, station_id, station_type_id
       FROM item_state_event WHERE event_id <= $1`, [phaseAEventIds],
  );
  const histRows = await q(
    `SELECT event_key, reason, kind, to_state, seq, station_id, station_type_id
       FROM item_state_event WHERE event_id > $1`, [phaseAEventIds],
  );
  const template = new Map();
  for (const r of tmplRows) {
    const s = signatureRow(r);
    template.set(s, (template.get(s) || 0) + 1);
  }
  const histSigs = new Map();
  for (const r of histRows) {
    const s = signatureRow(r);
    histSigs.set(s, (histSigs.get(s) || 0) + 1);
  }
  console.log(`  template shapes (phase A): ${template.size}   history shapes (phase B): ${histSigs.size}`);
  const unknown = [...histSigs.keys()].filter((s) => !template.has(s));
  const unused = [...template.keys()].filter((s) => !histSigs.has(s));
  for (const s of unknown) {
    finding("phase B event shape", "NOT IN TEMPLATE", null,
      `${s}  (x${histSigs.get(s)}) — history emitted a shape the live API never produced`);
  }
  if (unused.length) {
    console.log(`  shapes the live API produced that history does not reproduce (informational):`);
    for (const s of unused) console.log(`    - ${s} (x${template.get(s)})`);
  }
  if (!unknown.length) console.log("  OK — every history event shape exists in the live template");
}

// ===========================================================================
// FINAL CONSISTENCY + REPORT
// ===========================================================================
async function consistencyChecks() {
  console.log("\n=== consistency ===");

  const mismatch = await q(`
    SELECT ir.item_id, ir.current_status, ir.current_route_step, ir.test_station_id,
           (ir.finished_at IS NOT NULL) AS ir_finished,
           i.state_key, i.step_no, i.station_id, COALESCE(i.is_terminal,false) AS ledger_terminal
      FROM item_routes ir
      LEFT JOIN item_state_interval i ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
      LEFT JOIN metric_state ms ON ms.state_key = i.state_key
     WHERE i.item_id IS NULL
        OR ms.legacy_status_id IS DISTINCT FROM ir.current_status
        OR i.step_no IS DISTINCT FROM ir.current_route_step
        OR (ir.finished_at IS NOT NULL) <> COALESCE(i.is_terminal, false)
        OR (i.state_key IN ('testing','in_research') AND i.station_id IS DISTINCT FROM ir.test_station_id)
     ORDER BY ir.item_id LIMIT 20`);
  const mismatchCount = await q1(`
    SELECT count(*)::int AS n FROM item_routes ir
      LEFT JOIN item_state_interval i ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
      LEFT JOIN metric_state ms ON ms.state_key = i.state_key
     WHERE i.item_id IS NULL
        OR ms.legacy_status_id IS DISTINCT FROM ir.current_status
        OR i.step_no IS DISTINCT FROM ir.current_route_step
        OR (ir.finished_at IS NOT NULL) <> COALESCE(i.is_terminal, false)
        OR (i.state_key IN ('testing','in_research') AND i.station_id IS DISTINCT FROM ir.test_station_id)`);
  if (mismatchCount.n > 0) {
    finding("item_routes vs ledger", "DISAGREE", { count: mismatchCount.n },
      JSON.stringify(mismatch.slice(0, 5)), "every item_routes row must agree with its item's open interval");
  } else {
    console.log("  item_routes agrees with the ledger on every item");
  }

  const drift = await q1("SELECT count(*)::int AS n FROM metrics_drift WHERE resolved_at IS NULL");
  console.log(`  metrics_drift open rows: ${drift.n}`);
  if (drift.n > 0) {
    const sample = await q("SELECT item_id, legacy_status, ledger_state, occurrences FROM metrics_drift WHERE resolved_at IS NULL LIMIT 5");
    finding("trg_metrics_drift", "OPEN ROWS", { count: drift.n }, JSON.stringify(sample));
  }

  // The two clocks must actually diverge, or the dataset is worthless.
  const clocks = await q1(`
    SELECT count(*)::int AS closed,
           count(*) FILTER (WHERE work_seconds IS NULL)::int AS no_work,
           count(*) FILTER (WHERE wall_seconds > work_seconds * 3)::int AS straddled,
           round(avg(wall_seconds)/3600.0, 2) AS avg_wall_h,
           round(avg(work_seconds)/3600.0, 2) AS avg_work_h,
           round(max(wall_seconds)/3600.0, 2) AS max_wall_h
      FROM item_state_interval WHERE closed_at IS NOT NULL AND NOT is_terminal`);
  console.log(`  closed intervals: ${clocks.closed} | straddling non-working time (wall > 3x work): ${clocks.straddled}`);
  console.log(`  avg wall ${clocks.avg_wall_h}h vs avg work ${clocks.avg_work_h}h | max wall ${clocks.max_wall_h}h`);
  if (Number(clocks.no_work) > 0) {
    finding("work_seconds", "NULL", { count: clocks.no_work }, "closed intervals with no work_seconds — the calendar does not cover the window");
  }
  // work_seconds must never exceed wall_seconds: it is the same elapsed time
  // with the non-working part removed. work_seconds_elapsed() returns bigint
  // and casts EXTRACT(EPOCH ...) to it, which ROUNDS — so two transitions
  // inside the same second can come back 1 work-second apart while the wall
  // clock says 0.09. offhours_seconds is GENERATED AS (wall - work) and goes
  // negative. Live traffic produces exactly this: the intake wizard's synthetic
  // test_started/result_submitted pair is 1µs apart by design.
  const inverted = await q1(`
    SELECT count(*)::int AS n,
           max(work_seconds - wall_seconds)::text AS worst,
           min(wall_seconds)::text AS min_wall
      FROM item_state_interval
     WHERE closed_at IS NOT NULL AND NOT is_terminal AND work_seconds > wall_seconds`);
  if (inverted.n > 0) {
    finding("work_seconds_between()", "WORK > WALL", { intervals: inverted.n },
      `${inverted.n} closed interval(s) report more WORK time than WALL time (worst +${inverted.worst}s, `
      + `shortest wall ${inverted.min_wall}s), so offhours_seconds is negative on them. `
      + "work_seconds_elapsed() is declared RETURNS bigint and casts EXTRACT(EPOCH FROM ...) to bigint, "
      + "which rounds to the nearest second — sub-second intervals inherit a whole phantom work-second.");
  } else {
    console.log("  work_seconds <= wall_seconds on every closed interval");
  }

  if (Number(clocks.straddled) === 0 && Number(clocks.closed) > 0) {
    finding("dataset", "NO CLOCK DIVERGENCE", null,
      "no interval straddles non-working time — wall_seconds == work_seconds everywhere, so the two-clock metrics are untestable");
  }

  // No occupied bench may outlive its own type's threshold. The reaper measures
  // WALL time from processing_start_time and runs every 5 minutes, so a
  // testing / in_research interval on a type with stale_after_minutes > 0 can
  // never legitimately be older than that plus one cron period — whatever
  // closed it. An interval that IS older describes a state the system cannot
  // reach: the cron would have reverted the item and freed the station first.
  // (Types at 0 opt out of the reaper and are excluded by construction.)
  const overrun = await q(`
    SELECT tt.test_type_desc AS type_desc, tt.stale_after_minutes AS threshold,
           count(*)::int AS n, max(i.wall_seconds)::text AS worst_secs
      FROM item_state_interval i
      JOIN test_stations ts      ON ts.test_station_id = i.station_id
      JOIN test_stations_type tt ON tt.test_station_type_id = ts.test_station_type_id
     WHERE i.state_key IN ('testing','in_research')
       AND i.wall_seconds IS NOT NULL
       AND tt.stale_after_minutes > 0
       AND i.wall_seconds > tt.stale_after_minutes * 60 + ${CRON_PERIOD_SECS}
     GROUP BY 1, 2 ORDER BY 3 DESC`);
  if (overrun.length) {
    for (const r of overrun) {
      finding("dataset", "BENCH OUTLIVED ITS THRESHOLD", { type: String(r.type_desc).trim(), threshold_minutes: r.threshold },
        `${r.n} occupied-bench interval(s) on "${String(r.type_desc).trim()}" are longer than its `
        + `stale_after_minutes (${r.threshold} min) plus one cron period — worst ${Math.round(Number(r.worst_secs) / 60)} min. `
        + "The reaper would have released those items and freed those stations, so the rows are not reproducible.");
    }
  } else {
    console.log("  every occupied bench stays inside its station type's stale_after_minutes");
  }
}

async function report() {
  console.log("\n===========================================================");
  console.log("SUMMARY");
  console.log("===========================================================");

  const tables = [
    "customers", "sources", "item_types", "test_stations_type", "test_stations", "testing_routes",
    "shipments", "shipment_items", "items", "item_routes", "item_route_history", "test_results",
    "research_history", "route_run", "item_state_event", "item_state_interval", "work_span",
  ];
  console.log("\nrows per table");
  for (const t of tables) {
    const r = await q1(`SELECT count(*)::int AS n FROM public."${t}"`);
    console.log(`  ${t.padEnd(24)} ${String(r.n).padStart(7)}`);
  }

  const evr = await q1("SELECT min(occurred_at) AS a, max(occurred_at) AS b FROM item_state_event");
  const isir = await q1(`SELECT min(start_business_date)::text AS a, max(close_business_date)::text AS b,
                                count(DISTINCT close_business_date)::int AS days FROM item_state_interval`);
  console.log("\ndate range");
  console.log(`  events        ${evr.a ? new Date(evr.a).toISOString() : "-"}  ..  ${evr.b ? new Date(evr.b).toISOString() : "-"}`);
  console.log(`  business days ${isir.a || "-"}  ..  ${isir.b || "-"}   (${isir.days} distinct closing days)`);

  const live = await q(`
    SELECT ms.label_he, i.state_key, count(*)::int AS n
      FROM item_state_interval i JOIN metric_state ms ON ms.state_key = i.state_key
     WHERE upper_inf(i.valid_range) AND NOT i.is_terminal
     GROUP BY 1,2 ORDER BY 3 DESC`);
  console.log("\nitems in flight right now");
  if (!live.length) console.log("  (none)");
  for (const r of live) console.log(`  ${String(r.state_key).padEnd(16)} ${String(r.n).padStart(5)}  ${r.label_he}`);

  const perStation = await q(`
    SELECT trim(ts.test_station_desc) AS station, count(*)::int AS n
      FROM item_state_interval i JOIN test_stations ts ON ts.test_station_id = i.station_id
     WHERE upper_inf(i.valid_range) AND NOT i.is_terminal
     GROUP BY 1 ORDER BY 2 DESC`);
  if (perStation.length) {
    console.log("\n  at a station:");
    for (const r of perStation) console.log(`    ${r.station.padEnd(20)} ${r.n}`);
  }

  console.log("\nAPI calls by endpoint");
  const rows = [...callStats.entries()].sort((a, b) => (b[1].ok + b[1].fail) - (a[1].ok + a[1].fail));
  let okTotal = 0, failTotal = 0;
  for (const [label, s] of rows) {
    okTotal += s.ok; failTotal += s.fail;
    console.log(`  ${label.padEnd(48)} ok=${String(s.ok).padStart(5)} fail=${String(s.fail).padStart(4)}`);
  }
  console.log(`  ${"TOTAL".padEnd(48)} ok=${String(okTotal).padStart(5)} fail=${String(failTotal).padStart(4)}`);

  console.log("\nSYSTEM FINDINGS");
  if (!findings.length) {
    console.log("  none — every call answered 2xx and every invariant held");
  } else {
    const byEndpoint = new Map();
    for (const f of findings) {
      const k = `${f.endpoint} :: ${f.status}`;
      if (!byEndpoint.has(k)) byEndpoint.set(k, []);
      byEndpoint.get(k).push(f);
    }
    let i = 0;
    for (const [k, list] of byEndpoint) {
      console.log(`\n  [${++i}] ${k}   x${list.length}`);
      console.log(`      body:    ${String(list[0].body).slice(0, 300)}`);
      if (list[0].payload) console.log(`      payload: ${JSON.stringify(list[0].payload).slice(0, 300)}`);
      if (list[0].extra) console.log(`      note:    ${list[0].extra}`);
    }
  }

  console.log("\nmetrics_selfcheck()");
  const sc = await q("SELECT * FROM metrics_selfcheck()");
  for (const r of sc) {
    console.log(`  ${String(r.check_name).padEnd(40)} ${String(r.value).padStart(12)}  ${r.detail ?? ""}`);
  }
  console.log("");
}

// ===========================================================================
// main
// ===========================================================================
(async () => {
  const started = Date.now();
  let phaseAMaxEventId = null;
  try {
    await preflight();

    if (!SKIP_API) {
      sessionCookie = await mintSession();
      const health = await api("GET", "/api/health", { auth: false });
      if (!health.ok) throw new Error(`dev server not answering at ${API_BASE} — start it first (see the header of this file)`);
      await ensureReference();
      await ensureWorkHours();
      await createShipments();
      await phaseALive();
      await runReaper();
      const maxEv = await q1("SELECT COALESCE(max(event_id),0)::bigint AS n FROM item_state_event");
      phaseAMaxEventId = maxEv.n;
    } else {
      await loadReferenceFromDb();
    }

    if (!SKIP_HISTORY) {
      await phaseBHistory();
      await checkStructuralParity(phaseAMaxEventId);
    }

    await consistencyChecks();
    await report();
    console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
    process.exit(findings.length ? 1 : 0);
  } catch (e) {
    console.error("\nFATAL:", e.message);
    console.error(e.stack);
    try { await report(); } catch { /* best effort */ }
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
})();
