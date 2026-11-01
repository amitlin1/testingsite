// Stage-by-stage: perform the real operational actions over HTTP, then check
// every dashboard endpoint against the independent model (model.mjs).
//   node scripts/dashboard-stepwise/stage.mjs <stageNo>     one stage
//   node scripts/dashboard-stepwise/stage.mjs all           1..12 in order
// See README.md in this directory for the environment it needs.
import { api, login, pool, q, q1, uuid } from "./lib.mjs";
import { loadState, saveState, observe, stateOf, opRow, expectedLive, expectedKpiWindow, expectedFlow, jlmYmd, workMs } from "./model.mjs";

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.argv[2] === "all") {
  let failed = 0;
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    try { execFileSync(process.execPath, [fileURLToPath(import.meta.url), String(n)], { stdio: "inherit" }); }
    catch { failed++; }
  }
  console.log(failed ? `\n${failed} stage(s) had failing checks` : "\nall stages green");
  process.exit(failed ? 1 : 0);
}
const stageNo = Number(process.argv[2]);
await login();
let S = loadState() ?? { items: {}, ref: {}, sentShipments: [], calendar: { days: {} }, checks: [], log: [] };
const W = { id: 4101, name: "אורי בן-דוד" }, W2 = { id: 4102, name: "נועה שגב" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

// ---------------------------------------------------------------- actions ---
async function act(label, itemIds, fn) {
  const t0 = Date.now(); const r = await fn(); const t1 = Date.now();
  const touched = new Set(itemIds.map(String));
  for (const id of [...touched]) {
    const row = await q1("SELECT COALESCE(package_id, item_id)::text AS box FROM items WHERE item_id = $1", [id]);
    if (!row) continue;
    for (const r2 of await q("SELECT item_id::text AS id FROM items WHERE item_id = $1 OR package_id = $1", [row.box])) if (S.items[r2.id]) touched.add(r2.id);
  }
  for (const id of touched) await observe(S, id, t0, t1, itemIds.map(String).includes(id) ? label : `${label}(group)`);
  S.log.push({ label, itemIds, t0, t1, status: r.status });
  return r;
}
async function locate(id) { return (await api("GET", `/api/testing/locate-by-barcode?barcode=${id}`)).json; }
async function createItem(key, customerKey, shipKey, typeKey, routeNumber = 1, extra = {}) {
  const body = {
    customer: S.ref.customers[customerKey], itemType: S.ref.itemTypes[typeKey], serialNumber: `SN-${key}-${Date.now() % 100000}`,
    makat: `MK-${typeKey}`, model: "RX-220", manufacturer: "Elta", manufacturerNo: "1234",
    shipment: S.ref.shipments[shipKey], routeNumber, ...extra,
  };
  const t0 = Date.now(); const r = await api("POST", "/api/items", body); const t1 = Date.now();
  if (!r.ok) throw new Error(`create ${key} failed`);
  const id = String(r.json.itemId);
  S.items[id] = { key, intervals: [], deleted: false };
  S.keys ??= {}; S.keys[key] = id;
  await observe(S, id, t0, t1, "item_created");
  return id;
}
const ID = (k) => S.keys[k];
async function startTest(k, stationKey, w = W) {
  const id = ID(k); const stationId = stationKey ? S.ref.stations[stationKey] : (await locate(id)).stationId;
  return act("test_started", [id], () => api("POST", "/api/testing/start-test", { itemId: id, stationId, workerId: w.id, workerName: w.name, actionUuid: uuid() }));
}
async function submit(k, extra = {}, w = W) {
  const id = ID(k); const loc = await locate(id);
  const passed = extra.passed ?? true;
  return act(extra.label ?? "result_submitted", [id], () => api("POST", "/api/testing/results", {
    ItemID: id, StationID: loc.stationId, Result: passed ? 1 : 0, Passed: passed, Comments: passed ? "תקין" : "תקלה",
    WorkerID: w.id, WorkerName: w.name, SubmitID: uuid(), ...(extra.body || {}),
  }));
}
async function release(k, w = W) {
  const id = ID(k); const loc = await locate(id);
  return act("released_by_user", [id], () => api("POST", "/api/testing/release-test", { itemId: id, stationId: loc.stationId, workerId: w.id, workerName: w.name, actionUuid: uuid() }));
}

// ------------------------------------------------------------------ check ---
function close(a, e, tolAbs) { return (a == null && e == null) || (a != null && e != null && Math.abs(a - e) <= tolAbs); }
const results = [];
function expect(name, actual, expected, tol = 0) {
  const ok = typeof expected === "number" && typeof actual === "number" ? close(actual, expected, tol) : JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, actual, expected, ok });
}

function dayWindow() {
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0, 0); // the UI's "today" preset
  const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0, 0);
  return { startDate: s.toISOString(), endDate: e.toISOString() };
}
let EXTRA = {};
function qs(scope, extra = {}) {
  const { startDate, endDate } = dayWindow();
  return new URLSearchParams({ startDate, endDate, scope, ...EXTRA, ...extra }).toString();
}

async function checkDashboard(tag, { scope = "open_shipments", filter = null, params = {} } = {}) {
  const now = Date.now();
  const today = jlmYmd(now);
  const dayStart = new Date(`${today}T00:00:00+02:00`).getTime(); // IST (+02) in November
  const dayEnd = dayStart + 86400000;
  EXTRA = params;
  const L = expectedLive(S, { scope, filter });
  const K = expectedKpiWindow(S, dayStart, dayEnd, now, { scope, filter });
  const tolMin = 0.05; // 3s on averages (client vs server clock + request latency)

  const [kpis, board, dist, ship, times, cust, types, slow, hist, jobs] = await Promise.all([
    api("GET", `/api/dashboard/tests/kpis?${qs(scope)}`),
    api("GET", `/api/dashboard/tests/by-station?${qs(scope)}`),
    api("GET", `/api/dashboard/tests/status-distribution?${qs(scope)}`),
    api("GET", `/api/dashboard/tests/shipments?${qs(scope)}`),
    api("GET", `/api/dashboard/tests/average-times?${qs(scope, { period: "daily" })}`),
    api("GET", `/api/dashboard/tests/customer-performance?${qs(scope)}`),
    api("GET", `/api/dashboard/tests/item-types?scope=${scope}`),
    api("GET", `/api/dashboard/tests/slow-items?${qs(scope, { limit: "100" })}`),
    api("GET", `/api/dashboard/tests/status-distribution/history?${qs(scope)}`),
    api("GET", `/api/health/jobs`),
  ]);
  for (const [n, r] of Object.entries({ kpis, board, dist, ship, times, cust, types, slow, hist, jobs })) expect(`${n}: HTTP 200`, r.status, 200);

  const k = kpis.json;
  const sum = (o, keys) => keys.reduce((a, s) => a + (o[s] || 0), 0);
  expect("kpis.itemsCurrentlyInQueue", k.itemsCurrentlyInQueue, sum(L.byState, ["queued", "queued_research", "waiting_for_package_items"]));
  expect("kpis.itemsCurrentlyInTest", k.itemsCurrentlyInTest, sum(L.byState, ["testing", "in_research"]));
  if (params.testStationId) {
    // route_run has no station: the count cannot honour the filter, and says so (§5.0(1))
    expect("kpis names the filter treatedCount ignores", /station/i.test(k._new_ignoredFilters ?? ""), true);
  } else expect("kpis.treatedCount (finished today)", k.treatedCount, K.finished);
  expect("kpis.averageQueueTimeMinutes (wall)", k.averageQueueTimeMinutes, K.avg_wait_wall_min, tolMin);
  expect("kpis._new_averageQueueWorkMinutes (work)", k._new_averageQueueWorkMinutes, K.avg_wait_work_min, tolMin);
  expect("kpis._new_waitRecordCount", k._new_waitRecordCount, K.wait_n);
  expect("kpis.averageProcessingTimeMinutes (wall)", k.averageProcessingTimeMinutes, K.avg_busy_wall_min, tolMin);
  expect("kpis._new_averageProcessingWorkMinutes (work)", k._new_averageProcessingWorkMinutes, K.avg_busy_work_min, tolMin);
  expect("kpis._new_busyRecordCount", k._new_busyRecordCount, K.busy_n);
  expect("kpis._new_offhoursMinutes", k._new_offhoursMinutes ?? 0, K.offhours_min, 0.2);
  expect("kpis._new_unitsTouched", k._new_unitsTouched, K.units_touched);
  expect("kpis._new_researchWaitWallMinutes", k._new_researchWaitWallMinutes, K.research_wait_wall, tolMin);
  expect("kpis._new_researchWallMinutes", k._new_researchWallMinutes, K.research_wall, tolMin);

  // live distribution
  const distMap = Object.fromEntries((dist.json || []).map((r) => [r._new_stateKey ?? r.status, r.count]));
  for (const st of ["queued", "testing", "queued_research", "in_research", "waiting_for_package_items"]) {
    expect(`status-distribution.${st}`, distMap[st] ?? 0, L.byState[st] ?? 0);
  }

  // station board (live; carries no filter block)
  for (const [key, sid] of Object.entries(S.ref.stations)) {
    if (params.testStationId && String(sid) !== String(params.testStationId)) continue; // the board narrows to the filtered station
    const row = (board.json || []).find((r) => Number(r.test_station_id ?? r.stationId ?? r.station_id) === sid);
    if (!row) { expect(`by-station[${key}] present`, false, true); continue; }
    const live = expectedLive(S, { scope: "all" }); // the board is unscoped (Q3 has no filter block)
    const typeId = S.ref.stationTypeOf[key];
    expect(`by-station[${key}].in_test`, num(row, ["itemsInTest"]), live.byStation[sid]?.testing ?? 0);
    expect(`by-station[${key}].in_research`, num(row, ["_new_itemsInResearch"]), live.byStation[sid]?.in_research ?? 0);
    expect(`by-station[${key}].type queue`, num(row, ["itemsInQueue"]), live.typeQueue[typeId] ?? 0);
  }
  S.lastBoard = board.json; S.lastKpis = k;
  return { kpis, board, dist, ship, times, cust, types, slow, hist, jobs };
}
function num(row, keys) { for (const k of keys) if (row[k] !== undefined) return Number(row[k]); return `missing(${keys[0]})`; }

async function ledgerInvariants() {
  const sc = await q("SELECT * FROM metrics_selfcheck()");
  const bad = sc.filter((r) => Number(r.value) !== 0 && !["calendar_horizon_days", "calendar_sanity_net_minutes", "open_intervals", "ledger_bytes", "ledger_rows"].includes(r.check_name ?? r.checkname));
  expect("metrics_selfcheck: no anomalies", bad.map((r) => `${r.check_name}=${r.value}`), []);
  // ledger vs operational: every live item's open interval equals item_routes
  const mism = await q(`
    SELECT ir.item_id, ir.current_status, ir.is_finished, isi.state_key
      FROM item_routes ir
      LEFT JOIN item_state_interval isi ON isi.item_id = ir.item_id AND upper_inf(isi.valid_range)
     WHERE COALESCE(isi.state_key,'∅') <> CASE WHEN ir.is_finished THEN 'done' ELSE state_of(ir.current_status) END`);
  expect("ledger open interval == item_routes for every item", mism.map((r) => `${r.item_id}:${r.current_status}/${r.state_key}`), []);
}

let anyFailed = false;
function report(tag) {
  const fails = results.filter((r) => !r.ok);
  if (fails.length) anyFailed = true;
  console.log(`\n### ${tag}: ${results.length - fails.length}/${results.length} checks OK`);
  for (const r of results) console.log(`${r.ok ? "  ok " : "  XX "} ${r.name}: actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`);
  S.checks.push({ tag, total: results.length, failed: fails.map((f) => ({ name: f.name, actual: f.actual, expected: f.expected })) });
}

// ----------------------------------------------------------------- stages ---
// package-model helpers (the calls the screens make)
const pkgView = async (boxKey) => (await api("GET", `/api/packages/${ID(boxKey)}`)).json.package;
const kidsOf = (boxKey) => S.boxes[boxKey];
async function trackNewItems(boxKey, t0, t1, label) {
  const v = await pkgView(boxKey);
  S.boxes[boxKey] = [];
  for (const it of v.items) {
    const id = String(it.item_id); const k = `${boxKey}.${it.package_seq ?? S.boxes[boxKey].length + 1}`;
    if (!S.items[id]) { S.items[id] = { key: k, intervals: [], deleted: false }; S.keys[k] = id; }
    S.boxes[boxKey].push(S.items[id].key);
    await observe(S, id, t0, t1, label);
  }
}
async function groupStart(boxKey, stationKey, w = W) {
  const box = ID(boxKey); const ids = [box, ...kidsOf(boxKey).map(ID)];
  return act("test_started", ids, () => api("POST", "/api/testing/start-test", { itemId: Number(box), stationId: S.ref.stations[stationKey], actionUuid: uuid(), workerId: w.id, workerName: w.name }));
}
/** Opening / closing wizard: a result per item then the box, one SubmitID. */
async function wizard(boxKey, stationKey, kind, w = W) {
  const box = ID(boxKey); const sid = S.ref.stations[stationKey]; const submit = uuid();
  const base = { StationID: sid, WorkerID: w.id, WorkerName: w.name, SubmitID: submit, Result: 1, Passed: true };
  const kids = kidsOf(boxKey).map(ID);
  for (const id of kids) {
    const details = kind === "opening" ? { opening: true, package_id: box } : { closing: true, packed: true };
    await act("result_submitted", [id], () => api("POST", "/api/testing/results", { ...base, ItemID: Number(id), Details: details }));
  }
  const boxDetails = kind === "opening" ? { opening: true, itemCount: kids.length } : { closing: true, packed: kids, decisions: [] };
  return act("result_submitted", [box, ...kids], () => api("POST", "/api/testing/results", { ...base, ItemID: Number(box), Details: boxDetails }));
}
const curOf = (k) => { const it = S.items[ID(k)]; return it.intervals[it.intervals.length - 1]; };

const stages = {
  // S1 — reference data + calendar, through the settings screens' API
  async 1() {
    const st = await q("SELECT item_status_id FROM item_status WHERE item_status_id BETWEEN 1 AND 6");
    if (st.length < 6) throw new Error("item_status lacks ids 1..6 — load the lookup rows of prod-deploy/db-server/settings-seed/settings-seed.sql first (README.md)");
    const busy = await q1("SELECT count(*)::int n FROM items");
    if (busy.n > 0) throw new Error(`items already holds ${busy.n} row(s): the check compares GLOBAL dashboard numbers, so it needs a freshly migrated database`);
    S = { items: {}, ref: {}, sentShipments: [], calendar: { days: {} }, checks: [], log: [] };
    const R = (S.ref = { customers: {}, stations: {}, stationTypes: {}, stationTypeOf: {}, stationTypeById: {}, itemTypes: {}, routes: {}, shipments: {}, packageLevelTypes: [] });
    S.boxes = {}; S.keys = {};
    for (const [k, c] of Object.entries({ C1: { name: "מפעלי רדאר צפון", customer_code: "101" }, C2: { name: "תעופה וחלל", customer_code: "202" } })) {
      R.customers[k] = (await api("POST", "/api/settings/customers", c)).json.id;
    }
    R.source = (await api("POST", "/api/settings/sources", { source_desc: "קו ייצור" })).json.source_id;
    for (const [k, [desc, stale, pl]] of Object.entries({ OPEN: ["פתיחת מארז", 30, true], VIS: ["בדיקה ויזואלית", 30, false], FUN: ["בדיקה תפקודית", 240, false], RES: ["מעבדת מחקר", 0, false], CLOSE: ["סגירת מארז", 60, true] })) {
      R.stationTypes[k] = (await api("POST", "/api/settings/test-stations-type", { test_type_desc: desc, package_level: pl, stale_after_minutes: stale })).json.test_station_type_id;
      if (pl) R.packageLevelTypes.push(R.stationTypes[k]);
    }
    for (const [k, [type, desc, isRes]] of Object.entries({ OPEN1: ["OPEN", "עמדת פתיחה 1", false], VIS1: ["VIS", "ויזואלית 1", false], VIS2: ["VIS", "ויזואלית 2", false], FUN1: ["FUN", "תפקודית 1", false], RES1: ["RES", "מעבדת מחקר 1", true], CLOSE1: ["CLOSE", "עמדת סגירה 1", false] })) {
      R.stations[k] = (await api("POST", "/api/settings/test-stations", { test_station_type_id: R.stationTypes[type], test_station_desc: desc, status: 2, is_research: isRes })).json.test_station_id;
      R.stationTypeOf[k] = R.stationTypes[type]; R.stationTypeById[R.stations[k]] = R.stationTypes[type];
    }
    for (const [k, [desc, steps]] of Object.entries({ RX: ["מקלט VHF", ["OPEN", "VIS", "FUN", "CLOSE"]], PSU: ["ספק כוח", ["OPEN", "VIS", "CLOSE"]] })) {
      R.itemTypes[k] = (await api("POST", "/api/settings/item-types", { item_type_desc: desc })).json.item_type_id;
      await api("POST", "/api/settings/testing-routes", { item_type_id: R.itemTypes[k], route_number: 1, route_steps: steps.map((x) => R.stationTypes[x]) });
    }
    R.itemTypes.KIT = (await api("POST", "/api/settings/item-types", { item_type_desc: "מארז מקלט", is_package: true, default_route_number: 1 })).json.item_type_id;
    await api("POST", "/api/settings/testing-routes", { item_type_id: R.itemTypes.KIT, route_number: 1, route_steps: [R.stationTypes.OPEN, R.stationTypes.CLOSE] });
    const saved = await api("PUT", `/api/settings/item-types/${R.itemTypes.KIT}/contents`, { default_route_number: 1, lines: [
      { item_type_id: R.itemTypes.RX, quantity: 2, route_number: 1, sort_order: 0, makat: "MK-RX", model: "RX-220", manufacturer_name: "Elta" },
      { item_type_id: R.itemTypes.PSU, quantity: 1, route_number: 1, sort_order: 1, makat: "MK-PSU", model: "PSU-12", manufacturer_name: "Elta" } ] });
    expect("package template saved without route warnings", [...(saved.json?.package_route_warnings || []), ...(saved.json?.lines || []).map((l) => l.route_warning).filter(Boolean)], []);
    // Work hours: template + an override for TODAY (now is outside the template's
    // hours), with a short break that stage-3 queue waits straddle.
    const tpl = { isWorking: true, start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" };
    for (let wd = 0; wd <= 5; wd++) await api("PUT", `/api/settings/work-hours/defaults/${wd}`, wd <= 4 ? tpl : { isWorking: false, start: null, end: null, breakStart: null, breakEnd: null });
    const now = Date.now();
    const bStart = Math.ceil((now + 4 * 60000) / 60000) * 60000, bEnd = bStart + 3 * 60000;
    const today = jlmYmd(now);
    const ov = await api("POST", "/api/settings/work-hours/overrides", { date: today, kind: "short_hours", start: "07:00", end: "23:59", breakStart: hhmm(bStart), breakEnd: hhmm(bEnd), note: "בדיקת דשבורד" });
    S.calendar.days[today] = [["07:00", hhmm(bStart)], [hhmm(bEnd), "23:59"]];
    S.calendar.days[jlmYmd(now + 86400000)] = [["07:00", "12:00"], ["13:00", "15:35"]];
    S.breakWindow = [bStart, bEnd];
    let rb;
    for (let i = 0; i < 8; i++) { rb = await api("POST", "/api/cron/rebuild-work-calendar", {}, { cron: true }); if (rb.json?.status !== "skipped_overlap") break; await sleep(1500); }
    console.log("override:", ov.status, "break", hhmm(bStart), "-", hhmm(bEnd), "rebuild:", JSON.stringify(rb.json));
    const cal = await q1(`SELECT work_seconds_between($1::timestamptz, $2::timestamptz) AS s`, [new Date(bStart - 60000).toISOString(), new Date(bEnd + 60000).toISOString()]);
    expect("calendar: 5 min straddling the 3-min break = 120 work-seconds", Number(cal.s), 120, 0.5);
    await checkDashboard("S1");
  },

  // S2 — two incoming shipments that declare boxes; the shipment mints pending boxes
  async 2() {
    for (const [k, c, qty] of [["SH1", "C1", 2], ["SH2", "C2", 1]]) {
      const r = await api("POST", "/api/shipments", {
        shipment_code: `IN-${k}-${Date.now() % 10000}`, customer_id: S.ref.customers[c], shipment_date: new Date().toISOString(),
        makat: "MK-KIT", amount: qty, recieving_worker_id: 4201, recieving_worker_name: "דנה פרץ",
        sending_worker_id: 4101, sending_worker_name: "אורי בן-דוד", source_id: S.ref.source, poc_details: "POC",
        shipment_items: [{ item_type_id: S.ref.itemTypes.KIT, quantity: qty, makat: "MK-KIT", model: "KIT-1", manufacturer_name: "Elta" }],
      });
      S.ref.shipments[k] = r.json.id;
      const boxes = (await api("POST", `/api/shipments/${r.json.id}/boxes`, {})).json?.boxes ?? [];
      S.pending = S.pending || {};
      boxes.forEach((b, i) => { S.pending[`${k}.BOX${i + 1}`] = String(b.item_id); });
      expect(`${k}: ${qty} pending boxes minted`, boxes.length, qty);
    }
    console.log("pending boxes:", JSON.stringify(S.pending));
    const d = await checkDashboard("S2");
    console.log("shipments tab:", JSON.stringify(d.ship.json).slice(0, 800));
  },

  // S3 — intake: the three box labels are scanned in. Box queued at OPEN,
  // its template items created behind it (hidden at OPEN until opened).
  async 3() {
    for (const [k, boxId] of Object.entries(S.pending)) {
      const key = k.replace(/^SH\d\./, `${k.split(".")[0]}-`);
      S.items[boxId] = { key, intervals: [], deleted: false, isBox: true }; S.keys[key] = boxId;
      const t0 = Date.now(); const r = await api("POST", "/api/packages/intake", { barcode: boxId }); const t1 = Date.now();
      expect(`intake ${key} 201`, r.status, 201);
      await observe(S, boxId, t0, t1, "item_created");
      await trackNewItems(key, t0, t1, "item_created");
    }
    console.log("boxes:", JSON.stringify(S.boxes));
    // what the opening station's screen shows vs what the dashboard says
    const screen = (await api("GET", `/api/testing/items?stationId=${S.ref.stations.OPEN1}`)).json || [];
    S.screenOpenQueue = screen.length;
    const d = await checkDashboard("S3");
    const openRow = d.board.json.find((r) => r.stationId === S.ref.stations.OPEN1);
    console.log(`opening station screen queue = ${screen.length} rows; dashboard itemsInQueue = ${openRow.itemsInQueue}; kpis.itemsCurrentlyInQueue=${d.kpis.json.itemsCurrentlyInQueue}`);
    expect("UX: opening-station queue on dashboard == rows on the station's own screen", openRow.itemsInQueue, screen.length);
    console.log("shipments:", JSON.stringify(d.ship.json).slice(0, 900));
    console.log("customers:", JSON.stringify(d.cust.json).slice(0, 600));
    console.log("types:", JSON.stringify(d.types.json).slice(0, 900));
  },

  // S4 — wait across the configured break, then box SH1-BOX1 is opened
  async 4() {
    const waitUntil = S.breakWindow[1] + 15000;
    if (Date.now() < waitUntil) { console.log(`waiting ${Math.round((waitUntil - Date.now()) / 1000)}s so the queue straddles the break…`); await sleep(waitUntil - Date.now()); }
    await groupStart("SH1-BOX1", "OPEN1");
    const d0 = await checkDashboard("S4a (box on the opening bench)");
    const openRow = d0.board.json.find((r) => r.stationId === S.ref.stations.OPEN1);
    expect("UX: opening bench shows ONE box in test", openRow.itemsInTest, 1);
    report("S4a"); results.length = 0;
    await sleep(5000);
    const v = await pkgView("SH1-BOX1");
    await api("PUT", `/api/packages/${ID("SH1-BOX1")}/contents`, { items: v.items.map((it, i) => ({ itemId: String(it.item_id), serialNumber: `SN-${Date.now() % 100000}-${i}` })), remove: [], add: [] });
    await wizard("SH1-BOX1", "OPEN1", "opening");
    const boxNow = curOf("SH1-BOX1");
    expect("opened box waits for its items (status 6)", boxNow.state, "waiting_for_package_items");
    for (const k of kidsOf("SH1-BOX1")) expect(`${k} queued at VIS`, [curOf(k).state, curOf(k).typeId], ["queued", S.ref.stationTypes.VIS]);
    await checkDashboard("S4b (box opened)");
  },

  // S5 — items of BOX1 through VIS: one passes, one fails into research, PSU passes
  async 5() {
    const [rx1, rx2, psu] = kidsOf("SH1-BOX1");
    await startTest(rx1, "VIS1"); await startTest(rx2, "VIS2");
    await checkDashboard("S5a (two items in test at VIS)"); report("S5a"); results.length = 0;
    await sleep(4000);
    await submit(rx1);
    await submit(rx2, { passed: false, body: { sendToResearch: true, SentAt: new Date().toISOString(), Comments: "חריגה" }, label: "sent_to_research" });
    await startTest(psu, "VIS1"); await sleep(2000); await submit(psu);
    expect(`${rx1} queued at FUN`, [curOf(rx1).state, curOf(rx1).typeId], ["queued", S.ref.stationTypes.FUN]);
    expect(`${rx2} waiting for research`, curOf(rx2).state, "queued_research");
    expect(`${psu} queued at CLOSE`, [curOf(psu).state, curOf(psu).typeId], ["queued", S.ref.stationTypes.CLOSE]);
    await checkDashboard("S5b");
  },

  // S6 — research: start, note, return to route
  async 6() {
    const rx2 = kidsOf("SH1-BOX1")[1];
    await sleep(3000); await startTest(rx2, "RES1", W2);
    expect(`${rx2} in research at RES1`, [curOf(rx2).state, curOf(rx2).stationId], ["in_research", S.ref.stations.RES1]);
    await submit(rx2, { passed: false, body: { Comments: "נמצא כשל בקבל C14" }, label: "research_note" }, W2);
    expect("research note keeps it in research", curOf(rx2).state, "in_research");
    await checkDashboard("S6a (in research)"); report("S6a"); results.length = 0;
    await sleep(3000);
    await submit(rx2, { passed: true, body: { returnToRoute: true, ReturnAt: new Date().toISOString() }, label: "returned_to_route" }, W2);
    console.log(`${rx2} after return:`, JSON.stringify(curOf(rx2)));
    await checkDashboard("S6b (returned to route)");
  },

  // S7 — user release and the stale reaper
  async 7() {
    const [rx1] = kidsOf("SH1-BOX1");
    await startTest(rx1, "FUN1", W2); await sleep(3000); await release(rx1, W2);
    expect(`${rx1} back in FUN queue after release`, [curOf(rx1).state, curOf(rx1).typeId], ["queued", S.ref.stationTypes.FUN]);
    await checkDashboard("S7a (after release)"); report("S7a"); results.length = 0;
    // reaper: the one declared clock forgery — only item_routes.processing_start_time
    await startTest(rx1, "FUN1");
    // processing_start_time is a naive timestamp holding UTC (§7.1), so the
    // backdate is written in UTC whatever the session TimeZone is.
    await q(`UPDATE item_routes SET processing_start_time = (now() AT TIME ZONE 'UTC') - interval '300 minutes' WHERE item_id = $1`, [ID(rx1)]);
    const r = await act("released_stale", [ID(rx1)], () => api("POST", "/api/cron/release-stale-tests", {}, { cron: true }));
    expect("reaper released 1", r.json?.releasedCount, 1);
    expect(`${rx1} back in FUN queue after reaper`, [curOf(rx1).state, curOf(rx1).typeId], ["queued", S.ref.stationTypes.FUN]);
    await checkDashboard("S7b (after reaper)");
  },

  // S8 — every item of BOX1 to CLOSE → box 6 → 2; close the box
  async 8() {
    for (let pass = 0; pass < 6; pass++) for (const k of kidsOf("SH1-BOX1")) {
      const c = curOf(k); if (c.state !== "queued" || c.typeId === S.ref.stationTypes.CLOSE) continue;
      const st = Object.entries(S.ref.stationTypeOf).find(([, t]) => t === c.typeId)[0];
      await startTest(k, st); await sleep(1500); await submit(k);
    }
    expect("box released to the CLOSE queue once all items arrived", [curOf("SH1-BOX1").state, curOf("SH1-BOX1").typeId], ["queued", S.ref.stationTypes.CLOSE]);
    await checkDashboard("S8a (box ready to close)"); report("S8a"); results.length = 0;
    await sleep(3000);
    await groupStart("SH1-BOX1", "CLOSE1"); await sleep(3000);
    await wizard("SH1-BOX1", "CLOSE1", "closing");
    expect("box done", curOf("SH1-BOX1").state, "done");
    for (const k of kidsOf("SH1-BOX1")) expect(`${k} done`, curOf(k).state, "done");
    const d = await checkDashboard("S8b (first box closed)");
    console.log("shipments:", JSON.stringify(d.ship.json).slice(0, 1200));
    console.log("customers:", JSON.stringify(d.cust.json).slice(0, 900));
    console.log("types:", JSON.stringify(d.types.json).slice(0, 1200));
    console.log("times:", JSON.stringify(d.times.json).slice(0, 900));
    console.log("hist(today):", JSON.stringify(d.hist.json?.at(-1)));
  },
  // S9 — the other two boxes: SH1-BOX2 all the way, SH2-BOX1 opened and left in flight
  async 9() {
    for (const box of ["SH1-BOX2", "SH2-BOX1"]) {
      await groupStart(box, "OPEN1"); await sleep(2000);
      const v = await pkgView(box);
      await api("PUT", `/api/packages/${ID(box)}/contents`, { items: v.items.map((it, i) => ({ itemId: String(it.item_id), serialNumber: `SN-${box}-${i}-${Date.now() % 1000}` })), remove: [], add: [] });
      await wizard(box, "OPEN1", "opening");
    }
    for (let pass = 0; pass < 6; pass++) for (const k of kidsOf("SH1-BOX2")) {
      const c = curOf(k); if (c.state !== "queued" || c.typeId === S.ref.stationTypes.CLOSE) continue;
      const st = Object.entries(S.ref.stationTypeOf).find(([, t]) => t === c.typeId && !/RES/.test(t))[0];
      await startTest(k, st); await sleep(1200); await submit(k);
    }
    await groupStart("SH1-BOX2", "CLOSE1"); await sleep(2000); await wizard("SH1-BOX2", "CLOSE1", "closing");
    expect("SH1-BOX2 done", curOf("SH1-BOX2").state, "done");
    // SH2-BOX1: one item to FUN and left IN TEST there, one waiting at VIS
    const [a, b] = kidsOf("SH2-BOX1");
    await startTest(a, "VIS1"); await sleep(1500); await submit(a); await startTest(a, "FUN1");
    const d = await checkDashboard("S9");
    const funRow = d.board.json.find((r) => r.stationId === S.ref.stations.FUN1);
    console.log("FUN1 board row:", JSON.stringify({ inTest: funRow.itemsInTest, age: funRow._new_activeTestAgeWallMinutes, ageWork: funRow._new_activeTestAgeWorkMinutes }));
    console.log("slow-items:", JSON.stringify(d.slow.json).slice(0, 600));
  },

  // S10 — shipment SH1 (both boxes done) is sent back; scope must drop it
  async 10() {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await api("POST", "/api/shipment-history", { shipment_id: S.ref.shipments.SH1, sent_date: new Date().toISOString(), sent_shipment_code: `OUT-${Date.now() % 10000}`, items: [{ item_type_id: S.ref.itemTypes.KIT, amount: 2, makat: "MK-KIT" }], signature_base64: png, sending_worker_id: 4101, sending_worker_name: "אורי בן-דוד" });
    expect("shipment send 201", r.status, 201);
    const sent = await q1("SELECT is_sent FROM shipments WHERE id = $1", [S.ref.shipments.SH1]);
    expect("SH1 is_sent", sent.is_sent, true);
    if (sent.is_sent) S.sentShipments.push(Number(S.ref.shipments.SH1));
    const open = await checkDashboard("S10 open_shipments");
    report("S10-open"); results.length = 0;
    const all = await checkDashboard("S10 all", { scope: "all" });
    const shipRow = all.ship.json.find((x) => x.shipmentId === S.ref.shipments.SH1);
    console.log("SH1 row (scope=all):", JSON.stringify(shipRow));
    expect("open_shipments hides SH1 on the shipments tab", open.ship.json.some((x) => x.shipmentId === S.ref.shipments.SH1), false);
    expect("scope=all shows SH1 with a ship turnaround", shipRow?._new_shipTurnaroundWallMinutes != null, true);
  },

  // S11 — the filter bar: customer, shipment, item type, station
  async 11() {
    const C2 = S.ref.customers.C2, SH2 = S.ref.shipments.SH2, RX = S.ref.itemTypes.RX, FUN1 = S.ref.stations.FUN1;
    await checkDashboard("customer=C2", { scope: "all", params: { customerId: String(C2) }, filter: (it) => it.customerId === C2 });
    report("S11-customer"); results.length = 0;
    await checkDashboard("shipment=SH2", { scope: "all", params: { shipmentId: String(SH2) }, filter: (it) => it.shipmentId === SH2 });
    report("S11-shipment"); results.length = 0;
    await checkDashboard("itemType=RX", { scope: "all", params: { itemTypeId: String(RX) }, filter: (it) => it.itemTypeId === RX });
    report("S11-itemType"); results.length = 0;
    await checkDashboard("station=FUN1", { scope: "all", params: { testStationId: String(FUN1) }, filter: (it, iv) => iv.stationId === FUN1 });
  },

  // S12 — a box is deleted (manager): every number it carried must disappear
  async 12() {
    const box = ID("SH2-BOX1"); const ids = [box, ...kidsOf("SH2-BOX1").map(ID)];
    // a row in test cannot be deleted from the screen — release it first, as the user would
    const [a] = kidsOf("SH2-BOX1");
    if (curOf(a).state === "testing") await release(a);
    const r = await api("DELETE", `/api/packages/${box}`, { cascade: true }, { expect: [200, 204] });
    console.log("delete:", r.status, r.text.slice(0, 200));
    if (r.ok) for (const id of ids) S.items[id].deleted = true;
    const left = await q1("SELECT count(*)::int n FROM item_state_interval WHERE item_id = ANY($1::bigint[])", [ids]);
    expect("ledger forgot every row of the deleted box", left.n, 0);
    await checkDashboard("S12 (after delete)", { scope: "all" });
  },
  // check-only: re-verify the current state against the model
  async 99() { await checkDashboard("S99 open_shipments"); report("S99-open"); results.length = 0; await checkDashboard("S99 all", { scope: "all" }); },
};

if (!stages[stageNo]) { console.error("no such stage"); process.exit(2); }
console.log(`=== stage ${stageNo} @ ${hhmm(Date.now())} ===`);
try {
  await stages[stageNo]();
  await ledgerInvariants();
} finally {
  report(`S${stageNo}`);
  saveState(S);
  await pool.end();
}
process.exit(anyFailed ? 1 : 0);
