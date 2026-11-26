// Fill a DEVELOPMENT database with a year of realistic BOX-MODEL activity for
// the management dashboard (/dashboard/tests): shipments arriving, boxes taken
// in, opened as a group at the package-level opening station, their items
// walked through the item-level stations (with research detours, released and
// stale-reaped tests), the box waiting for its items, the group closing test,
// and the shipment sent back. Everything up to NOW, so the live board shows a
// real pipeline: boxes not yet taken in, waiting at opening, items mid-route,
// tests running right now, boxes waiting for their items, boxes in the chamber,
// finished boxes waiting to leave.
//
//   node scripts/dev/seed-dashboard-demo.mjs --confirm --reset \
//        --database-url postgresql://USER:PASS@localhost:5432/testingsite_demo \
//        [--parity-url postgresql://USER:PASS@localhost:5432/testingsite_pkgtest]
//
// Options: --months N (default 12) · --boxes-per-month N (default 70) · --seed N
//
// Afterwards run the three scheduled jobs once (POST /api/cron/{release-stale-tests,
// rebuild-work-calendar,metrics-selfcheck} with x-cron-secret) — --reset empties
// job_run, and the dashboard alerts on jobs that never ran.
//
// WHY DB-DIRECT. The ledger never trusts a client clock: metrics_record()
// stamps clock_timestamp(), so the API can only ever write "now". History is
// therefore written as item_state_event rows with explicit occurred_at, in
// chronological order, and the AFTER INSERT trigger (isi_apply_one) folds them
// into item_state_interval exactly as it does for live traffic — the ledger's
// EXCLUDE constraint aborts the whole run on a wrong sequence.
//
// WHERE THE SHAPES COME FROM. Every event this script writes copies a shape the
// live system writes for the package model (group start / group release at a
// package-level station, package_items_pending / package_items_ready, the two
// station_reassigned notes of an advance, the queued+done pair of a final
// result, research send / return). --parity-url compares every generated
// (reason, kind, state, seq, station?, type?, worker?, submit?, key format,
// payload keys) signature with the events of a database the real app wrote, and
// reports any shape the real system never produced.
//
// TIME. Queue waits advance along work_span (the calendar the ledger itself
// uses), so they straddle nights and weekends and work_seconds < wall_seconds.
// Bench time is WALL time bounded by each station type's stale_after_minutes —
// a test longer than that could not exist, the reaper would have reverted it.
//
// SAFETY. --confirm is mandatory. Refuses production-looking names and the live
// "testingsite" DB. Refuses a DB that already has items unless --reset, which
// TRUNCATEs the transactional + ledger tables listed in RESET_TABLES only.
// Reference data (stations, routes, package types, calendar, templates) is read,
// never changed — except customers whose code cannot be minted into a box id
// (3 digits, no leading 0), which get one.
// Station and type names are never written here: everything is read from the DB.

import crypto from "node:crypto";
import pg from "pg";

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const flag = (n) => argv.includes("--" + n);

const CONFIRM = flag("confirm");
const RESET = flag("reset");
const MONTHS = parseInt(arg("months", "12"), 10);
const BOXES_PER_MONTH = parseInt(arg("boxes-per-month", "70"), 10);
const SEED = parseInt(arg("seed", "20261126"), 10);
const DATABASE_URL = arg("database-url", process.env.DATABASE_URL || "");
const PARITY_URL = arg("parity-url", "");

function die(msg) { console.error("\n" + msg + "\n"); process.exit(2); }
if (!CONFIRM) die("refusing to run without --confirm (see the header of this file)");
if (!DATABASE_URL) die("no target database: pass --database-url or set DATABASE_URL");
const DB_NAME = (() => { try { return new URL(DATABASE_URL).pathname.replace(/^\//, ""); } catch { return ""; } })();
if (!DB_NAME) die("cannot parse a database name out of the URL");
if (/(^|[^a-z])(prod|production|inventorydb)([^a-z]|$)/i.test(DB_NAME) || DB_NAME === "testingsite") {
  die(`refusing to seed "${DB_NAME}" — use a dedicated demo database`);
}
if (!(MONTHS >= 1 && MONTHS <= 24)) die("--months must be 1..24");
if (!(BOXES_PER_MONTH >= 1 && BOXES_PER_MONTH <= 400)) die("--boxes-per-month must be 1..400");

// ---- deterministic RNG (mulberry32) ----------------------------------------
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
function weighted(items, weightOf) {
  const total = items.reduce((a, x) => a + weightOf(x), 0);
  let r = rnd() * total;
  for (const x of items) { r -= weightOf(x); if (r <= 0) return x; }
  return items[items.length - 1];
}
// uuids drawn from the seeded RNG, so the same --seed gives the same keys
function uuid() {
  const b = Array.from({ length: 16 }, () => rint(0, 255));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- people and wording ------------------------------------------------------
const TESTERS = [
  { id: 4101, name: "אורי בן-דוד" }, { id: 4102, name: "נועה שגב" },
  { id: 4103, name: "רם אזולאי" }, { id: 4104, name: "מיכל בר-ששת" },
  { id: 4105, name: "יונתן כהן" }, { id: 4106, name: "שירה מזרחי" },
  { id: 4107, name: "אבי לוגסי" }, { id: 4108, name: "תמר גולן" },
];
const STOREKEEPERS = [
  { id: 4201, name: "דנה פרץ" }, { id: 4202, name: "עומר שלו" }, { id: 4203, name: "ליאת אדרי" },
];
const DEMO_CUSTOMERS = [
  { name: "מפעלי רדאר צפון", weight: 1.5 },
  { name: "תעופה וחלל בעמ", weight: 1.1 },
  { name: "מערכות ים תיכון", weight: 0.8 },
  { name: "אלקטרוניקה הרצליה", weight: 0.6 },
];
const FREE_CODES = ["410", "520", "630", "740", "850", "960"];
const MANUFACTURERS = ["Rohde", "Tadiran", "Elbit", "Aeronautics", "Elta"];
const MODELS = ["RX-220", "PA-90", "PSU-12", "CTRL-7", "ANT-45", "VHF-3000"];
const COMMENTS_PASS = ["עבר בדיקה מלאה", "תקין ללא ממצאים", "נבדק לפי נוהל 12", "כויל ונמצא תקין"];
const COMMENTS_FAIL = ["חריגה בהספק המוצא", "רעש מוגבר בכניסה", "מחבר פגום", "סטייה בתדר הנשא"];
const COMMENTS_FIXED = ["הוחלף רכיב ונבדק שוב", "תוקן מחבר, חוזר למסלול", "בוצע כיול מחדש"];
const RESEARCH_NOTES = ["נפתחה יחידה לבדיקת מעגל", "בוצעה מדידה במחולל", "ממתין לחלף מהמחסן", "נמצא כשל ברכיב"];
// Monthly volume shape (Jan..Dec): holiday months are quieter.
const SEASON = [1.0, 1.05, 1.1, 0.8, 1.1, 1.15, 1.0, 0.85, 0.9, 0.75, 1.15, 0.95];

// ---- time (microseconds since epoch, as plain numbers) ----------------------
const US_S = 1e6, US_MIN = 60e6, H = 3600;
const NOW = Date.now() * 1000;
function usToIso(us) {
  us = Math.round(us);
  const iso = new Date(Math.floor(us / 1000)).toISOString();
  return iso.slice(0, 23) + String(((us % 1000) + 1000) % 1000).padStart(3, "0") + "Z";
}
const LOCAL_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
function localDate(us) {
  const p = Object.fromEntries(LOCAL_FMT.formatToParts(new Date(us / 1000)).map((x) => [x.type, x.value]));
  return { datePart: `${p.day}${p.month}${p.year.slice(-2)}`, dateKey: `${p.year}-${p.month}-${p.day}` };
}

let ladder = [];
function spanIndexEndingAfter(us) {
  let lo = 0, hi = ladder.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ladder[mid].hi > us) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  return ans;
}
function workOffsetOf(us) {
  const i = spanIndexEndingAfter(us);
  if (i < 0) { const l = ladder[ladder.length - 1]; return l.cum + (l.hi - l.lo); }
  return ladder[i].cum + Math.max(0, us - ladder[i].lo);
}
function instantAtWorkOffset(off) {
  let lo = 0, hi = ladder.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ladder[mid].cum <= off) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  if (ans < 0) return null;
  const s = ladder[ans], t = s.lo + (off - s.cum);
  if (t < s.hi) return t;
  return ans + 1 < ladder.length ? ladder[ans + 1].lo : null;
}
/** `secs` of WORKING time after `us` — nights, weekends and holidays skipped. */
const addWork = (us, secs) => instantAtWorkOffset(workOffsetOf(us) + Math.round(secs * US_S));
function randomWorkInstant(fromUs, toUs) {
  const first = spanIndexEndingAfter(fromUs);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < ladder.length && ladder[last + 1].lo < toUs) last++;
  const i = rint(first, last);
  const lo = Math.max(ladder[i].lo, fromUs), hi = Math.min(ladder[i].hi, toUs);
  if (hi - lo < US_MIN) return lo;
  return lo + Math.floor(rnd() * (hi - lo - US_MIN));
}
/** A bench needs `roomSecs` of unbroken shift; if this shift ends first the work starts next shift. */
function placeStart(us, roomSecs) {
  const si = spanIndexEndingAfter(us);
  if (si < 0) return null;
  const start = Math.max(us, ladder[si].lo);
  const need = roomSecs * US_S;
  if (need > ladder[si].hi - ladder[si].lo) return start;
  if (start + need > ladder[si].hi) return si + 1 < ladder.length ? ladder[si + 1].lo + rint(0, 20) * US_MIN : null;
  return start;
}
/** Where a run of `durSecs` WALL seconds ends. A long run's result is typed in by a person, so it snaps to
 *  the next working hours — but never past the type's stale threshold (the reaper would have taken it). */
function finishAt(start, durSecs, capSecs, snap) {
  let end = start + durSecs * US_S;
  if (!snap) return Math.round(end);
  const si = spanIndexEndingAfter(end);
  if (si < 0) return Math.round(end);
  const snapped = Math.max(end, ladder[si].lo);
  if (capSecs === 0 || snapped - start <= capSecs * US_S) return Math.round(snapped);
  // The next shift is too far (a weekend): this run was cut to end inside its own shift.
  const s0 = spanIndexEndingAfter(start);
  const latest = ladder[s0].hi - rint(5, 30) * US_MIN;
  return Math.round(Math.max(start + 45 * US_MIN, Math.min(end, latest)));
}

// ---- durations ---------------------------------------------------------------
let ref; // filled by loadReference
const staleSecs = (typeId) => (ref.stationTypes.get(typeId)?.stale ?? 30) * 60;
const isReapable = (typeId) => staleSecs(typeId) > 0;
let progress = 0; // 0 at the start of history, 1 now — queues shorten as the floor improves
function queueWait(typeId) {
  const r = rnd();
  const base = r < 0.6 ? rint(10 * 60, 3 * H) : r < 0.9 ? rint(3 * H, 12 * H) : rint(12 * H, 30 * H);
  const role = ref.queueFactor.get(typeId) ?? 1;
  return Math.round(base * role * (1.25 - 0.45 * progress));
}
function testDuration(typeId) {
  const cap = staleSecs(typeId);
  if (cap === 0) return rint(2 * H, 30 * H);
  if (cap <= 60 * 60) return rint(4 * 60, cap - 3 * 60);
  if (cap <= 6 * H) return chance(0.35) ? rint(40 * 60, cap - 10 * 60) : rint(8 * 60, 40 * 60);
  return rint(2 * H, Math.min(18 * H, cap - H)); // a chamber-length run
}
const releaseDuration = (typeId) => {
  const cap = staleSecs(typeId);
  return rint(2 * 60, Math.max(3 * 60, cap === 0 ? 25 * 60 : Math.min(25 * 60, cap - 5 * 60)));
};
const researchWait = () => rint(1 * H, 16 * H);

// ---- reference data ------------------------------------------------------------
async function loadReference(client) {
  const spans = await client.query(
    `SELECT lower(span) AS lo, upper(span) AS hi FROM work_span
      WHERE calendar_version = current_calendar_version() ORDER BY lower(span)`);
  let acc = 0;
  ladder = spans.rows.map((r) => {
    const s = { lo: new Date(r.lo).getTime() * 1000, hi: new Date(r.hi).getTime() * 1000 };
    s.cum = acc; acc += s.hi - s.lo; return s;
  });
  if (!ladder.length) die("work_span is empty — run the work-calendar rebuild first");

  const stationTypes = new Map((await client.query(
    `SELECT test_station_type_id AS id, package_level, stale_after_minutes AS stale FROM test_stations_type`)).rows
    .map((r) => [r.id, { id: r.id, packageLevel: r.package_level, stale: r.stale }]));
  const stations = (await client.query(
    `SELECT test_station_id AS id, test_station_type_id AS "typeId", is_research FROM test_stations
      WHERE status <> 3 ORDER BY test_station_id`)).rows;
  const stationsByType = new Map();
  for (const s of stations.filter((x) => !x.is_research)) {
    if (!stationsByType.has(s.typeId)) stationsByType.set(s.typeId, []);
    stationsByType.get(s.typeId).push(s);
  }
  const researchStations = stations.filter((x) => x.is_research);
  const researchType = researchStations[0]?.typeId ?? null;

  const routes = new Map();
  for (const r of (await client.query(`SELECT item_type_id, route_number, route_steps FROM testing_routes`)).rows) {
    routes.set(`${r.item_type_id}:${r.route_number}`, r.route_steps);
  }
  const typeRows = (await client.query(
    `SELECT item_type_id AS id, is_package, COALESCE(default_route_number, 1) AS rn FROM item_types`)).rows;
  const contentRows = (await client.query(
    `SELECT package_type_id, item_type_id, quantity, route_number, makat, sort_order
       FROM package_contents ORDER BY package_type_id, sort_order`)).rows;

  const packageTypes = [];
  const skipped = [];
  for (const t of typeRows.filter((x) => x.is_package)) {
    const steps = routes.get(`${t.id}:${t.rn}`);
    const kids = contentRows.filter((c) => c.package_type_id === t.id);
    const why = (() => {
      if (!steps || steps.length !== 2) return "box route is not [opening, closing]";
      if (!steps.every((s) => stationTypes.get(s)?.packageLevel)) return "box route steps are not package-level";
      if (!steps.every((s) => stationsByType.get(s)?.length)) return "no active station for a box step";
      if (!kids.length) return "no contents template";
      for (const k of kids) {
        const ks = routes.get(`${k.item_type_id}:${k.route_number}`);
        if (!ks || ks.length < 3) return `content type ${k.item_type_id} has no item-level steps`;
        if (ks[0] !== steps[0] || ks[ks.length - 1] !== steps[1]) return `content type ${k.item_type_id} route does not start/end with the box`;
        if (!ks.slice(1, -1).every((s) => stationsByType.get(s)?.length && !stationTypes.get(s)?.packageLevel)) {
          return `content type ${k.item_type_id} has a middle step with no active item-level station`;
        }
      }
      return null;
    })();
    if (why) { skipped.push(`${t.id}: ${why}`); continue; }
    const contents = [];
    for (const k of kids) {
      for (let q = 0; q < Math.max(1, k.quantity); q++) {
        contents.push({ typeId: k.item_type_id, routeNumber: k.route_number, makat: k.makat,
          steps: routes.get(`${k.item_type_id}:${k.route_number}`), sortOrder: k.sort_order });
      }
    }
    packageTypes.push({ id: t.id, routeNumber: t.rn, steps, contents,
      snapshot: kids.map((k) => ({ quantity: k.quantity, sort_order: k.sort_order, item_type_id: k.item_type_id, route_number: k.route_number })) });
  }
  if (!packageTypes.length) die(`no package type fits the box flow:\n  ${skipped.join("\n  ")}`);

  // customers: the demo ones, each needing a mintable 3-digit code
  const custRows = (await client.query(`SELECT id, trim(name) AS name, trim(customer_code) AS code FROM customers ORDER BY id`)).rows;
  const used = new Set(custRows.map((c) => c.code));
  const customers = [];
  const codeFixes = [];
  for (const d of DEMO_CUSTOMERS) {
    const c = custRows.find((x) => x.name === d.name);
    if (!c) continue;
    let code = c.code;
    if (!/^[1-9]\d{2}$/.test(code || "")) {
      code = FREE_CODES.find((x) => !used.has(x));
      if (!code) die("ran out of free 3-digit customer codes");
      used.add(code);
      codeFixes.push({ id: c.id, name: c.name, from: c.code, to: code });
    }
    customers.push({ id: c.id, name: c.name, code, weight: d.weight });
  }
  if (!customers.length) die("none of the demo customers exist in this database");
  // each customer orders mostly one or two package types
  for (const c of customers) {
    const prefs = [...packageTypes].sort(() => rnd() - 0.5).slice(0, Math.min(2, packageTypes.length));
    c.prefs = prefs.map((p, i) => ({ p, w: i === 0 ? 3 : 1 }));
  }
  const sources = (await client.query(`SELECT source_id AS id FROM sources ORDER BY source_id`)).rows.map((r) => r.id);

  // who works where: storekeepers open boxes, testers specialise, two of them run research
  const openTypes = new Set(packageTypes.map((p) => p.steps[0]));
  const workersByType = new Map();
  [...stationTypes.keys()].sort((a, b) => a - b).forEach((tid, i) => {
    if (openTypes.has(tid)) workersByType.set(tid, [...STOREKEEPERS, TESTERS[0]]);
    else if (tid === researchType) workersByType.set(tid, [TESTERS[6], TESTERS[7]]);
    else workersByType.set(tid, [TESTERS[i % 6], TESTERS[(i + 1) % 6], TESTERS[(i + 3) % 6]]);
  });
  // the long bench is the bottleneck; quick benches clear fast
  const queueFactor = new Map();
  for (const t of stationTypes.values()) {
    queueFactor.set(t.id, openTypes.has(t.id) ? 0.8 : t.packageLevel ? 1.0 : t.stale >= 120 ? 1.5 : 0.7);
  }
  return { stationTypes, stationsByType, researchStations, researchType, packageTypes, skipped,
    customers, codeFixes, sources, workersByType, queueFactor };
}

const stationOf = (typeId) => pick(ref.stationsByType.get(typeId));
const workerOf = (typeId) => pick(ref.workersByType.get(typeId) || TESTERS);

// ---- the simulation ----------------------------------------------------------
// Every event is a plain object; `assign` is the station the legacy item_routes
// row points at from that event on (load balancing, research pick, bench).
const events = [];
const results = [];   // test_results rows, keyed to their event by event_key
const visits = [];    // item_route_history rows
const research = [];  // research_history rows
let serialNo = 100000;

function emit(item, at, fields) {
  const e = { item, at: Math.round(at), seq: 0, kind: "transition", to: null, station: null, stationType: null,
    worker: null, submit: null, payload: {}, assign: null, ...fields };
  events.push(e);
  return e;
}
function advanceNotes(item, at, step, nextType, sid, worker) {
  const a = stationOf(nextType), b = stationOf(nextType);
  emit(item, at + 1, { kind: "note", step, station: a.id, worker, reason: "station_reassigned", seq: 2, submit: sid,
    key: `station_reassigned:${sid}:${item.id}:2`, payload: { site: "route_step_assignment", station_id: a.id } });
  emit(item, at + 2, { kind: "note", step, station: b.id, stationType: b.typeId, worker, reason: "station_reassigned", seq: 3,
    submit: sid, key: `station_reassigned:${sid}:${item.id}:3`, payload: { site: "next_station_load_balancing", station_id: b.id },
    assign: b.id });
  return b;
}

/** One box and its items, from intake to the closing result. Times past NOW are cut later. */
function simulateBox(box, kids, tIntake) {
  const [openType, closeType] = box.steps;
  const openStation = stationOf(openType);

  // intake: the box gets its route, its items are created from the template
  emit(box, tIntake, { to: "queued", step: 1, stationType: openType, reason: "item_created", key: `item_created:${box.id}`, assign: openStation.id });
  kids.forEach((k, i) => emit(k, tIntake + (i + 1) * rint(20, 90) * 1000, {
    to: "queued", step: 1, stationType: openType, reason: "item_created", key: `item_created:${k.id}`, assign: openStation.id }));
  const kidQueued = new Map(kids.map((k) => [k.id, tIntake]));

  // opening: one group test for the box and everything in it
  let tq = tIntake + (kids.length + 1) * 100 * 1000;
  let released = false;
  let closeStation = null;
  const kidState = [];
  for (;;) {
    const worker = workerOf(openType);
    const dur = Math.min(staleSecs(openType) - 3 * 60, rint(5, 12) * 60 + kids.length * rint(2, 4) * 60);
    const tStart = placeStart(addWork(tq, queueWait(openType)), dur);
    if (tStart === null) return;
    const g = uuid();
    emit(box, tStart, { to: "testing", step: 1, station: openStation.id, stationType: openType, worker, reason: "test_started",
      key: `test_started:${g}`, assign: openStation.id });
    kids.forEach((k, i) => emit(k, tStart + (i + 1) * 300, { to: "testing", step: 1, station: openStation.id, stationType: openType,
      worker, reason: "test_started", key: `test_started:${g}:${k.id}`, payload: { package_id: box.id, group_start: true }, assign: openStation.id }));
    if (!released && chance(0.04)) {
      released = true;
      const tr = tStart + releaseDuration(openType) * US_S, r = uuid();
      emit(box, tr, { to: "queued", step: 1, stationType: openType, worker, reason: "released_by_user", key: `released_by_user:${r}` });
      kids.forEach((k, i) => emit(k, tr + (i + 1) * 300, { to: "queued", step: 1, stationType: openType, worker, reason: "released_by_user",
        key: `released_by_user:${r}:${k.id}`, payload: { package_id: box.id, group_release: true } }));
      tq = tr; continue;
    }
    const tEnd = tStart + dur * US_S;
    const sid = uuid();
    let at = tEnd;
    for (const k of kids) {
      at += rint(80, 400) * 1000;
      const e = emit(k, at, { to: "queued", step: 2, worker, reason: "result_submitted", submit: sid, key: `result_submitted:${sid}:${k.id}:0` });
      const next = advanceNotes(k, at, 2, k.steps[1], sid, worker);
      k.openedAt = at;
      results.push({ item: k, station: openStation, step: 1, worker, passed: true, at, eventKey: e.key, comments: null,
        details: { sku: k.makat, hasRU: false, weight: null, opening: true, product: { ok: "pass", note: "", photos: [] },
          refSource: "none", package_id: box.id, expectedSku: null } });
      visits.push({ item: k, station: openStation, step: 1, qStart: kidQueued.get(k.id), pStart: tStart, pEnd: at, worker });
      kidState.push({ k, t: at, station: next.id, worker, sid });
    }
    at += rint(80, 400) * 1000;
    const eb = emit(box, at, { to: "queued", step: 2, worker, reason: "result_submitted", submit: sid, key: `result_submitted:${sid}:${box.id}:0` });
    closeStation = advanceNotes(box, at, 2, closeType, sid, worker);
    emit(box, at + 3, { to: "waiting_for_package_items", step: 2, stationType: closeType, worker, reason: "package_items_pending", submit: sid,
      key: `package_items_pending:${box.id}:${sid}`, payload: { package_id: box.id, blocking_item_ids: kids.map((k) => k.id) } });
    box.openedAt = at;
    results.push({ item: box, station: openStation, step: 1, worker, passed: true, at, eventKey: eb.key, comments: null,
      details: { pkg: { ok: "pass", note: "", photos: [] }, sku: box.makat, hasRU: false, opening: true, itemCount: kids.length,
        labelsPrinted: true, templateCount: kids.length, packageItemIds: kids.map((k) => k.id), registeredCount: kids.length,
        packageReference: null } });
    visits.push({ item: box, station: openStation, step: 1, qStart: tIntake, pStart: null, pEnd: at, worker });
    break;
  }

  // every item walks its own item-level steps, then waits at the closing step
  let ready = { t: 0 };
  for (const s of kidState) {
    const arrived = walkItem(s.k, s.t, s.station, s.worker, s.sid);
    if (arrived === null) return;
    if (arrived.t > ready.t) ready = arrived;
  }
  const tReady = ready.t + 5;
  emit(box, tReady, { to: "queued", step: 2, stationType: closeType, worker: ready.worker, reason: "package_items_ready", submit: ready.sid,
    key: `package_items_ready:${box.id}:${ready.sid}`, payload: { package_id: box.id } });

  // closing: one group test in the chamber
  tq = tReady;
  released = false;
  for (;;) {
    const worker = workerOf(closeType);
    const dur = testDuration(closeType);
    const tStart = placeStart(addWork(tq, queueWait(closeType)), dur);
    if (tStart === null) return;
    const g = uuid();
    emit(box, tStart, { to: "testing", step: 2, station: closeStation.id, stationType: closeType, worker, reason: "test_started",
      key: `test_started:${g}`, assign: closeStation.id });
    kids.forEach((k, i) => emit(k, tStart + (i + 1) * 300, { to: "testing", step: k.steps.length, station: closeStation.id,
      stationType: closeType, worker, reason: "test_started", key: `test_started:${g}:${k.id}`,
      payload: { package_id: box.id, group_start: true }, assign: closeStation.id }));
    if (!released && chance(0.03)) {
      released = true;
      const tr = tStart + releaseDuration(closeType) * US_S, r = uuid();
      emit(box, tr, { to: "queued", step: 2, stationType: closeType, worker, reason: "released_by_user", key: `released_by_user:${r}` });
      kids.forEach((k, i) => emit(k, tr + (i + 1) * 300, { to: "queued", step: k.steps.length, stationType: closeType, worker,
        reason: "released_by_user", key: `released_by_user:${r}:${k.id}`, payload: { package_id: box.id, group_release: true } }));
      tq = tr; continue;
    }
    const tEnd = finishAt(tStart, dur, staleSecs(closeType), true);
    const sid = uuid();
    let at = tEnd;
    for (const k of [...kids, box]) {
      at += rint(80, 400) * 1000;
      const n = k === box ? 2 : k.steps.length;
      emit(k, at, { to: "queued", step: n + 1, worker, reason: "result_submitted", submit: sid, key: `result_submitted:${sid}:${k.id}:0` });
      const done = emit(k, at + 1, { to: "done", step: n + 1, station: closeStation.id, stationType: closeType, worker, seq: 1,
        reason: "result_submitted", submit: sid, key: `result_submitted:${sid}:${k.id}:1` });
      const passed = chance(0.97);
      results.push({ item: k, station: closeStation, step: n, worker, passed, at: at + 1, eventKey: done.key,
        comments: passed ? pick(COMMENTS_PASS) : pick(COMMENTS_FAIL), details: null });
      visits.push({ item: k, station: closeStation, step: n, qStart: k === box ? tReady : k.arrivedAt, pStart: tStart, pEnd: at, worker });
    }
    box.doneAt = at + 1;
    break;
  }
}

/** An item's item-level steps (2 .. n-1). Returns when and how it reached the closing step. */
function walkItem(k, tFrom, firstStation, prevWorker, prevSid) {
  const n = k.steps.length;
  let step = 2, tq = tFrom, assigned = firstStation, researched = false, guard = 0;
  let last = { worker: prevWorker, sid: prevSid };
  while (step <= n - 1 && guard++ < 20) {
    const type = k.steps[step - 1];
    const station = ref.stationsByType.get(type).find((s) => s.id === assigned) || stationOf(type);
    const worker = workerOf(type);
    const dur = testDuration(type);
    const tStart = placeStart(addWork(tq, queueWait(type)), dur);
    if (tStart === null) return null;
    emit(k, tStart, { to: "testing", step, station: station.id, stationType: type, worker, reason: "test_started",
      key: `test_started:${uuid()}`, assign: station.id });

    if (chance(0.05)) { // the tester closed the dialog without a result
      const tr = tStart + releaseDuration(type) * US_S;
      emit(k, tr, { to: "queued", step, stationType: type, worker, reason: "released_by_user", key: `released_by_user:${uuid()}` });
      tq = tr; continue;
    }
    if (isReapable(type) && chance(0.03)) { // abandoned bench: the cron takes the item back
      const tr = tStart + (staleSecs(type) + rint(30, 300)) * US_S;
      const minute = new Date(tr / 1000).toISOString().slice(0, 16).replace(/[-T:]/g, "");
      emit(k, tr, { to: "queued", step, reason: "released_stale", key: `released_stale:${k.id}:${minute}` });
      tq = tr; continue;
    }

    const tEnd = finishAt(tStart, dur, staleSecs(type), dur > 4 * H);
    const sid = uuid();
    if (!researched && ref.researchStations.length && chance(0.09)) {
      researched = true;
      const out = emit(k, tEnd, { to: "queued_research", step, worker, reason: "sent_to_research", submit: sid,
        key: `sent_to_research:${sid}:${k.id}:0` });
      results.push({ item: k, station, step, worker, passed: false, at: tEnd, eventKey: out.key, comments: pick(COMMENTS_FAIL), details: null });
      visits.push({ item: k, station, step, qStart: tq, pStart: tStart, pEnd: tEnd, worker });
      const rs = pick(ref.researchStations);
      emit(k, tEnd + 1, { kind: "note", step, station: rs.id, worker, reason: "station_reassigned", seq: 3, submit: sid,
        key: `station_reassigned:${sid}:${k.id}:3`, payload: { site: "find_best_research_station", station_id: rs.id } });
      emit(k, tEnd + 2, { kind: "note", step, station: rs.id, stationType: rs.typeId, worker, reason: "station_reassigned", seq: 2,
        submit: sid, key: `station_reassigned:${sid}:${k.id}:2`, payload: { site: "research_load_balancing", station_id: rs.id }, assign: rs.id });

      const researcher = workerOf(rs.typeId);
      const tRs = placeStart(addWork(tEnd, researchWait()), 0);
      if (tRs === null) return null;
      emit(k, tRs, { to: "in_research", step, station: rs.id, stationType: rs.typeId, worker: researcher, reason: "test_started",
        key: `test_started:${uuid()}`, assign: rs.id });
      const sess = testDuration(rs.typeId);
      const tRe = finishAt(tRs, sess, staleSecs(rs.typeId), true);
      if (chance(0.55)) {
        const nid = uuid();
        const tn = tRs + Math.min(sess * 0.6, 4 * H) * US_S * (0.3 + rnd() * 0.6);
        emit(k, tn, { kind: "note", step, station: rs.id, stationType: rs.typeId, worker: researcher, reason: "research_note",
          submit: nid, key: `research_note:${nid}:${k.id}` });
      }
      const rid = uuid();
      const back = emit(k, tRe, { to: "queued", step, worker: researcher, reason: "returned_to_route", submit: rid,
        key: `returned_to_route:${rid}:${k.id}:0` });
      results.push({ item: k, station: rs, step, worker: researcher, passed: true, at: tRe, eventKey: back.key,
        comments: pick(COMMENTS_FIXED), details: null });
      visits.push({ item: k, station: rs, step, qStart: tEnd, pStart: tRs, pEnd: tRe, worker: researcher });
      research.push({ item: k, station: rs, worker: researcher, sentAt: tEnd, returnAt: tRe, comments: pick(RESEARCH_NOTES) });
      tq = tRe; assigned = stationOf(type).id;
      continue;
    }

    const e = emit(k, tEnd, { to: "queued", step: step + 1, worker, reason: "result_submitted", submit: sid,
      key: `result_submitted:${sid}:${k.id}:0` });
    const passed = chance(0.95);
    results.push({ item: k, station, step, worker, passed, at: tEnd, eventKey: e.key,
      comments: passed ? pick(COMMENTS_PASS) : pick(COMMENTS_FAIL), details: null });
    visits.push({ item: k, station, step, qStart: tq, pStart: tStart, pEnd: tEnd, worker });
    assigned = advanceNotes(k, tEnd, step + 1, k.steps[step], sid, worker).id;
    last = { worker, sid };
    tq = tEnd; step++;
  }
  k.arrivedAt = tq;
  return { t: tq, ...last };
}

// ---- plan: shipments over the months ---------------------------------------------
const shipments = [];
const boxesAll = [];
const counters = new Map(); // dateKey -> last daily package counter

function planShipments() {
  const now = new Date(NOW / 1000);
  let shipNo = 0, lineNo = 0;
  for (let back = MONTHS; back >= 0; back--) {
    const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1) * 1000;
    const mEnd = Math.min(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1) * 1000, NOW);
    const month = new Date(mStart / 1000).getUTCMonth();
    const elapsed = (mEnd - mStart) / ((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1) * 1000) - mStart);
    const p = (MONTHS - back) / MONTHS;
    const target = Math.round(BOXES_PER_MONTH * SEASON[month] * (0.85 + 0.3 * p) * elapsed);
    const monthShips = [];
    let boxes = 0;
    const addShip = (at, backlog) => {
      const c = weighted(ref.customers, (x) => x.weight);
      const lines = [];
      const nLines = chance(0.65) ? 1 : 2;
      for (let l = 0; l < nLines; l++) {
        const pt = weighted(c.prefs, (x) => x.w).p;
        if (lines.some((x) => x.pt === pt)) continue;
        const qty = rint(1, 5);
        lines.push({ id: ++lineNo, pt, qty, makat: `KIT-${pt.id}-${rint(100, 999)}`, certRow: String(l + 1) });
        boxes += qty;
      }
      monthShips.push({ customer: c, at, lines, source: ref.sources.length ? pick(ref.sources) : null,
        receiver: pick(STOREKEEPERS), sender: pick(STOREKEEPERS), progress: p, backlog });
    };
    while (boxes < target) {
      const at = randomWorkInstant(mStart, mEnd);
      if (at === null || at > NOW) break;
      addShip(at, false);
    }
    if (back === 0) {
      // fresh arrivals of the last working day, so the board shows boxes still waiting to be taken in
      for (const hoursAgo of [rint(9, 14), rint(1, 3)]) {
        const at = instantAtWorkOffset(workOffsetOf(NOW) - hoursAgo * H * US_S);
        if (at !== null && at < NOW) addShip(at, true);
      }
    }
    monthShips.sort((a, b) => a.at - b.at);
    for (const s of monthShips) {
      s.id = ++shipNo;
      const d = new Date(s.at / 1000);
      s.code = `${String(d.getUTCFullYear()).slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}-${s.customer.code}-${String(s.id).padStart(3, "0")}`;
      shipments.push(s);
    }
  }
}

function mintBoxes() {
  for (const s of shipments) {
    const { datePart, dateKey } = localDate(s.at);
    s.boxes = [];
    for (const line of s.lines) {
      for (let q = 0; q < line.qty; q++) {
        const counter = (counters.get(dateKey) || 0) + 1;
        counters.set(dateKey, counter);
        const base = `${s.customer.code}${datePart}${String(counter).padStart(4, "0")}`;
        const box = { id: `${base}00`, base, typeId: line.pt.id, routeNumber: line.pt.routeNumber, steps: line.pt.steps,
          makat: line.makat, ship: s, line, pt: line.pt, isBox: true };
        s.boxes.push(box);
        boxesAll.push(box);
      }
    }
  }
}

function simulateAll() {
  for (const s of shipments) {
    progress = s.progress;
    // the storekeeper scans the shipment's boxes in one session — usually the same day, sometimes a backlog
    let t = addWork(s.at, s.backlog ? rint(6 * H, 14 * H) : chance(0.25) ? rint(8 * H, 20 * H) : rint(15 * 60, 5 * H));
    for (const box of s.boxes) {
      if (t === null) break;
      box.intakeAt = t;
      t += rint(1, 4) * US_MIN;
      if (box.intakeAt > NOW) continue; // not taken in yet
      box.kids = box.pt.contents.map((c, i) => ({
        id: `${box.base}${String(i + 1).padStart(2, "0")}`, typeId: c.typeId, routeNumber: c.routeNumber, steps: c.steps,
        makat: c.makat || `MK-${c.typeId}${rint(100, 999)}`, model: pick(MODELS), manufacturer: pick(MANUFACTURERS),
        manufacturerNo: String(rint(1000, 9999)), serial: `SN${c.typeId}-${++serialNo}`, ship: s, box, seq: i + 1 }));
      simulateBox(box, box.kids, box.intakeAt);
    }
    // the shipment goes back once every box is done
    const doneAts = s.boxes.map((b) => b.doneAt);
    if (doneAts.every((x) => x && x <= NOW)) {
      const sent = addWork(Math.max(...doneAts), rint(1 * H, 20 * H));
      if (sent !== null && sent <= NOW) s.sentAt = sent;
    }
  }
}

// ---- writing -------------------------------------------------------------------
const RESET_TABLES = [
  "item_state_interval", "item_state_event", "route_run", "job_run",
  "test_results", "research_history", "item_route_history", "item_reports", "legacy_id_map",
  "item_routes", "items", "shipment_items", "shipment_history", "shipments", "daily_counters",
];
const STATUS = { testing: 1, queued: 2, done: 3, queued_research: 4, in_research: 5, waiting_for_package_items: 6 };
const TS = (p) => `(${p}::timestamptz AT TIME ZONE 'UTC')`;
const TSTZ = (p) => `${p}::timestamptz`;
const JSONB = (p) => `${p}::jsonb`;
const ID = (p) => p;

async function insertRows(client, head, exprs, rows, returning = "", chunk = 400) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const params = [], tuples = [];
    for (const r of rows.slice(i, i + chunk)) {
      tuples.push("(" + r.map((v, j) => { params.push(v); return exprs[j](`$${params.length}`); }).join(",") + ")");
    }
    const res = await client.query(`${head} VALUES ${tuples.join(",")} ${returning}`, params);
    out.push(...res.rows);
  }
  return out;
}

async function write(client) {
  if (RESET) {
    console.log(`  reset: TRUNCATE ${RESET_TABLES.length} transactional + ledger tables`);
    await client.query("ALTER TABLE item_state_event DISABLE TRIGGER trg_ise_immutable");
    await client.query(`TRUNCATE ${RESET_TABLES.join(", ")} RESTART IDENTITY`);
    await client.query("ALTER TABLE item_state_event ENABLE TRIGGER trg_ise_immutable");
  }
  for (const f of ref.codeFixes) {
    await client.query("UPDATE customers SET customer_code = $1 WHERE id = $2", [f.to, f.id]);
    console.log(`  customer ${f.id} (${f.name}): code "${f.from}" -> "${f.to}" (box ids embed a 3-digit code)`);
  }

  const live = events.filter((e) => e.at <= NOW);
  const byItem = new Map();
  for (const e of live) { if (!byItem.has(e.item.id)) byItem.set(e.item.id, []); byItem.get(e.item.id).push(e); }

  // shipments + their declared lines
  await insertRows(client,
    `INSERT INTO shipments (id, shipment_code, customer_id, shipment_date, makat, amount, recieving_worker_id, recieving_worker_name,
       source_id, received_at, is_sent, shipment_sent_date, finished_at, sending_worker_id, sending_worker_name)`,
    [ID, ID, ID, TS, ID, ID, ID, ID, ID, TSTZ, ID, TS, TSTZ, ID, ID],
    shipments.map((s) => [s.id, s.code, s.customer.id, usToIso(s.at), s.lines[0].makat, s.lines.reduce((a, l) => a + l.qty, 0),
      s.receiver.id, s.receiver.name, s.source, usToIso(s.at), !!s.sentAt, s.sentAt ? usToIso(s.sentAt) : null,
      s.sentAt ? usToIso(s.sentAt) : null, s.sentAt ? s.sender.id : null, s.sentAt ? s.sender.name : null]));
  await insertRows(client,
    `INSERT INTO shipment_items (id, shipment_id, item_type_id, quantity, created_at, makat, cert_row_no)`,
    [ID, ID, ID, ID, TS, ID, ID],
    shipments.flatMap((s) => s.lines.map((l) => [l.id, s.id, l.pt.id, l.qty, usToIso(s.at), l.makat, l.certRow])));
  const sentLines = shipments.filter((s) => s.sentAt).flatMap((s) => s.lines.map((l) => [s.id, `OUT-${s.code}`, usToIso(s.sentAt),
    s.sender.id, s.sender.name, l.pt.id, l.makat, l.qty]));
  if (sentLines.length) {
    await insertRows(client,
      `INSERT INTO shipment_history (shipment_id, sent_shipment_code, sent_date, sending_worker_id, sending_worker_name, item_type_id, makat, amount)`,
      [ID, ID, TS, ID, ID, ID, ID, ID], sentLines);
  }

  // items: every minted box; the items inside only for boxes already taken in
  const itemRows = [];
  for (const b of boxesAll) {
    const taken = b.intakeAt != null && b.intakeAt <= NOW;
    itemRows.push([b.id, b.ship.customer.id, b.typeId, null, b.makat, "", "", "", b.ship.id, null, null,
      taken ? b.kids.length + 1 : 1, taken ? JSON.stringify(b.pt.snapshot) : null, b.line.id]);
    if (!taken) continue;
    for (const k of b.kids) {
      const opened = k.openedAt != null && k.openedAt <= NOW;
      itemRows.push([k.id, b.ship.customer.id, k.typeId, opened ? k.serial : null, k.makat, k.model, k.manufacturer,
        k.manufacturerNo, b.ship.id, b.id, k.seq, 1, null, null]);
    }
  }
  await insertRows(client,
    `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no,
       shipment_id, package_id, package_seq, package_next_seq, template_snapshot, shipment_item_id)`,
    [ID, ID, ID, ID, ID, ID, ID, ID, ID, ID, ID, ID, JSONB, ID], itemRows);

  // item_routes at each item's state as of NOW, and its route_run
  const routeRows = [], runRows = [];
  for (const [id, evs] of byItem) {
    const it = evs[0].item;
    let state = null, step = 1, station = null, qStart = evs[0].at, lastStart = null, finished = null;
    for (const e of evs) {
      if (e.assign != null) station = e.assign;
      if (e.kind !== "transition") continue;
      state = e.to; step = e.step;
      if (e.reason === "test_started") lastStart = e.at;
      if (e.to === "queued" || e.to === "queued_research" || e.to === "waiting_for_package_items") qStart = e.at;
      if (e.to === "done") finished = e.at;
    }
    const status = STATUS[state];
    const pStart = status === 2 || status === 4 ? null : lastStart;
    routeRows.push([id, it.typeId, status, step, station, usToIso(evs[0].at), finished ? usToIso(finished) : null, status === 3,
      usToIso(qStart), pStart ? usToIso(pStart) : null, it.routeNumber]);
    const isKid = !it.isBox;
    const opened = isKid && it.openedAt != null && it.openedAt <= NOW;
    runRows.push([id, it.routeNumber, it.typeId, it.steps, it.steps, usToIso(evs[0].at), it.ship.customer.id, it.ship.id,
      isKid ? it.box.id : null, isKid ? it.box.id : id, isKid, opened ? it.serial : ""]);
  }
  await insertRows(client,
    `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, finished_at,
       is_finished, queue_start_time, processing_start_time, route_number)`,
    [ID, ID, ID, ID, ID, TS, TS, ID, TS, TS, ID], routeRows);
  const runs = await insertRows(client,
    `INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest, opened_at, customer_id,
       shipment_id, package_id, unit_id, is_package_item, serial_no, is_trusted)`,
    [ID, ID, ID, ID, (p) => `${p}::int[]`, (p) => `md5(${p}::int[]::text)`, TSTZ, ID, ID, ID, ID, ID, ID, ID],
    runRows.map((r) => [r[0], 1, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], true]),
    "RETURNING route_run_id, item_id");
  const runOf = new Map(runs.map((r) => [String(r.item_id), r.route_run_id]));

  // the ledger, in chronological order — the trigger folds each row as it lands
  const order = live.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.e.seq - b.e.seq || a.i - b.i).map((x) => x.e);
  const t0 = Date.now();
  const ids = await insertRows(client,
    `INSERT INTO item_state_event (event_key, route_run_id, item_id, occurred_at, recorded_at, seq, kind, to_state, step_no,
       station_id, station_type_id, worker_id, worker_name, reason, submit_id, is_trusted, payload)`,
    [ID, ID, ID, TSTZ, TSTZ, ID, ID, ID, ID, ID, ID, ID, ID, ID, (p) => `${p}::uuid`, ID, JSONB],
    order.map((e) => [e.key, runOf.get(e.item.id), e.item.id, usToIso(e.at), usToIso(e.at), e.seq, e.kind, e.to, e.step,
      e.station, e.stationType, e.worker?.id ?? null, e.worker?.name ?? null, e.reason, e.submit, true, JSON.stringify(e.payload)]),
    "RETURNING event_id, event_key", 300);
  const eventId = new Map(ids.map((r) => [r.event_key, r.event_id]));
  console.log(`  ledger: ${order.length} events folded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // legacy rows, only for what already happened
  const liveResults = results.filter((r) => r.at <= NOW && eventId.has(r.eventKey));
  await insertRows(client,
    `INSERT INTO test_results (item_id, test_station_id, test_station_type_id, route_number, route_step, worker_id, passed, result,
       comments, details, created_at, state_event_id)`,
    [ID, ID, ID, ID, ID, ID, ID, ID, ID, JSONB, TSTZ, ID],
    liveResults.map((r) => [r.item.id, r.station.id, r.station.typeId, r.item.routeNumber, r.step, r.worker.id, r.passed, r.passed ? 1 : 0,
      r.comments, r.details ? JSON.stringify(r.details) : null, usToIso(r.at), eventId.get(r.eventKey)]));
  const liveVisits = visits.filter((v) => v.pEnd <= NOW);
  await insertRows(client,
    `INSERT INTO item_route_history (item_id, test_station_id, current_route_step, queue_start_time, processing_start_time,
       processing_end_time, worker_id, route_number)`,
    [ID, ID, ID, TS, TS, TS, ID, ID],
    liveVisits.map((v) => [v.item.id, v.station.id, v.step, v.qStart ? usToIso(v.qStart) : null, v.pStart ? usToIso(v.pStart) : null,
      usToIso(v.pEnd), v.worker.id, v.item.routeNumber]));
  const liveResearch = research.filter((r) => r.sentAt <= NOW);
  if (liveResearch.length) {
    await insertRows(client,
      `INSERT INTO research_history (item_id, station_id, result, comments, worker_id, sent_at, return_at)`,
      [ID, ID, ID, ID, ID, TS, TS],
      liveResearch.map((r) => [r.item.id, r.station.id, r.returnAt <= NOW ? 1 : 0, r.comments, r.worker.id, usToIso(r.sentAt),
        r.returnAt <= NOW ? usToIso(r.returnAt) : null]));
  }
  await insertRows(client, `INSERT INTO daily_counters (date_key, counter)`, [ID, ID], [...counters].map(([k, v]) => [k, v]));
  for (const t of ["shipments", "shipment_items"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT COALESCE(max(id), 1) FROM ${t}))`);
  }
  return { live, byItem, liveResults, liveVisits, liveResearch };
}

// ---- checks ----------------------------------------------------------------------
function signature(r) {
  const maskKey = String(r.event_key)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{uuid}")
    .replace(/\d{13,}/g, "{item}").replace(/\d{12}/g, "{minute}").replace(/\d{6,}/g, "{item}");
  const payloadKeys = Object.keys(r.payload || {}).filter((k) => k !== "auto_opened_run").sort().join(",");
  return [r.reason, r.kind, r.to_state ?? "-", r.seq, r.station_id == null ? "-" : "station", r.station_type_id == null ? "-" : "type",
    r.worker_id == null ? "-" : "worker", r.submit_id == null ? "-" : "submit", maskKey, `{${payloadKeys}}`].join(" | ");
}

async function checks(client) {
  const problems = [];
  const self = (await client.query("SELECT * FROM metrics_selfcheck()")).rows;
  console.log("\n  metrics_selfcheck():");
  for (const r of self) console.log(`    ${r.check_name.padEnd(34)} ${String(r.value).padStart(6)}  ${r.detail ?? ""}`);

  const mismatch = (await client.query(`
    SELECT count(*)::int AS n FROM item_routes ir
      JOIN item_state_interval i ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
      JOIN metric_state ms ON ms.state_key = i.state_key
     WHERE ms.legacy_status_id IS DISTINCT FROM ir.current_status`)).rows[0].n;
  if (mismatch) problems.push(`${mismatch} item_routes rows disagree with their open interval`);
  const multiOpen = (await client.query(`
    SELECT count(*)::int AS n FROM (SELECT item_id FROM item_state_interval WHERE upper_inf(valid_range)
     GROUP BY item_id HAVING count(*) > 1) x`)).rows[0].n;
  if (multiOpen) problems.push(`${multiOpen} items with more than one open interval`);
  const overStale = (await client.query(`
    SELECT count(*)::int AS n FROM item_state_interval i JOIN test_stations_type t ON t.test_station_type_id = i.station_type_id
     WHERE i.state_key IN ('testing','in_research') AND t.stale_after_minutes > 0
       AND COALESCE(upper(i.valid_range), now()) - lower(i.valid_range) > make_interval(mins => t.stale_after_minutes + 6)`)).rows[0].n;
  if (overStale) problems.push(`${overStale} test intervals longer than their type's stale threshold`);
  const straddle = (await client.query(`SELECT count(*)::int AS n FROM item_state_interval WHERE wall_seconds > work_seconds + 3600`)).rows[0].n;
  if (!straddle) problems.push("no interval straddles a night — wall and work clocks would be identical");

  if (PARITY_URL) {
    const pc = new pg.Client({ connectionString: PARITY_URL });
    await pc.connect();
    const real = new Set((await pc.query(
      `SELECT reason, kind, to_state, seq, station_id, station_type_id, worker_id, submit_id, event_key, payload
         FROM item_state_event WHERE NOT (payload ? 'auto_opened_run')`)).rows.map(signature));
    await pc.end();
    const ours = new Map();
    for (const r of (await client.query(
      `SELECT reason, kind, to_state, seq, station_id, station_type_id, worker_id, submit_id, event_key, payload FROM item_state_event`)).rows) {
      const s = signature(r); ours.set(s, (ours.get(s) || 0) + 1);
    }
    const unknown = [...ours].filter(([s]) => !real.has(s));
    console.log(`\n  parity: ${ours.size} event shapes written, ${ours.size - unknown.length} also produced by the real system`);
    for (const [s, n] of unknown) console.log(`    NOT SEEN IN THE REAL DB (${n}x): ${s}`);
  }
  return problems;
}

// ---- main --------------------------------------------------------------------------
async function main() {
  console.log(`seed-dashboard-demo → ${DB_NAME}   now=${usToIso(NOW)}   months=${MONTHS}   boxes/month≈${BOXES_PER_MONTH}   seed=${SEED}`);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const items = (await client.query("SELECT count(*)::int AS n FROM items")).rows[0].n;
    if (items > 0 && !RESET) die(`"${DB_NAME}" already has ${items} items — pass --reset to replace them`);
    ref = await loadReference(client);
    for (const s of ref.skipped) console.log(`  package type ${s} — skipped`);
    console.log(`  package types: ${ref.packageTypes.map((p) => `${p.id} (${p.contents.length} items)`).join(", ")}`);
    console.log(`  customers: ${ref.customers.map((c) => `${c.name} [${c.code}]`).join(", ")}`);

    planShipments();
    mintBoxes();
    simulateAll();

    await client.query("BEGIN");
    const w = await write(client);
    await client.query("COMMIT");

    const taken = boxesAll.filter((b) => b.intakeAt != null && b.intakeAt <= NOW);
    console.log(`\n  shipments ${shipments.length} (${shipments.filter((s) => s.sentAt).length} sent back) · boxes ${boxesAll.length}` +
      ` (${boxesAll.length - taken.length} not taken in yet) · items in boxes ${taken.reduce((a, b) => a + b.kids.length, 0)}`);
    console.log(`  test_results ${w.liveResults.length} · visits ${w.liveVisits.length} · research episodes ${w.liveResearch.length}`);
    const board = (await client.query(
      `SELECT ms.label_he, count(*)::int AS n FROM item_routes ir JOIN metric_state ms ON ms.legacy_status_id = ir.current_status
        GROUP BY 1, ms.sort_order ORDER BY ms.sort_order`)).rows;
    console.log(`  state now: ${board.map((r) => `${r.label_he.trim()} ${r.n}`).join(" · ")}`);

    const problems = await checks(client);
    if (problems.length) {
      console.log("\nPROBLEMS:"); for (const p of problems) console.log("  - " + p);
      process.exitCode = 1;
    } else {
      console.log("\nall checks passed");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
