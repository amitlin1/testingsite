// Independent oracle for scripts/dashboard-stepwise (see README.md): built ONLY from (a) the harness's own action log with
// client-side timestamps and (b) the operational item_routes row read after
// each action. Never reads item_state_event / item_state_interval / route_run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { q1 } from "./lib.mjs";

export const STATE_FILE = process.env.STATE_FILE || path.join(os.tmpdir(), "dashboard-stepwise-state.json");
export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; }
}
export function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const STATUS_TO_STATE = { 1: "testing", 2: "queued", 3: "done", 4: "queued_research", 5: "in_research", 6: "waiting_for_package_items" };

/** Read the operational truth for one item. */
export async function opRow(itemId) {
  return q1(
    `SELECT ir.current_status, ir.current_route_step, ir.test_station_id, ir.is_finished,
            ir.route_number, tr.route_steps, i.customer_id, i.shipment_id, i.item_type_id,
            i.package_id
       FROM items i
       LEFT JOIN item_routes ir ON ir.item_id = i.item_id
       LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
      WHERE i.item_id = $1`, [String(itemId)]);
}

/** Derive the model state of an item from its operational row. */
export function stateOf(row) {
  if (!row || row.current_status == null) return null;
  const state = row.is_finished ? "done" : STATUS_TO_STATE[row.current_status] ?? "unmapped";
  const steps = row.route_steps || [];
  // current_route_step is 1-based in this schema (verified on stage 3)
  const typeId = steps[(row.current_route_step ?? 1) - 1] ?? null;
  const atStation = state === "testing" || state === "in_research";
  return {
    state,
    stationId: atStation ? Number(row.test_station_id) || null : null,
    // queue intervals carry the TYPE they wait for; queued_research carries none
    typeId: state === "queued_research" || state === "done" || state === "waiting_for_package_items" ? null : typeId,
    step: row.current_route_step,
  };
}

/**
 * Called after every API action with the request's [t0,t1] window. If the
 * operational state moved, close the previous model interval at the request
 * midpoint and open a new one. Tolerance is carried per boundary.
 */
export async function observe(S, itemId, t0, t1, label) {
  const row = await opRow(itemId);
  const st = stateOf(row);
  const it = S.items[itemId];
  const mid = (t0 + t1) / 2, tol = (t1 - t0) / 2 + 50;
  const cur = it.intervals[it.intervals.length - 1];
  const same = cur && st && cur.state === st.state && cur.stationId === st.stationId && cur.typeId === st.typeId && cur.step === st.step;
  if (!same && st) {
    if (cur) { cur.end = mid; cur.endTol = tol; cur.exit = label; }
    it.intervals.push({ ...st, start: mid, startTol: tol, end: null, entry: label });
  }
  if (cur && st && same && /release|reaper|stale/.test(label) && !label.includes("(group)")) {
    // a release that lands in the same state/type is still a new attempt
    cur.end = mid; cur.endTol = tol; cur.exit = label;
    it.intervals.push({ ...st, start: mid, startTol: tol, end: null, entry: label });
  }
  it.customerId = row.customer_id; it.isPackageItem = row.package_id != null; it.unitId = row.package_id != null ? String(row.package_id) : String(itemId); it.shipmentId = Number(row.shipment_id); it.itemTypeId = row.item_type_id;
  return st;
}

// ---- the work calendar, re-implemented independently ----------------------
// S.calendar.days: { "YYYY-MM-DD": [[startHHMM,endHHMM],...] } in Asia/Jerusalem.
function jerusalemOffsetMs(ms) {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}
export function jlmYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(ms));
}
function jlmInstant(ymd, hhmm) {
  const [y, m, d] = ymd.split("-").map(Number); const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - jerusalemOffsetMs(guess);
}
export function workMs(S, a, b) {
  if (b <= a) return 0;
  let total = 0;
  for (const [ymd, spans] of Object.entries(S.calendar.days)) {
    for (const [s, e] of spans) {
      const lo = Math.max(a, jlmInstant(ymd, s)), hi = Math.min(b, jlmInstant(ymd, e));
      if (hi > lo) total += hi - lo;
    }
  }
  return total;
}

// ---- expected metrics -----------------------------------------------------
const WAITING = new Set(["queued", "queued_research", "waiting_for_package_items"]);
const ACTIVE = new Set(["testing", "in_research"]);

export function liveItems(S, { scope = "open_shipments" } = {}) {
  return Object.entries(S.items).filter(([, it]) => !it.deleted && (scope === "all" || !S.sentShipments.includes(it.shipmentId)));
}
const pass = (opts, it, iv) => !opts?.filter || opts.filter(it, iv);

export function expectedLive(S, opts) {
  const byState = {}; const byStation = {}; const typeQueue = {}; let researchPool = 0;
  for (const [, it] of liveItems(S, opts)) {
    const cur = it.intervals[it.intervals.length - 1];
    if (!cur || cur.state === "done" || !pass(opts, it, cur)) continue;
    byState[cur.state] = (byState[cur.state] || 0) + 1;
    // the board counts what the station sees: at a package-level step, the box
    const hidden = it.isPackageItem && (S.ref.packageLevelTypes || []).includes(cur.stationId ? S.ref.stationTypeById?.[cur.stationId] : cur.typeId);
    if (cur.stationId && !hidden) {
      byStation[cur.stationId] ??= { testing: 0, in_research: 0 };
      byStation[cur.stationId][cur.state]++;
    }
    if (cur.state === "queued" && !hidden) typeQueue[cur.typeId] = (typeQueue[cur.typeId] || 0) + 1;
    if (cur.state === "queued_research") researchPool++;
  }
  return { byState, byStation, typeQueue, researchPool };
}

/** Q5-equivalent: every non-terminal interval overlapping [from,to), clipped. */
export function expectedKpiWindow(S, fromMs, toMs, nowMs, opts) {
  const w = [], b = [], rw = [], rb = []; let off = 0; let finished = 0; const units = new Set();
  for (const [id, it] of liveItems(S, opts)) {
    for (const iv of it.intervals) {
      if (!pass(opts, it, iv)) continue;
      if (iv.state === "done") {
        if (iv.start >= fromMs && iv.start < toMs) finished++;
        continue;
      }
      const end = iv.end ?? nowMs;
      const lo = Math.max(iv.start, fromMs), hi = Math.min(end, toMs);
      if (!(iv.start < toMs && (iv.end == null || iv.end > fromMs))) continue;
      const wall = Math.max(0, hi - lo), work = workMs(S, lo, hi);
      units.add(it.unitId ?? id);
      off += wall - work;
      if (WAITING.has(iv.state)) { w.push([wall, work]); if (iv.state === "queued_research") rw.push([wall, work]); }
      const pkgDup = it.isPackageItem && (S.ref.packageLevelTypes || []).includes(S.ref.stationTypeById?.[iv.stationId]);
      if (ACTIVE.has(iv.state) && !pkgDup) { b.push([wall, work]); if (iv.state === "in_research") rb.push([wall, work]); }
    }
  }
  const avg = (a, k) => (a.length ? a.reduce((s, x) => s + x[k], 0) / a.length / 60000 : null);
  return {
    avg_wait_wall_min: avg(w, 0), avg_wait_work_min: avg(w, 1), wait_n: w.length,
    avg_busy_wall_min: avg(b, 0), avg_busy_work_min: avg(b, 1), busy_n: b.length,
    research_wait_wall: avg(rw, 0), research_wall: avg(rb, 0),
    offhours_min: off / 60000, units_touched: units.size, finished,
  };
}

/** Q4-equivalent over CLOSED intervals, grouped by a key fn. */
export function expectedFlow(S, family, keyFn, opts) {
  const fam = family === "waiting" ? WAITING : ACTIVE;
  const out = {};
  for (const [id, it] of liveItems(S, opts)) {
    for (const iv of it.intervals) {
      if (!fam.has(iv.state) || iv.end == null) continue;
      const k = keyFn(iv, it, id);
      const o = (out[k] ??= { n: 0, processed: 0, abandon: 0, wall: 0, work: 0 });
      o.n++; o.wall += iv.end - iv.start; o.work += workMs(S, iv.start, iv.end);
      if (/release|reaper/.test(iv.exit)) o.abandon++; else o.processed++;
    }
  }
  return out;
}
