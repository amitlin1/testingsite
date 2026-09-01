// Old-vs-new parity harness for the dashboard read path (§9.3 of
// docs/dashboard-migration-plan-v2.md, stage 5).
//
//   node --import tsx scripts/dashboard-parity.js --database-url "postgres://..."
//   node --import tsx scripts/dashboard-parity.js --old direct
//   node --import tsx scripts/dashboard-parity.js --endpoint tests/kpis --verbose
//   node --import tsx scripts/dashboard-parity.js --json out/parity.json
//
// EXIT CODE: 0 only when every compared field either MATCHES or is listed in
// §9.4 as an intentional difference. Anything else is a failure — including a
// field the old response carries that nothing on the new side maps to, which is
// how a silently dropped number would otherwise reach production.
//
// ---------------------------------------------------------------------------
// WHAT IT ACTUALLY COMPARES
// ---------------------------------------------------------------------------
// OLD side: the endpoint exactly as it ships today. Default `--old http` calls
// the live route over HTTP with a minted next-auth session (all 14 dashboard
// routes are withAuth(role:"manager") since stage 0, and IS_DEV bypasses the
// middleware but NOT withAuth). `--old direct` skips the server and calls
// MetricsService in-process — it covers the five endpoints whose logic lives in
// the service and honestly reports the other five as SKIPPED, because their SQL
// is inline in the route file and re-typing it here would compare this harness
// against itself.
//
// NEW side: the CONVERTED ROUTES, over HTTP, and nothing else. There used to be
// a second mode (`--new impl`) that re-implemented each route's mapping here in
// JavaScript and graded THAT. It was the default, and it was a lie: the copies
// drifted from what ships (busiestStationCount, busiestStationWaitSeconds and
// the busiest-station tie-break all disagreed by the time anyone looked), so a
// green run said the adapters agreed with the old routes while the product went
// ungraded. The routes are the product; the adapters were deleted.
//
// The four `[id]/history` routes (§8 stage 6) are graded too, but NOT by a diff:
// their old sides read snapshot tables that hold 0 rows and staple one live
// "today" point on the end (item-types/[id]/history raises 42703 and answers 500
// on every request), so there is no old series to compare against. They run their
// own matrix of (id x dialog preset) and are graded on the NEW side's invariants;
// see THE PATH-PARAMETER ENDPOINTS below for the list and the reasoning.
//
// MATRIX (§9.3): 6 windows x 11 filter combinations x 2 scope values = 132 runs
// per endpoint — §9.3's own figure is 3 x 8 x 2, and PERIODS/filterCombos() have
// grown past it since. The run prints the real number at startup; this comment
// is not the source of truth for it. The filter ids are discovered from the
// database at startup, so the matrix exercises rows that actually exist rather
// than hardcoded ids that silently select nothing.
//
// ---------------------------------------------------------------------------
// IT CANNOT MUTATE ANYTHING
// ---------------------------------------------------------------------------
// Not by convention — every pooled connection is opened with
// `default_transaction_read_only = on`, so an accidental write fails with
// 25006 instead of changing data. The old side is only ever reached through GET.
// The run is therefore repeatable, and repeatable while the dual-run week is
// live.
//
// ---------------------------------------------------------------------------
// READING THE OUTPUT
// ---------------------------------------------------------------------------
//   =    field matches (within tolerance)
//   ~    field differs and §9.4 says it should — printed with the reason
//   X    field differs and nothing explains it            -> FAILURE
//   ?    old carries the field, nothing on the new side maps to it -> FAILURE
//   +    new-only field (the work clock, mostly) — checked, see below
//   N    a _new_ field that is null in EVERY case          -> FAILURE
//   P    a *Wall* field with no *Work* sibling             -> FAILURE
//   C    work > wall on a two-clock pair                   -> FAILURE
// A `_new_` field is not just printed any more. Three things are asserted about
// it, because finding #1 of the stage-5 review — four permanently-null fields
// on tests/by-station — walked past this harness twice while every one of them
// was stamped "+ NEW_ONLY" and never looked at:
//   * it must not be null in every single case of the matrix (a field that is
//     null for SOME filter combinations is data; one that is null for all of
//     them is a bug, and that is exactly the shape finding #1 had). Fields that
//     are legitimately null-always are listed in NEW_NULLABLE with a reason.
//   * every `*Wall*` field must have the `*Work*` sibling §2.8 requires — a
//     duration that ships on one clock only is the defect §2.8 exists to stop.
//   * and the work clock must never exceed the wall clock on such a pair.
// Rows present on one side only are listed separately; they are a failure
// unless the endpoint declares rowsetMayDiffer.

const { Pool } = require("pg");

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
function flag(name) {
  return argv.includes("--" + name);
}

const DATABASE_URL = arg("database-url", process.env.DATABASE_URL || "");
const OLD_MODE = arg("old", "http"); // http | direct
const PORT = parseInt(arg("port", "3000"), 10);
const API_BASE = arg("api-base", `http://localhost:${PORT}`).replace(/\/+$/, "");
// The old routes live at HEAD, the new ones in the working tree, so the two
// sides are two servers. Default both to API_BASE for the original behaviour.
const OLD_API_BASE = arg("old-api-base", API_BASE).replace(/\/+$/, "");
const NEW_API_BASE = arg("new-api-base", API_BASE).replace(/\/+$/, "");
const AUTH_SECRET = arg(
  "auth-secret",
  process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "local_dev_secret_change_in_prod"
);
const ONLY_ENDPOINT = arg("endpoint", null);
const ONLY_CASE = arg("case", null);
const JSON_OUT = arg("json", null);
const TOLERANCE = parseFloat(arg("tolerance", "0.000001"));
const VERBOSE = flag("verbose");
const LIST_CASES = flag("list-cases");

function usage(msg) {
  console.error("\n" + msg);
  console.error(`
usage: node --import tsx scripts/dashboard-parity.js [options]

  --database-url URL   default $DATABASE_URL
  --old http|direct    where the OLD numbers come from (default http)
                       the NEW side is always the converted routes over HTTP
  --api-base URL       default http://localhost:<port>   (http mode)
  --port N             default 3000                      (http mode)
  --auth-secret S      default $AUTH_SECRET              (http mode)
  --endpoint NAME      run one endpoint, e.g. tests/kpis or customers/[id]/history
  --case ID            run one matrix case, e.g. 30d/customer/open
  --tolerance F        relative tolerance for numbers (default 1e-6)
  --json PATH          also write the full result as JSON
  --verbose            print every field, not just the interesting ones
  --list-cases         print the matrix and exit

  tsx is required (node --import tsx) — the harness imports the TypeScript
  query layer directly so that it measures the shipped text, not a copy.
`);
  process.exit(2);
}

if (!DATABASE_URL) usage("no target database: pass --database-url or set DATABASE_URL");
if (!["http", "direct"].includes(OLD_MODE)) usage(`--old must be http or direct, got ${OLD_MODE}`);

// ---- db (read-only, enforced) ----------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
pool.on("connect", (c) => {
  // A promise rejection here would be unhandled; pg emits 'error' on the pool
  // if the statement fails, which surfaces on first use. That is the point:
  // if the session cannot be made read-only, the run must not proceed.
  c.query("SET default_transaction_read_only = on");
});
async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}
async function q1(sql, params = []) {
  return (await q(sql, params))[0] || null;
}

/** The MetricsClient shape queries.ts (and MetricsService) needs. */
const dbClient = {
  async $queryRawUnsafe(sql, ...params) {
    return (await pool.query(sql, params)).rows;
  },
};

// ---- http ------------------------------------------------------------------
let sessionCookie = null;

/** Mint an Auth.js session cookie offline — the same recipe seed-dev-dataset.js
 *  uses. IS_DEV=1 bypasses the middleware but not withAuth(), and all 14
 *  dashboard routes are withAuth(role:"manager"). */
async function mintSession() {
  const { encode } = await import("next-auth/jwt");
  const now = Math.floor(Date.now() / 1000);
  return encode({
    secret: AUTH_SECRET,
    salt: "authjs.session-token",
    maxAge: 86400,
    token: {
      sub: "parity-bot",
      name: "Parity Bot",
      email: "parity@example.local",
      preferred_username: "paritybot",
      employee_number: "9002",
      roles: ["manager"],
      access_token: "parity",
      expires_at: (now + 86400) * 1000,
      refresh_expires_at: (now + 86400) * 1000,
      iat: now,
      exp: now + 86400,
    },
  });
}

async function httpGet(path, base = OLD_API_BASE) {
  const res = await fetch(base + path, {
    method: "GET",
    headers: sessionCookie ? { cookie: `authjs.session-token=${sessionCookie}` } : {},
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

/** Same as httpGet but also returns status + headers, for the shape probes. */
async function httpGetRaw(path, base) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method: "GET",
    headers: sessionCookie ? { cookie: `authjs.session-token=${sessionCookie}` } : {},
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, json, text, ms: Date.now() - t0 };
}

// ---- the TypeScript layer under test ---------------------------------------
// queries.ts is imported for its SIDE EFFECT, not for its exports: the module
// runs guardAllBuilders() at load (§5.0(9)), so a range probe that lost its
// `NOT <alias>.is_terminal` makes the harness refuse to start instead of
// silently measuring a query the planner will scan the whole ledger for. The
// endpoint mappings that used to call these functions here are gone — the
// routes are the product.
let Q; // src/app/lib/metrics/queries — loaded for the build-time sweep
let F; // src/app/lib/metrics/filters
let P; // src/app/lib/metrics/period
let MS; // src/app/lib/dashboard/metrics-service (direct mode only)

/** tsx transpiles the TypeScript modules to CJS when they are imported from a
 *  CJS script, and `await import()` of a CJS module puts the named exports on
 *  `.default`. Under a real ESM namespace they are top level. Accept both. */
function interop(m) {
  return m && m.default && typeof m.default === "object" && !m.resolvePeriod && !m.pointInTime && !m.intervalFilter
    ? m.default
    : m;
}

async function loadModules() {
  try {
    Q = interop(await import("../src/app/lib/metrics/queries.ts"));
    if (!Q || typeof Q.guardAllBuilders !== "function") {
      throw new Error("queries.ts loaded without guardAllBuilders — wrong module?");
    }
    F = interop(await import("../src/app/lib/metrics/filters.ts"));
    P = interop(await import("../src/app/lib/metrics/period.ts"));
  } catch (e) {
    usage(
      `cannot import the TypeScript query layer (${e.message}).\n` +
        "Run this script as:  node --import tsx scripts/dashboard-parity.js"
    );
  }
  if (OLD_MODE === "direct") {
    MS = interop(await import("../src/app/lib/dashboard/metrics-service.ts")).MetricsService;
  }
}

// ===========================================================================
// THE MATRIX
// ===========================================================================

/** 3 windows (§9.3). `today` exercises the single-day edge, 30d the common
 *  case, 13mo the UI cap itself (§6.3) — the only window whose cost is bounded
 *  by anything other than the data. */
const PERIODS = [
  { id: "today", period: "today" },
  { id: "7d", period: "last7days" },
  { id: "30d", period: "last30days" },
  { id: "90d", period: "last90days" },
  { id: "12mo", period: "last12months" },
  { id: "13mo", period: "last13months" },
];

const SCOPES = [
  { id: "open", scope: "open_shipments" },
  { id: "all", scope: "all" },
];

/** Filled in by discoverFixtures() from rows that actually exist. */
const FIXTURES = {};

/** 8 filter combinations (§9.3). */
function filterCombos() {
  return [
    { id: "none", filters: {} },
    { id: "customer", filters: { customerId: FIXTURES.customerId } },
    { id: "shipment", filters: { shipmentId: FIXTURES.shipmentId } },
    { id: "itemtype", filters: { itemTypeId: FIXTURES.itemTypeId } },
    { id: "station", filters: { testStationId: FIXTURES.stationId } },
    { id: "stationtype", filters: { testStationTypeId: FIXTURES.stationTypeId } },
    // The one that returns zeros with HTTP 200 today: the old predicate is
    // worker_id on a table without the column, 42703, caught, defaultKpis (§9.4).
    { id: "worker", filters: { workerId: FIXTURES.workerId } },
    { id: "serial", filters: { itemSerial: FIXTURES.serial } },
    // The legacy status selector. §5.10: statuses 4/5 were double-counted in
    // the broad sets; metric_state's flags separate them, so each subset is
    // exercised on its own.
    { id: "st-queue", filters: { status: "queue" } },
    { id: "st-processing", filters: { status: "processing" } },
    { id: "st-finished", filters: { status: "finished" } },
  ].filter((c) => Object.values(c.filters).every((v) => v !== null && v !== undefined));
}

async function discoverFixtures() {
  const top = async (col, table = "item_state_interval") =>
    (
      await q1(
        `SELECT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`
      )
    )?.v ?? null;
  FIXTURES.customerId = await top("customer_id");
  FIXTURES.shipmentId = await top("shipment_id");
  FIXTURES.itemTypeId = await top("item_type_id");
  FIXTURES.stationId = await top("station_id");
  FIXTURES.stationTypeId = await top("station_type_id");
  FIXTURES.workerId = await top("exited_by_worker_id");
  FIXTURES.serial =
    (await q1("SELECT serial_no AS v FROM item_state_interval WHERE serial_no <> '' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1"))
      ?.v ?? null;
  FIXTURES.legacyStatus = Object.fromEntries(
    (await q("SELECT state_key, legacy_status_id FROM metric_state")).map((r) => [
      r.state_key,
      r.legacy_status_id,
    ])
  );
}

/** Every (period x filter x scope) case, as both a query string (old side) and
 *  a resolved period + filter object (new side). */
function buildCases() {
  const cases = [];
  for (const per of PERIODS) {
    for (const fc of filterCombos()) {
      for (const sc of SCOPES) {
        const resolved = P.resolvePeriod({ period: per.period, scope: sc.scope });
        const sp = new URLSearchParams();
        // The old endpoints take instants; the new layer takes business days.
        // Both are derived from ONE resolved period so the two sides are never
        // asked about different windows (§7.2 — no more setHours stretching).
        sp.set("startDate", resolved.fromTs.toISOString());
        sp.set("endDate", new Date(resolved.toTsExclusive.getTime() - 1).toISOString());
        for (const [k, v] of Object.entries(fc.filters)) sp.set(k, String(v));
        if (sc.scope === "all") sp.set("showAllHistory", "true");
        sp.set("scope", sc.scope);
        cases.push({
          id: `${per.id}/${fc.id}/${sc.id}`,
          period: resolved,
          searchParams: sp,
          filters: {
            ...F.filtersFromSearchParams(sp),
            scope: sc.scope,
          },
        });
      }
    }
  }
  return cases;
}

// ===========================================================================
// §9.4 — the intentional-difference list
// ===========================================================================
//
// A difference is only allowed to exist if it appears here with a reason. The
// harness prints these as `~` and does not fail on them; everything else fails.
// `direction` is optional and, when given, is also checked: an "expected to be
// higher" field that came out lower is still a failure.

const EXPECTED = {
  "tests/kpis": {
    averageQueueTimeMinutes: {
      // No `direction` assertion. §9.4's "higher" is about the POPULATION (the
      // old average sees only the current station's history rows). Q5 also
      // CLIPS every interval to the window (§5.6), and on a short window that
      // pulls the new number below the old one — measured old=223.4 new=85.3 on
      // a one-day window. Two different effects; only the first has a sign.
      reason: "§9.4 — old averages only history rows at the item's CURRENT station; new counts every step, clipped to the window (§5.6)",
    },
    averageProcessingTimeMinutes: {
      reason: "§9.4 — accessory synthetic ~0 durations excluded (§5.0(8)); old diluted the average with them",
    },
    avgQueueSeconds: { reason: "§9.4 — same as averageQueueTimeMinutes, in seconds" },
    avgProcessingSeconds: { reason: "§9.4 — same as averageProcessingTimeMinutes, in seconds" },
    totalItemsProcessed: {
      reason: "§5.3ב — 'finished' is now route_run.closed_at, not a DISTINCT over item_routes.finished_at",
    },
    treatedCount: { reason: "§5.3ב — same anchor change as totalItemsProcessed" },
    itemsCurrentlyInQueue: {
      reason:
        "§9.4 (statuses 4/5) — the old KPI counted current_status = 2 ONLY, while the station board in the same service counted IN (2,4). The ledger uses metric_state.is_waiting = queued + queued_research everywhere. Measured now: old 15, new 19 = 15 queued + 4 queued_research, and the ledger agrees with item_routes state-for-state (2->15, 4->4).",
    },
    itemsCurrentlyInTest: {
      reason:
        "§9.4 (statuses 4/5) — same split: the old KPI counted current_status = 1 only. New is metric_state.is_active_work = testing + in_research. Measured now: old 2, new 4 = 2 testing + 2 in_research.",
    },
    busiestStationBusySeconds: { reason: "§5.10 — sum(work_seconds) over is_active_work, work clock not wall" },
    busiestStationWaitSeconds: {
      reason:
        "§5.10 — sum(work_seconds) over is_waiting for the BUSIEST STATION'S TYPE (the queue belongs to the type, §5.4), on the work clock rather than wall. The lab-wide total ships separately as _new_labWaitWork/WallSeconds.",
    },
    busiestStationId: { reason: "§5.10 — ranked by work_hours; the old score mixed busy and wait seconds" },
    busiestStationName: { reason: "§5.10 — follows busiestStationId" },
    busiestStationCount: {
      reason: "§5.10 — DELETED. Was ROUND(busy_sec + 0.3*wait_sec) displayed as 'processed N items'",
      deleted: true,
    },
    busiestStationWorkloadScore: {
      reason: "§5.10 — DELETED, replaced by work_hours / wait_work_hours / steps_processed",
      deleted: true,
    },
  },
  "tests/by-station": {
    itemsInQueue: {
      reason:
        "§5.4 — the queue belongs to the station TYPE, not the station. A `queued` interval carries no station_id at all (0 of 3,151 rows), so the per-station split the old route made from item_routes.test_station_id is not reconstructible and is not faked: the type's count is reported on every station of that type (measured 30d: old 5 + 3 for the two ויזואלית stations, new 8 on both) and must not be summed down the column. A research station also reads 0 here, because queued_research is a station-less pool — it ships as _new_researchPoolQueue.",
    },
    averageCurrentQueueTimeMinutes: {
      reason: "§9.4 — split into standing_queue_age_* (waiting population) and active_test_age_*; the old number mixed them",
    },
    totalProcessedInPeriod: {
      reason:
        "§9.4 / §5.0(2) — 'processed' is every active-work interval that closed with a recorded outcome: result_submitted, sent_to_research and returned_to_route count; released_by_user / released_stale (the reaper) do not. Measured at station 15 over 30 days: old 47 (item_route_history rows with a processing_end_time), new 51 = 41 result_submitted + 10 sent_to_research, with 5 reaper abandonments excluded. NOTE: the research-station half of this §9.4 entry does NOT reproduce on this dataset (stations 12/13 read 9 and 3 on both sides) because the seeder writes an item_route_history row for research steps too; and the station-0 poison rows of PUT /api/items/[id]/status are absent here (0 rows with test_station_id = 0).",
    },
    itemsInTest: {
      reason:
        "§9.4 — live ledger probe rather than item_routes.current_status, and NARROW where the old query was wide: the old counted current_status IN (1,5), so a research station reported its in-research items as 'in test' (measured: station 12 old=2 new=0). in_research ships as _new_itemsInResearch.",
    },
  },
  "tests/status-distribution": {
    count: { reason: "§9.4 — genuinely point-in-time over the ACTIVE population; `done` is no longer a slice (§5.2)" },
    percentage: { reason: "§9.4 — follows count; computed as a window function in SQL" },
    statusName: { reason: "§5.10 — labels come from metric_state.label_he; status-names.ts is deleted" },
  },
  "tests/shipments": {
    completionPercentage: {
      reason: "§9.4 — denominator moved from shipments.amount (a stock number) to routed_runs",
    },
    itemsInRoutesPercentage: { reason: "§9.4 — renamed coverage_pct = routed_units / amount" },
    itemsInQueue: { reason: "§9.4 — from the ledger's open intervals, not item_routes.current_status" },
    itemsInTest: { reason: "§9.4 — from the ledger's open intervals" },
    itemsWaitingForResearch: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInResearch: { reason: "§9.4 — from the ledger's open intervals" },
    itemsFinished: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInRoutes: { reason: "§5.8 — count(DISTINCT route_run_id), one pass per run" },
  },
  "tests/item-types": {
    totalItems: {
      // No `direction` assertion: §9.4 says the old number was inflated by the
      // shipment-line count, and usually it is — but SUM(amount) is 0 for an
      // item type whose shipments declare no amount, and there the new number
      // is the larger one (measured old=0 new=46). The redefinition is the
      // point; the sign is not guaranteed.
      reason: "§9.4 — redefined to count(DISTINCT route_run_id); the old SUM(amount) counted shipment lines, and was 0 wherever amount was unset",
    },
    itemsInRoutes: { reason: "§5.10 — count(DISTINCT route_run_id)" },
    completionPercentage: { reason: "§9.4 — finished_runs / routed_runs, the same formula as shipments" },
    itemsInRoutesPercentage: { reason: "§9.4 — coverage_pct against the real item count" },
    itemsInQueue: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInTest: { reason: "§9.4 — from the ledger's open intervals" },
    itemsWaitingForResearch: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInResearch: { reason: "§9.4 — from the ledger's open intervals" },
    itemsFinished: { reason: "§9.4 — from the ledger's open intervals" },
  },
  "tests/customer-performance": {
    itemsInRoutesPercentage: {
      reason: "§9.4 — was locked at 100 by a LEFT JOIN that had decayed into an INNER; now a real number",
    },
    successPercentage: { reason: "§9.4 — renamed completion_pct; true 'success' is fail_pct in Q8" },
    averageTimeMinutes: {
      reason: "§9.4 + §2.8 — avg_route_turnaround_wall_min, and the work twin is new alongside it",
    },
    totalItems: { reason: "§5.10 — count(DISTINCT rr.unit_id)" },
    itemsInRoutes: { reason: "§5.10 — count(DISTINCT route_run_id)" },
    itemsInQueue: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInTest: { reason: "§9.4 — from the ledger's open intervals" },
    itemsWaitingForResearch: { reason: "§9.4 — from the ledger's open intervals" },
    itemsInResearch: { reason: "§9.4 — from the ledger's open intervals" },
    finishedItems: { reason: "§9.4 — from the ledger's open intervals" },
  },
  "tests/slow-items": {
    queueTimeMinutes: { reason: "§9.4 — old queue_start_time was the item's created_at, so waits were inflated" },
    processingTimeMinutes: { reason: "§9.4 — intake-wizard durations were 0 (ProcessingStartTime: null)" },
    totalTimeMinutes: { reason: "§9.4 — follows the two above" },
    routeStep: { reason: "§5.7 — step_no from the interval, not item_routes.current_route_step" },
    workerId: { reason: "§5.7 — exited_by_worker_id from the interval" },
    stationName: { reason: "§5.7 — the station of the step, not the item's current station" },
    serialNo: { reason: "§5.7 — different rows are selected (see rowsetMayDiffer)" },
    makat: { reason: "§5.7 — different rows are selected" },
    model: { reason: "§5.7 — different rows are selected" },
  },
  "tests/status-distribution/history": {
    count: {
      reason:
        "§5.3ב + §5.0(1) — the `done` entry is no longer 'items whose current_status is 3' but the running total of route_run closures (measured today: old 99 under a station filter, new 607 = every closure to date), and route_run carries no station / station type / worker / state dimension, so a station filter narrows the point-in-time lines and cannot narrow the cumulative one. The response says so per-metric in X-Metrics-Ignored-Filters (finishedCumulative:stationId). The point-in-time counts themselves are Q2א sampled at 12:00 Asia/Jerusalem, not a live COUNT over item_routes.",
    },
    percentage: {
      reason:
        "§5.2 — the denominator is the ACTIVE population of that day, not every row including `done`. Measured today: old 0.3 / 2.4 / 96.3 over a 630-row total; new 8.7 / 65.2 over the 23 items actually in flight, and null on the cumulative finished line because a running total has no share of a snapshot.",
    },
  },
  "tests/average-times": {
    avgWaitingMinutes: { reason: "§9.4 — old queue_start_time was the item's created_at; waits were inflated" },
    avgProcessingMinutes: { reason: "§9.4 — accessory synthetic durations excluded (§5.0(8))" },
    recordCount: {
      // No `direction`: the accessory exclusion pushes it down, but the ledger
      // also has steps the legacy history table never recorded (it keeps only
      // rows for the item's CURRENT station), which pushes it up. Measured both
      // ways on the same run: old=38 new=35, and old=15 new=17.
      reason: "§9.4 — now the real denominator of the averages: accessories excluded (§5.0(8)), but every step counted, not just the current station's",
    },
    date: { reason: "§7.2 — buckets are Asia/Jerusalem business days; the old DATE_TRUNC ran in the session TZ" },
    isToday: {
      reason:
        "§7.2 — the old flag is placed by `new Date(); setHours(0,0,0,0); toISOString().split('T')[0]`, which renders the process's LOCAL midnight as a UTC day and therefore names YESTERDAY east of Greenwich. Observed live on this dataset: the old response marks 2026-08-27 as 'today' while the Asia/Jerusalem business day is 2026-08-28. The new flag is placed on the real business day.",
    },
  },
};

/** Endpoints whose row SET legitimately differs, with the reason. */
const ROWSET_MAY_DIFFER = {
  "tests/slow-items":
    "§5.10 — ordered by total_work_min (the work clock) rather than raw wall time, so a different 20 rows surface",
  "tests/status-distribution":
    "§5.2 — the ACTIVE population only, so `done` (legacy status 3) is no longer a slice; and a state with no live items is omitted rather than emitted as a zero row (§5.0(7): the distribution is a snapshot, not a gap-filled series)",
  "tests/shipments":
    "§5.0(1) — the old route filters `s.is_sent = false`, so a shipment whose is_sent is NULL vanishes from every live screen; `IS NOT TRUE` keeps it. And §5.8's Q7 is anchored on route_run, which has no station / station type / worker / serial dimension: those filter combinations narrow the old list and cannot narrow the new one. Every row carries _new_ignoredFilters saying so.",
  "tests/by-station":
    "§9.4 — the synthetic station 0 produced by PUT /api/items/[id]/status has no ledger interval",
  "tests/customer-performance":
    "§9.4 — the old LEFT JOIN had decayed into an INNER, so a customer with nothing routed in the window disappeared from the table entirely. Q7 keeps every customer and reports zeros.",
  "tests/item-types":
    "§9.4 — same decayed LEFT JOIN as customer-performance: an item type with no routed run vanished from the old list.",
  "tests/status-distribution/history":
    "§9.4 — the old route reads status_distribution_snapshots{,_monthly}, which hold 0 rows on this database, and then OVERWRITES today with a live COUNT over item_routes.current_status. So the old response is exactly one day long and the new one is the whole window. The `done` line is also new: Q2א is the ACTIVE population (§5.2) and the cumulative finished series comes from route_run closures (§5.3ב).",
  "stats/completion-history":
    "§9.4 — the old route reads shipment_snapshots_monthly (0 rows here) and answers [] with HTTP 200; with a shipmentId filter it puts `s.shipment_id` on `shipments`, which has no such column, and answers HTTP 500. Every row on the new side is therefore new.",
  "tests/average-times":
    "§9.4 — the old series is anchored on item_route_history rows joined to the item's CURRENT station, so a day whose work happened at any earlier step produced no bucket at all. The ledger has a closed interval for every step, so the series is denser. Buckets are also Asia/Jerusalem business days now (§7.2) rather than DATE_TRUNC in the session timezone.",
};

// ===========================================================================
// THE _new_ CONTRACT — what the harness asserts about a field the old side
// never had
// ===========================================================================
//
// Until finding #1 of the stage-5 review, a `_new_` field was printed and
// nothing else: compareRow walked the OLD row's keys, so every §2.8 addition
// was stamped NEW_ONLY and never looked at. tests/by-station shipped four
// fields that were null on every row of every case for exactly that reason —
// the waiting family was grouped by station, and a `queued` interval carries no
// station_id at all, so all four went into the NULL bucket and the harness
// called the run green. These three rules are the answer.

/** `_new_` fields that are ALLOWED to be null in every case, with the reason.
 *  Everything else that is null across the whole matrix is a failure. This list
 *  is short on purpose: an entry here is a promise that the null carries
 *  meaning, not a place to park a field that stopped working. */
const NEW_NULLABLE = {
  "tests/kpis": {
    _new_ignoredFilters:
      "not a metric — it is the LIST of filters route_run cannot express, and null is the answer 'every filter was honoured'",
    _new_busiestStationWaitWallSeconds:
      "documented `number | null` in the route: null when the busiest station's TYPE closed no queue interval in the window. The work-clock half answers 0 there only because DashboardKpis types it `number`",
  },
  "tests/shipments": {
    _new_ignoredFilters: "same as tests/kpis — the list of dropped filters, not a number",
    _new_shipTurnaroundWallMinutes:
      "a shipment that has not left yet has finished_at IS NULL; §5.8 guards BOTH clocks so 'not shipped' never reads as 0 minutes",
    _new_shipTurnaroundWorkMinutes: "the work half of the pair above, guarded identically",
  },
  "tests/slow-items": {
    _new_workerName:
      "exited_by_worker_name is a snapshot taken at exit; a step closed by the reaper (released_stale) has no worker",
  },
};

/** The two-clock pairs whose halves do not share a stem (§2.8).
 *  ONE entry, and it is the KPI card's queue: the wall half was added in stage 5
 *  under a `_new_` name while the work half keeps the legacy wire name the card
 *  renders. Every other pair is `X_Wall_Y` / `X_Work_Y` and needs no entry. */
const CLOCK_PAIR_ALIAS = {
  _new_busiestStationWaitWallSeconds: "busiestStationWaitSeconds",
};

/** The `*Work*` name that must exist beside a `*Wall*` one. */
function workSiblingOf(field) {
  return CLOCK_PAIR_ALIAS[field] ?? field.replace(/Wall/, "Work");
}

// An old-side EXCEPTION that §9.4 predicts. These are the endpoints that are
// broken today; the harness records them as expected rather than as harness
// errors, and says what the old code does with the exception.
const EXPECTED_OLD_ERRORS = {
  "stats/completion-history": [
    {
      match: /column "?s\.shipment_id"? does not exist|42703/i,
      reason:
        "§9.4 — the old route puts `AND s.shipment_id = $n` on `shipments`, which has no such column (the column is `id`). Postgres raises 42703 and the route answers HTTP 500. Every request carrying a shipmentId filter — the chart's main use — has always failed. The ledger route honours the filter.",
    },
  ],
  "tests/kpis": [
    {
      match: /column "worker_id" does not exist|42703/i,
      reason:
        "§9.4 — with workerId the old KPI query puts a worker_id predicate on a table that has no such column. Postgres raises 42703, the route catches it and answers HTTP 200 with defaultKpis (all zeros). The ledger carries exited_by_worker_id on the interval, so the new side answers for real.",
    },
  ],
};

// ===========================================================================
// THE NEW SIDE — the CONVERTED endpoints exactly as they ship
// ===========================================================================
// The only new-side mode there is. With `--new-api-base <working-tree server>`
// the harness compares the shipped route against the shipped old route, which
// is the only comparison stage 5 can be signed off on.

const ROUTE_PATH = {
  "tests/kpis": "/api/dashboard/tests/kpis",
  "tests/by-station": "/api/dashboard/tests/by-station",
  "tests/status-distribution": "/api/dashboard/tests/status-distribution",
  "tests/status-distribution/history": "/api/dashboard/tests/status-distribution/history",
  "tests/shipments": "/api/dashboard/tests/shipments",
  "tests/item-types": "/api/dashboard/tests/item-types",
  "tests/customer-performance": "/api/dashboard/tests/customer-performance",
  "tests/slow-items": "/api/dashboard/tests/slow-items",
  "tests/average-times": "/api/dashboard/tests/average-times",
  "stats/completion-history": "/api/dashboard/stats/completion-history",
};

const LATENCY = []; // { endpoint, side, case, ms }

function httpSide(name, base, side) {
  return async (c) => {
    const r = await httpGetRaw(`${ROUTE_PATH[name]}?${c.searchParams}`, base);
    LATENCY.push({ endpoint: name, side, case: c.id, ms: r.ms, status: r.status });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`GET ${ROUTE_PATH[name]} -> ${r.status} ${r.text.slice(0, 200)}`);
    }
    if (side === "new") {
      c.newHeaders = {
        ignored: r.headers.get("x-metrics-ignored-filters"),
        capped: r.headers.get("x-metrics-period-capped"),
        from: r.headers.get("x-metrics-period-from"),
        to: r.headers.get("x-metrics-period-to"),
        scope: r.headers.get("x-metrics-scope"),
      };
    }
    return r.json;
  };
}

const NEW_HTTP = Object.fromEntries(
  Object.keys(ROUTE_PATH).map((k) => [k, httpSide(k, NEW_API_BASE, "new")])
);

// ===========================================================================
// OLD-SIDE ADAPTERS
// ===========================================================================

const OLD_HTTP = Object.fromEntries(
  Object.keys(ROUTE_PATH).map((k) => [k, httpSide(k, OLD_API_BASE, "old")])
);

/** In-process old side. Only the five endpoints whose logic lives in
 *  MetricsService are reachable; the other three keep their SQL inline in the
 *  route file, and copying it here would compare the harness with itself. */
const OLD_DIRECT = {
  "tests/kpis": (c) =>
    MS.getKpiStatsFiltered(dbClient, isoOf(c, "startDate"), isoOf(c, "endDate"), c.searchParams),
  "tests/by-station": (c) =>
    MS.getStationStats(dbClient, isoOf(c, "startDate"), isoOf(c, "endDate"), {
      stationId: numParam(c, "testStationId"),
      stationTypeId: numParam(c, "testStationTypeId"),
      customerId: numParam(c, "customerId"),
      shipmentId: numParam(c, "shipmentId"),
      itemSerial: c.searchParams.get("itemSerial") || undefined,
      itemTypeId: numParam(c, "itemTypeId"),
      workerId: numParam(c, "workerId"),
      showAllHistory: c.searchParams.get("showAllHistory") === "true",
    }).then((rows) =>
      rows.map((s) => ({
        stationId: s.stationId,
        stationName: s.stationName,
        stationTypeName: s.stationTypeName,
        itemsInQueue: s.itemsInQueue,
        itemsInTest: s.itemsInTest,
        averageCurrentQueueTimeMinutes: s.averageCurrentQueueTimeMinutes,
        totalProcessedInPeriod: s.totalProcessedInPeriod,
      }))
    ),
  "tests/status-distribution": (c) =>
    MS.getStatusDistributionFiltered(dbClient, isoOf(c, "startDate"), isoOf(c, "endDate"), c.searchParams),
  "tests/item-types": (c) => MS.getItemTypeStatsFiltered(dbClient, c.searchParams),
  "tests/customer-performance": (c) =>
    MS.getCustomerPerformance(dbClient, isoOf(c, "startDate"), isoOf(c, "endDate"), {
      itemSerial: c.searchParams.get("itemSerial") || undefined,
      itemTypeId: numParam(c, "itemTypeId"),
      shipmentId: numParam(c, "shipmentId"),
      testStationId: numParam(c, "testStationId"),
      testStationTypeId: numParam(c, "testStationTypeId"),
      showAllHistory: c.searchParams.get("showAllHistory") === "true",
    }),
};

const DIRECT_UNAVAILABLE =
  "old side lives inline in the route handler, not in MetricsService — run with --old http";

function isoOf(c, key) {
  return c.searchParams.get(key);
}
function numParam(c, key) {
  const v = c.searchParams.get(key);
  return v && !Number.isNaN(Number(v)) ? parseInt(v, 10) : undefined;
}

/** Flatten one status-distribution/history response into comparable rows: the
 *  per-day scalars, and one row per (day, status). Comparing the raw objects
 *  would reduce `statuses` to "[object Object]" and pass every time. */
function expandStatusHistory(res) {
  if (!Array.isArray(res)) return [];
  const out = [];
  for (const p of res) {
    const day = String(p.date).slice(0, 10);
    // The per-day scalars, INCLUDING the §5.3ב additions. They used to be
    // dropped here, which put them beyond every rule compareRow applies — the
    // same blind spot finding #1 lived in.
    //
    // The keys are only SET when the side actually carries them. Writing them
    // unconditionally put `finishedCumulative: undefined` on the old row, and
    // compareRow keys "is this new-only?" off key PRESENCE — so three fields the
    // old endpoint has never had were graded as DIFFERS (old `-` vs new 607)
    // and the whole run went RED on the harness's own bookkeeping. A key the
    // source object does not have must not be conjured here.
    const dayRow = { __key: `${day}:_day`, date: day, isToday: p.isToday === true };
    for (const k of ["finishedCumulative", "_new_finishedToday", "_new_activeTotal"]) {
      if (k in p) dayRow[k] = p[k];
    }
    out.push(dayRow);
    for (const st of p.statuses || []) {
      out.push({ __key: `${day}:${st.status}`, ...st });
    }
  }
  return out;
}

const ENDPOINTS = [
  { name: "tests/kpis", shape: "object" },
  { name: "tests/by-station", shape: "array", key: (r) => r.stationId },
  { name: "tests/status-distribution", shape: "array", key: (r) => String(r.status) },
  { name: "tests/shipments", shape: "array", key: (r) => r.shipmentId },
  { name: "tests/item-types", shape: "array", key: (r) => r.itemTypeId },
  { name: "tests/customer-performance", shape: "array", key: (r) => r.customerId },
  { name: "tests/slow-items", shape: "array", key: (r) => `${r.itemId}:${r.routeStep}` },
  { name: "tests/average-times", shape: "array", key: (r) => String(r.date).slice(0, 10) },
  // Converted in stage 5 as well; the old side reads the snapshot tables, which
  // are empty on this database — the comparison is therefore about the ONE day
  // both sides emit (today, which the old route computes live) and about the
  // row set, not about thirteen months of numbers that only one side has.
  {
    name: "tests/status-distribution/history",
    shape: "array",
    httpOnly: true,
    expand: expandStatusHistory,
    key: (r) => r.__key,
  },
  { name: "stats/completion-history", shape: "array", httpOnly: true, key: (r) => String(r.date).slice(0, 10) },
];

// ===========================================================================
// THE PATH-PARAMETER ENDPOINTS — the four [id]/history routes (§8 stage 6)
// ===========================================================================
//
// The stage-6 conversions are shaped differently from the ten above in two ways
// the matrix could not express until now.
//
// 1. THEY TAKE AN ID IN THE PATH. A case is (endpoint x id x preset), and the
//    ids are SAMPLED FROM THE DATABASE at startup rather than hardcoded: the
//    BUSIEST entity, because it exercises the most rows, and one with NO ledger
//    data at all, because "an entity with nothing to show" is the case that used
//    to answer an empty array, and it is the one a zero-fill bug hides in. The
//    filter combinations of the main matrix do not apply — these routes take
//    their subject from the path and pin `scope` to the constant `all` (§5.0(1))
//    — so the presets the dialogs actually send are the whole window axis.
//
// 2. THERE IS NOTHING TO DIFF THEM AGAINST, and this harness does not invent a
//    comparison to look thorough. Stated plainly, the old sides are:
//
//      customers/[id]/history  reads customer_snapshots{,_monthly}
//      shipments/[id]/history  reads shipment_snapshots{,_monthly}
//      stations/[id]/history   reads station_snapshots{,_monthly}
//          — all three hold 0 rows on this database (they were written by a
//            date-less function that stored NOW() under a past date), and each
//            route then appends ONE live point counted off item_routes. The old
//            response is therefore a single element labelled "today". Diffing
//            13 months of daily series against one row would stamp ~395 days
//            "only-on-new" and grade one number: noise dressed as a comparison.
//      item-types/[id]/history raises 42703 on EVERY request — its "today"
//            query joins `shipments.item_type_id`, a column that has never
//            existed — and answers HTTP 500. There is no old number at all.
//
//    So these four are graded on the NEW side's INVARIANTS, and the report says
//    so on every run. The invariants are the properties the old shape could not
//    have had, and they are exactly the ones a silent regression would break:
//
//      http-200        including for an entity with no data (the item-type
//                      route's permanent 500 is the bug being fixed)
//      full-series     one row per civil day of the window the headers report —
//                      not one row, and not "only the days something happened"
//      contiguous      day N is the day after day N-1, computed as civil dates,
//                      so a DST boundary cannot drop or duplicate one (§7.2)
//      today-once      exactly one row carries isToday, and it is the last one
//      cap-reported    the 13-month cap (§6.3) moves `from` to the cap floor AND
//                      sets X-Metrics-Period-Capped; a preset inside the cap
//                      sets neither
//      scope-all       X-Metrics-Scope is `all` — a history must not rewrite
//                      itself the day a shipment is despatched (§5.0(1))
//      zero-filled     the no-data id returns the SAME field set as the busy
//                      one, with counts at 0 and durations at null — never an
//                      empty array, never a missing key, and never a 0 standing
//                      in for "not measured" (§5.0(7))
//      plus the same `_new_` contract the diffed endpoints get: no field null in
//      every case of the matrix, every *Wall* paired with its *Work*, and the
//      work clock never past the wall clock (§2.8).

const PATH_ENDPOINTS = [
  {
    name: "customers/[id]/history",
    path: (id) => `/api/dashboard/customers/${id}/history`,
    oldSide:
      "old reads customer_snapshots{,_monthly} (0 rows here) and appends one live point — a one-element 'history'. No diff is possible; the new side is graded on its invariants.",
    busiest: "SELECT customer_id AS v FROM route_run GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
    empty:
      "SELECT c.id AS v FROM customers c WHERE NOT EXISTS (SELECT 1 FROM route_run rr WHERE rr.customer_id = c.id) ORDER BY c.id LIMIT 1",
    emptyFallback: "SELECT COALESCE(max(id), 0) + 1000 AS v FROM customers",
  },
  {
    name: "shipments/[id]/history",
    path: (id) => `/api/dashboard/shipments/${id}/history`,
    oldSide:
      "old reads shipment_snapshots{,_monthly} (0 rows here) plus one live point whose completionPercentage divides by shipments.amount, a stock number §5.8 forbids. No diff is possible.",
    busiest: "SELECT shipment_id AS v FROM route_run GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
    empty:
      "SELECT s.id AS v FROM shipments s WHERE NOT EXISTS (SELECT 1 FROM route_run rr WHERE rr.shipment_id = s.id) ORDER BY s.id LIMIT 1",
    emptyFallback: "SELECT COALESCE(max(id), 0) + 1000 AS v FROM shipments",
  },
  {
    name: "item-types/[id]/history",
    path: (id) => `/api/dashboard/item-types/${id}/history`,
    oldSide:
      "old raises 42703 on EVERY request (it joins shipments.item_type_id, a column that has never existed) and answers HTTP 500. There is no old number to compare — the invariants ARE the fix.",
    busiest: "SELECT item_type_id AS v FROM route_run GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
    empty:
      "SELECT it.item_type_id AS v FROM item_types it WHERE NOT EXISTS (SELECT 1 FROM route_run rr WHERE rr.item_type_id = it.item_type_id) ORDER BY it.item_type_id LIMIT 1",
    emptyFallback: "SELECT COALESCE(max(item_type_id), 0) + 1000 AS v FROM item_types",
  },
  {
    name: "stations/[id]/history",
    path: (id) => `/api/dashboard/stations/${id}/history`,
    oldSide:
      "old reads station_snapshots{,_monthly} (0 rows here) plus one live point whose averageQueueTime is AVG(now() - queue_start_time) over the CURRENT queue — a state metric plotted as a flow metric (§5.0(3)). No diff is possible.",
    busiest:
      "SELECT station_id AS v FROM item_state_interval WHERE station_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
    empty:
      "SELECT ts.test_station_id AS v FROM test_stations ts WHERE NOT EXISTS (SELECT 1 FROM item_state_interval i WHERE i.station_id = ts.test_station_id) ORDER BY ts.test_station_id LIMIT 1",
    // A station id that does not exist is a 404 by design, not a zero series, so
    // there is no synthetic fallback here: if every station has data, the
    // no-data case is reported as UNAVAILABLE rather than faked.
    emptyFallback: null,
  },
];

/** The three windows the dialogs' own picker offers (see requireDialogPeriod). */
const DIALOG_PRESETS = [
  { id: "alldays", qs: "period=alldays", capped: false },
  { id: "12months", qs: "period=12months", capped: false },
  { id: "3years", qs: "period=3years", capped: true },
];

/** endpoint name -> [{ id, kind }] discovered from the database. */
const PATH_IDS = {};

async function discoverPathIds() {
  for (const ep of PATH_ENDPOINTS) {
    const ids = [];
    const busiest = (await q1(ep.busiest))?.v ?? null;
    if (busiest !== null) ids.push({ id: busiest, kind: "busiest" });
    let empty = (await q1(ep.empty))?.v ?? null;
    let kind = "no-data";
    if (empty === null && ep.emptyFallback) {
      // Every row of these three tables is routed on this database, so the
      // "nothing to show" case is reached with an id that is not in the table at
      // all — the same thing to these routes (no rows either way), and exactly
      // what a stale dialog link sends.
      empty = (await q1(ep.emptyFallback))?.v ?? null;
      kind = "no-data(absent id)";
    }
    if (empty !== null) ids.push({ id: empty, kind });
    PATH_IDS[ep.name] = ids;
  }
}

/** One (id x preset) case list for a path endpoint. */
function buildPathCases(ep) {
  const cases = [];
  for (const { id, kind } of PATH_IDS[ep.name] || []) {
    for (const preset of DIALOG_PRESETS) {
      cases.push({ id: `${preset.id}/${kind}`, entityId: id, kind, preset });
    }
  }
  return cases;
}

/**
 * Grade one path endpoint on the NEW side's invariants. Returns the same shape
 * the diffed endpoints report, so main() can print and count it identically.
 */
async function runPathEndpoint(ep) {
  const observations = [];
  const issues = [];
  const caseErrors = [];
  const keysByPreset = new Map(); // preset -> the busiest id's field set
  const today = P.todayBusinessDay();
  const capFloor = P.addDays(P.addMonths(today, -P.UI_MONTH_CAP), 1);
  let ran = 0;

  for (const c of buildPathCases(ep)) {
    const url = `${ep.path(c.entityId)}?${c.preset.qs}`;
    let r;
    try {
      r = await httpGetRaw(url, NEW_API_BASE);
    } catch (e) {
      caseErrors.push({ case: c.id, side: "new", message: e.message });
      continue;
    }
    LATENCY.push({ endpoint: ep.name, side: "new", case: c.id, ms: r.ms, status: r.status });
    const push = (rule, detail) => issues.push({ case: c.id, id: c.entityId, rule, detail });

    if (r.status !== 200) {
      push("http-200", `${r.status} ${String(r.text).slice(0, 160)}`);
      continue;
    }
    const rows = r.json;
    if (!Array.isArray(rows)) {
      push("array", `answered ${typeof rows}`);
      continue;
    }
    ran++;

    // ---- the window the server says it queried ----------------------------
    const from = r.headers.get("x-metrics-period-from");
    const to = r.headers.get("x-metrics-period-to");
    const scope = r.headers.get("x-metrics-scope");
    const capped = r.headers.get("x-metrics-period-capped");
    if (!from || !to) {
      push("period-headers", "X-Metrics-Period-From/To missing — the caller cannot tell what window it got");
      continue;
    }
    if (scope !== "all") push("scope-all", `X-Metrics-Scope=${scope}; §5.0(1) pins a history endpoint to all`);
    if (c.preset.capped) {
      if (capped !== "true") push("cap-reported", `${c.preset.id} was not reported as capped`);
      if (from !== capFloor) push("cap-reported", `from=${from}, expected the cap floor ${capFloor}`);
    } else if (capped === "true") {
      push("cap-reported", `${c.preset.id} is inside the 13-month cap but was reported as capped`);
    }

    // ---- one row per civil day, in order ----------------------------------
    const expected = P.daysBetween(from, to);
    if (rows.length !== expected) {
      push("full-series", `${rows.length} row(s) for a ${expected}-day window ${from}..${to}`);
    }
    let broken = null;
    for (let i = 0; i < rows.length && broken === null; i++) {
      const want = P.addDays(from, i);
      const got = String(rows[i]?.date ?? "").slice(0, 10);
      if (got !== want) broken = `row ${i} is ${got}, expected ${want}`;
    }
    if (broken) push("contiguous", broken);

    const todayRows = rows.filter((x) => x?.isToday === true);
    if (to === today) {
      if (todayRows.length !== 1) push("today-once", `${todayRows.length} row(s) carry isToday`);
      else if (rows[rows.length - 1]?.isToday !== true) push("today-once", "isToday is not on the last row");
    } else if (todayRows.length !== 0) {
      push("today-once", `isToday on a window that does not reach today (${to})`);
    }

    // ---- the field set does not depend on whether there is data -----------
    const keys = Object.keys(rows[0] || {}).sort();
    if (c.kind === "busiest") {
      keysByPreset.set(c.preset.id, keys);
    } else {
      const busy = keysByPreset.get(c.preset.id);
      if (busy) {
        const missing = busy.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !busy.includes(k));
        if (missing.length || extra.length) {
          push(
            "zero-filled",
            `field set differs from the busy id: missing [${missing.join(", ")}] extra [${extra.join(", ")}]`
          );
        }
      }
      // Counts must be measured zeros and durations must be nulls — never a 0
      // standing in for "no measurement" (§5.0(7)).
      const wrong = [];
      for (const row of rows) {
        for (const [k, v] of Object.entries(row)) {
          if (k === "date" || k === "isToday") continue;
          const isDuration = /Min$|Minutes$|Seconds$/.test(k);
          if (isDuration ? v !== null : v !== 0) wrong.push(`${row.date}.${k}=${fmt(v)}`);
        }
      }
      if (wrong.length) {
        push("zero-filled", `${wrong.length} field(s) not zero/null, e.g. ${wrong.slice(0, 4).join(", ")}`);
      }
    }

    // ---- the shared _new_ contract (§2.8, and finding #1's rule) ----------
    for (const row of rows) {
      const out = [];
      checkNewContract(ep.name, row, out);
      for (const f of out) observations.push({ ...f, case: c.id });
    }
  }

  return { observations, issues, caseErrors, ran };
}

// ===========================================================================
// COMPARISON
// ===========================================================================

function normalise(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  // A Date is reduced to its ISO string and then, by the string branch below,
  // to its calendar day. The two sides read `timestamp without time zone`
  // through different drivers (Prisma treats it as UTC, node-postgres as local),
  // so comparing the instant would fail on a timezone artefact rather than on a
  // number the dashboard shows. Day granularity is what these fields render at.
  if (v instanceof Date) return normalise(v.toISOString());
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  if (typeof v === "string") {
    // A date-ish string from either side is compared as its calendar day; the
    // old endpoints stringify Dates in the process timezone.
    const m = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(v.trim());
    if (m) return m[1];
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n)) return n;
    return v.trim();
  }
  return v;
}

function sameValue(a, b) {
  const x = normalise(a);
  const y = normalise(b);
  if (x === y) return true;
  if (x === null || y === null || x === undefined || y === undefined) return false;
  if (typeof x === "number" && typeof y === "number") {
    const scale = Math.max(Math.abs(x), Math.abs(y), 1);
    return Math.abs(x - y) <= TOLERANCE * scale;
  }
  return String(x) === String(y);
}

function directionHolds(dir, oldV, newV) {
  if (!dir) return true;
  const o = normalise(oldV);
  const n = normalise(newV);
  if (typeof o !== "number" || typeof n !== "number") return true;
  if (dir === "higher-or-equal") return n >= o - TOLERANCE * Math.max(Math.abs(o), 1);
  if (dir === "lower-or-equal") return n <= o + TOLERANCE * Math.max(Math.abs(o), 1);
  return true;
}

/** Compare one old row against one new row, field by field. */
function compareRow(endpoint, oldRow, newRow, out) {
  const expected = EXPECTED[endpoint] || {};
  const oldKeys = Object.keys(oldRow || {});
  const newKeys = Object.keys(newRow || {}).filter((k) => !k.startsWith("_new_"));
  const newOnly = Object.keys(newRow || {}).filter((k) => k.startsWith("_new_"));

  for (const k of oldKeys) {
    const ov = oldRow[k];
    const nv = newRow ? newRow[k] : undefined;
    const exp = expected[k];
    if (nv === undefined && !(newRow && k in newRow)) {
      // Absent on the new side. That is only acceptable when §9.4 says so —
      // either the field is deleted outright, or it is conditional (isToday is
      // stamped on one bucket, and the old and new sides disagree about which
      // one that is). Everything else is a number a component reads and the
      // new implementation stopped producing.
      if (exp) out.push({ field: k, status: "EXPECTED", old: ov, new: undefined, reason: exp.reason });
      else out.push({ field: k, status: "MISSING_ON_NEW", old: ov, new: undefined, reason: null });
      continue;
    }
    if (sameValue(ov, nv)) {
      out.push({ field: k, status: "EQUAL", old: ov, new: nv, reason: exp ? exp.reason : null });
    } else if (exp) {
      out.push({
        field: k,
        status: directionHolds(exp.direction, ov, nv) ? "EXPECTED" : "EXPECTED_WRONG_DIRECTION",
        old: ov,
        new: nv,
        reason: exp.reason + (exp.direction ? ` [expected ${exp.direction}]` : ""),
      });
    } else {
      out.push({ field: k, status: "DIFFERS", old: ov, new: nv, reason: null });
    }
  }
  for (const k of newKeys) {
    if (!oldKeys.includes(k)) out.push({ field: k, status: "MISSING_ON_OLD", old: undefined, new: newRow[k], reason: null });
  }
  // ---- the _new_ contract (see NEW_NULLABLE above) ------------------------
  // Shared with the path-parameter endpoints below, which have no old side to
  // diff against and are graded on these three rules alone.
  checkNewContract(endpoint, newRow, out);
}

/**
 * The three things asserted about a field the old side never had, and about
 * every duration on the row (§2.8). Called from compareRow for the diffed
 * endpoints and from the path-parameter runner for the four `[id]/history`
 * routes, so the rules cannot drift apart between the two.
 */
function checkNewContract(endpoint, newRow, out) {
  const nullable = NEW_NULLABLE[endpoint] || {};
  const newOnly = Object.keys(newRow || {}).filter((k) => k.startsWith("_new_"));
  for (const k of newOnly) {
    const v = newRow[k];
    out.push({
      field: k,
      status: "NEW_ONLY",
      old: undefined,
      new: v,
      // Carried per-observation and rolled up in rollUp(): a field that is null
      // HERE is data; a field that is null in every case of the matrix is the
      // finding-#1 shape, and only rollUp can tell the two apart.
      isNull: v === null || v === undefined,
      nullable: nullable[k] ?? null,
      reason: nullable[k] ? `nullable — ${nullable[k]}` : "§2.8 / §5.10 addition",
    });
  }

  // §2.8 — a duration ships as a PAIR or it does not ship. Checked over the
  // whole row, `_new_` and legacy alike: the KPI card's queue wait is a pair
  // whose halves sit on either side of the prefix.
  const rowKeys = Object.keys(newRow || {});
  for (const k of rowKeys) {
    if (!/Wall/.test(k)) continue;
    const sib = workSiblingOf(k);
    if (!(sib in newRow)) {
      out.push({
        field: k,
        status: "NEW_UNPAIRED",
        old: undefined,
        new: newRow[k],
        reason: `§2.8 — no work-clock sibling: expected \`${sib}\` beside it`,
      });
      continue;
    }
    const wall = normalise(newRow[k]);
    const work = normalise(newRow[sib]);
    if (typeof wall === "number" && typeof work === "number" && work > wall + TOLERANCE * Math.max(Math.abs(wall), 1)) {
      out.push({
        field: k,
        status: "NEW_CLOCKS_CROSSED",
        old: undefined,
        new: newRow[k],
        reason: `§2.8 — the work clock ran past the wall clock: ${sib}=${work} > ${k}=${wall}`,
      });
    }
  }
}

function compare(endpoint, ep, oldRes, newRes) {
  const fields = [];
  const rowIssues = [];
  if (ep.shape === "object") {
    compareRow(endpoint, oldRes || {}, newRes || {}, fields);
    return { fields, rowIssues };
  }
  const oldRows = Array.isArray(oldRes) ? oldRes : [];
  const newRows = Array.isArray(newRes) ? newRes : [];
  const oldByKey = new Map(oldRows.map((r) => [String(ep.key(r)), r]));
  const newByKey = new Map(newRows.map((r) => [String(ep.key(r)), r]));
  for (const [k, oRow] of oldByKey) {
    const nRow = newByKey.get(k);
    if (!nRow) {
      rowIssues.push({ key: k, side: "only-on-old" });
      continue;
    }
    compareRow(endpoint, oRow, nRow, fields);
  }
  for (const k of newByKey.keys()) if (!oldByKey.has(k)) rowIssues.push({ key: k, side: "only-on-new" });
  return { fields, rowIssues };
}

/** Roll every field observation for one endpoint up into one verdict per field. */
function rollUp(observations) {
  const byField = new Map();
  for (const o of observations) {
    let e = byField.get(o.field);
    if (!e) {
      e = { field: o.field, statuses: new Set(), samples: [] };
      byField.set(o.field, e);
    }
    e.statuses.add(o.status);
    if (o.status !== "EQUAL" && e.samples.length < 3) e.samples.push(o);
    if (o.reason && !e.reason) e.reason = o.reason;
    // The null tally is what separates "no research happened under THIS filter"
    // from "this field can never be anything but null".
    if (o.status === "NEW_ONLY") {
      e.newSeen = (e.newSeen ?? 0) + 1;
      if (o.isNull) e.newNull = (e.newNull ?? 0) + 1;
      if (o.nullable) e.nullable = o.nullable;
    }
  }
  return [...byField.values()].map((e) => {
    const s = e.statuses;
    // A `_new_` field that came back null in EVERY case of the matrix, and is
    // not on the NEW_NULLABLE list, is the finding-#1 shape: a number the
    // conversion stopped producing at all. One non-null case anywhere clears it.
    const alwaysNull = e.newSeen > 0 && e.newNull === e.newSeen && !e.nullable;
    const verdict = s.has("EXPECTED_WRONG_DIRECTION")
      ? "EXPECTED_WRONG_DIRECTION"
      : s.has("DIFFERS")
        ? "DIFFERS"
        : s.has("NEW_CLOCKS_CROSSED")
          ? "NEW_CLOCKS_CROSSED"
          : s.has("NEW_UNPAIRED")
            ? "NEW_UNPAIRED"
            : s.has("MISSING_ON_NEW")
              ? "MISSING_ON_NEW"
              : alwaysNull
                ? "NEW_ALWAYS_NULL"
                : s.has("MISSING_ON_OLD")
                  ? "MISSING_ON_OLD"
                  : s.has("EXPECTED")
                    ? "EXPECTED"
                    : s.has("NEW_ONLY")
                      ? "NEW_ONLY"
                      : "EQUAL";
    if (verdict === "NEW_ALWAYS_NULL") {
      e.reason = `null in all ${e.newSeen} case(s) — either the query never fills it (finding #1) or it belongs in NEW_NULLABLE with a reason`;
    }
    return { ...e, statuses: [...s], verdict };
  });
}

const MARK = {
  EQUAL: "=",
  EXPECTED: "~",
  DIFFERS: "X",
  MISSING_ON_NEW: "?",
  MISSING_ON_OLD: "+",
  NEW_ONLY: "+",
  EXPECTED_WRONG_DIRECTION: "X",
  NEW_ALWAYS_NULL: "N",
  NEW_UNPAIRED: "P",
  NEW_CLOCKS_CROSSED: "C",
};
const FAILING = new Set([
  "DIFFERS",
  "MISSING_ON_NEW",
  "EXPECTED_WRONG_DIRECTION",
  "NEW_ALWAYS_NULL",
  "NEW_UNPAIRED",
  "NEW_CLOCKS_CROSSED",
]);

function fmt(v) {
  if (v === undefined) return "-";
  if (v === null) return "null";
  const n = normalise(v);
  if (typeof n === "number") return Number.isInteger(n) ? String(n) : n.toFixed(4);
  return String(n).slice(0, 40);
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main() {
  await loadModules();

  const dbName = (() => {
    try {
      return new URL(DATABASE_URL).pathname.replace(/^\//, "");
    } catch {
      return "?";
    }
  })();

  console.log("=== dashboard parity harness (§9.3) ===");
  console.log(`database   : ${dbName} (sessions are default_transaction_read_only = on)`);
  console.log(`old side   : ${OLD_MODE}${OLD_MODE === "http" ? ` @ ${OLD_API_BASE}` : " (MetricsService, in-process)"}`);
  console.log(`new side   : http @ ${NEW_API_BASE} (the converted routes)`);
  console.log(`tolerance  : ${TOLERANCE}`);

  // A planner-statistics preflight, because it changes the answer by 15x and
  // nothing else will ever notice: metric_state holds 6 rows, which is below
  // autovacuum's analyze threshold, so it is never auto-analyzed. Without stats
  // Q2א's LEFT JOIN is planned as a merge join and the range predicate degrades
  // into a join filter — the §5.0(9) failure mode arriving by a different door.
  const stats = await q1(
    "SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = 'metric_state'"
  );
  if (stats && !stats.last_analyze && !stats.last_autoanalyze) {
    console.log(
      "WARNING    : metric_state has never been ANALYZEd. Run `ANALYZE metric_state;` — the\n" +
        "             point-in-time series is ~15x slower without it (measured 1,961ms -> 131ms)."
    );
  }

  await discoverFixtures();
  console.log(`fixtures   : ${JSON.stringify(FIXTURES.legacyStatus ? { ...FIXTURES, legacyStatus: undefined } : FIXTURES)}`);

  // The path-parameter endpoints sample their own ids — the busiest entity and
  // one with no ledger data at all. Discovered from the database for the same
  // reason the filter fixtures are: a hardcoded id silently selects nothing.
  await discoverPathIds();
  console.log(
    `path ids   : ${PATH_ENDPOINTS.map((e) => `${e.name.split("/")[0]}=[${(PATH_IDS[e.name] || []).map((x) => `${x.id} ${x.kind}`).join(", ")}]`).join("  ")}`
  );

  const cases = buildCases();
  console.log(`matrix     : ${PERIODS.length} windows x ${filterCombos().length} filters x ${SCOPES.length} scopes = ${cases.length} cases per endpoint\n`);

  if (LIST_CASES) {
    for (const c of cases) console.log(`  ${c.id}  ${c.searchParams}`);
    await pool.end();
    return;
  }

  // ALWAYS, not just for `--old http`. The new side is the converted routes over
  // HTTP in every mode now, and all fourteen dashboard routes are
  // withAuth(role:"manager") — IS_DEV bypasses the middleware but not withAuth.
  // While `--new impl` existed, `--old direct` needed no cookie and the mint was
  // conditional; leaving it that way answered 401 on all 132 cases of every
  // endpoint (measured) and called them harness errors.
  sessionCookie = await mintSession();

  const endpoints = ENDPOINTS.filter((e) => !ONLY_ENDPOINT || e.name === ONLY_ENDPOINT);
  const pathEndpoints = PATH_ENDPOINTS.filter((e) => !ONLY_ENDPOINT || e.name === ONLY_ENDPOINT);
  if (endpoints.length === 0 && pathEndpoints.length === 0) usage(`unknown --endpoint ${ONLY_ENDPOINT}`);

  const report = { database: dbName, oldMode: OLD_MODE, generatedAt: new Date().toISOString(), endpoints: [] };
  let failures = 0;
  let errors = 0;

  for (const ep of endpoints) {
    const oldImpl = (OLD_MODE === "http" ? OLD_HTTP : OLD_DIRECT)[ep.name];
    const newImpl = NEW_HTTP[ep.name];
    console.log(`\n${"=".repeat(78)}\n${ep.name}\n${"=".repeat(78)}`);
    if (!oldImpl) {
      console.log(`  SKIPPED — ${DIRECT_UNAVAILABLE}`);
      report.endpoints.push({ name: ep.name, skipped: DIRECT_UNAVAILABLE });
      continue;
    }
    if (!newImpl) {
      // ROUTE_PATH is the registry both sides read, so this can only fire for an
      // endpoint someone added to ENDPOINTS and nowhere else.
      const why = `no route path registered for ${ep.name} in ROUTE_PATH`;
      console.log(`  SKIPPED — ${why}`);
      report.endpoints.push({ name: ep.name, skipped: why });
      continue;
    }

    const observations = [];
    const rowIssues = [];
    const caseErrors = [];
    const expectedOldErrors = [];
    let ran = 0;

    for (const c of cases.filter((x) => !ONLY_CASE || x.id === ONLY_CASE)) {
      let oldRes, newRes;
      try {
        oldRes = await oldImpl(c);
      } catch (e) {
        const known = (EXPECTED_OLD_ERRORS[ep.name] || []).find((k) => k.match.test(e.message));
        if (known) expectedOldErrors.push({ case: c.id, message: e.message, reason: known.reason });
        else caseErrors.push({ case: c.id, side: "old", message: e.message });
        continue;
      }
      try {
        newRes = await newImpl(c);
      } catch (e) {
        caseErrors.push({ case: c.id, side: "new", message: e.message });
        continue;
      }
      const r = compare(ep.name, ep, ep.expand ? ep.expand(oldRes) : oldRes, ep.expand ? ep.expand(newRes) : newRes);
      for (const f of r.fields) observations.push({ ...f, case: c.id });
      for (const ri of r.rowIssues) rowIssues.push({ ...ri, case: c.id });
      ran++;
    }

    const rows = rollUp(observations);
    const width = Math.max(24, ...rows.map((r) => r.field.length));
    console.log(`  ${ran} case(s) compared\n`);
    console.log(`  ${"field".padEnd(width)}  verdict`);
    console.log(`  ${"-".repeat(width)}  ${"-".repeat(50)}`);
    for (const r of rows.sort((a, b) => a.field.localeCompare(b.field))) {
      if (!VERBOSE && r.verdict === "EQUAL") continue;
      console.log(`  ${MARK[r.verdict]} ${r.field.padEnd(width - 2)}  ${r.verdict}`);
      if (r.reason) console.log(`  ${" ".repeat(width)}    ${r.reason}`);
      for (const s of r.samples) {
        console.log(`  ${" ".repeat(width)}    [${s.case}] old=${fmt(s.old)}  new=${fmt(s.new)}`);
      }
    }
    const equalCount = rows.filter((r) => r.verdict === "EQUAL").length;
    if (!VERBOSE && equalCount) console.log(`  = ${equalCount} field(s) match exactly (use --verbose to list)`);

    // row-set differences
    if (rowIssues.length) {
      const allowed = ROWSET_MAY_DIFFER[ep.name];
      const uniq = [...new Set(rowIssues.map((r) => `${r.side} ${r.key}`))];
      console.log(`\n  row-set: ${uniq.length} key(s) present on one side only`);
      console.log(`    ${uniq.slice(0, 8).join(", ")}${uniq.length > 8 ? ` … (+${uniq.length - 8})` : ""}`);
      if (allowed) console.log(`    ~ EXPECTED — ${allowed}`);
      else {
        console.log("    X unexplained row-set difference");
        failures++;
      }
    }

    if (expectedOldErrors.length) {
      console.log(`
  ~ old side raised on ${expectedOldErrors.length} case(s) — EXPECTED`);
      console.log(`    ${expectedOldErrors[0].reason}`);
      console.log(`    cases: ${expectedOldErrors.map((e) => e.case).join(", ")}`);
    }

    if (caseErrors.length) {
      console.log(`\n  ERRORS (${caseErrors.length}):`);
      for (const e of caseErrors.slice(0, 6)) console.log(`    [${e.case}] ${e.side}: ${e.message}`);
      errors += caseErrors.length;
    }

    const bad = rows.filter((r) => FAILING.has(r.verdict));
    failures += bad.length;
    report.endpoints.push({
      name: ep.name,
      casesCompared: ran,
      fields: rows.map((r) => ({ field: r.field, verdict: r.verdict, reason: r.reason || null, samples: r.samples })),
      rowIssues,
      errors: caseErrors,
      expectedOldErrors,
    });
  }

  // =========================================================================
  // The four [id]/history routes — invariants, because a diff is impossible
  // =========================================================================
  for (const ep of pathEndpoints) {
    console.log(`\n${"=".repeat(78)}\n${ep.name}\n${"=".repeat(78)}`);
    console.log(`  NO OLD-VS-NEW DIFF. ${ep.oldSide}`);
    const ids = PATH_IDS[ep.name] || [];
    console.log(`  ids        : ${ids.map((x) => `${x.id} (${x.kind})`).join(", ") || "NONE DISCOVERED"}`);
    if (!ids.some((x) => x.kind.startsWith("no-data"))) {
      // Named, not hidden: an unchecked invariant is not a passing one.
      console.log(
        "  NOTE       : no zero-data id exists on this database, so the zero-fill invariant is UNCHECKED here"
      );
    }

    const { observations, issues, caseErrors, ran } = await runPathEndpoint(ep);
    console.log(`  ${ran} case(s) checked (${DIALOG_PRESETS.length} preset(s) x ${ids.length} id(s))\n`);

    const rows = rollUp(observations);
    const width = Math.max(24, ...rows.map((r) => r.field.length), 24);
    for (const r of rows.sort((a, b) => a.field.localeCompare(b.field))) {
      if (!VERBOSE && r.verdict === "NEW_ONLY") continue;
      console.log(`  ${MARK[r.verdict]} ${r.field.padEnd(width - 2)}  ${r.verdict}`);
      if (r.reason) console.log(`  ${" ".repeat(width)}    ${r.reason}`);
      for (const smp of r.samples) console.log(`  ${" ".repeat(width)}    [${smp.case}] new=${fmt(smp.new)}`);
    }
    const okFields = rows.filter((r) => r.verdict === "NEW_ONLY").length;
    if (!VERBOSE && okFields) console.log(`  + ${okFields} _new_ field(s) present and not always-null (use --verbose to list)`);

    // One line per BROKEN invariant, with the first cases that broke it.
    const byRule = new Map();
    for (const i of issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push(i);
    }
    if (byRule.size === 0) console.log(`  = every invariant holds on all ${ran} case(s)`);
    for (const [rule, list] of byRule) {
      console.log(`  X ${rule.padEnd(width - 2)}  INVARIANT_BROKEN (${list.length} case(s))`);
      for (const i of list.slice(0, 3)) console.log(`  ${" ".repeat(width)}    [${i.case}] id=${i.id} ${i.detail}`);
    }
    const bad = rows.filter((r) => FAILING.has(r.verdict)).length + byRule.size;
    failures += bad;

    if (caseErrors.length) {
      console.log(`\n  ERRORS (${caseErrors.length}):`);
      for (const e of caseErrors.slice(0, 6)) console.log(`    [${e.case}] ${e.side}: ${e.message}`);
      errors += caseErrors.length;
    }

    report.endpoints.push({
      name: ep.name,
      mode: "invariants-only",
      whyNoDiff: ep.oldSide,
      ids,
      casesChecked: ran,
      fields: rows.map((r) => ({ field: r.field, verdict: r.verdict, reason: r.reason || null, samples: r.samples })),
      invariantIssues: issues,
      errors: caseErrors,
    });
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`unexplained field/row differences: ${failures}`);
  console.log(`errors: ${errors}`);
  console.log(failures === 0 && errors === 0 ? "PARITY: GREEN (every difference is on the §9.4 list)" : "PARITY: RED");

  // §6.4 — the measurable contingency trigger is p95 > 2s. Recorded per
  // endpoint at every window, so the 13-month row (the UI cap, §6.3) can be
  // read off directly.
  if (LATENCY.length) {
    const pct = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : null);
    const groups = new Map();
    for (const l of LATENCY) {
      const k = `${l.side}	${l.endpoint}	${l.case.split("/")[0]}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l.ms);
    }
    console.log(`
latency (ms) — n / p50 / p95 / max, by side x endpoint x window`);
    const rows = [...groups.entries()].map(([k, v]) => {
      const [side, endpoint, win] = k.split("	");
      return { side, endpoint, win, n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), max: Math.max(...v) };
    });
    rows.sort((a, b) => b.p95 - a.p95);
    for (const r of rows) {
      console.log(`  ${r.side.padEnd(4)} ${r.endpoint.padEnd(38)} ${r.win.padEnd(6)} n=${String(r.n).padStart(3)}  p50=${String(r.p50).padStart(6)}  p95=${String(r.p95).padStart(6)}  max=${String(r.max).padStart(6)}`);
    }
    report.latency = rows;
    report.latencyRaw = LATENCY;
  }

  if (JSON_OUT) {
    require("fs").writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`json written to ${JSON_OUT}`);
  }

  await pool.end();
  process.exit(failures === 0 && errors === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nFATAL:", e && e.stack ? e.stack : e);
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
