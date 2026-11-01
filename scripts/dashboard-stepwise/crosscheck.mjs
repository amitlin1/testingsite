// Dashboard vs the OPERATIONAL tables (item_routes / items), with no harness model.
import { api, login, pool, q } from "./lib.mjs";
await login();
const res = []; const ok = (n, a, e) => res.push({ n, a, e, ok: JSON.stringify(a) === JSON.stringify(e) });
const d = new Date();
const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7).toISOString(), e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16).toISOString();
const P = (scope, x = "") => `startDate=${s}&endDate=${e}&scope=${scope}${x}`;
const timed = async (path) => { const t = Date.now(); const r = await api("GET", path); return { ...r, ms: Date.now() - t }; };

for (const scope of ["open_shipments", "all"]) {
  const sentFilter = scope === "all" ? "" : "AND sh.is_sent IS NOT TRUE";
  // 1. live distribution: every unfinished route row by status
  const op = await q(`SELECT ir.current_status s, count(*)::int n FROM item_routes ir JOIN items i ON i.item_id = ir.item_id JOIN shipments sh ON sh.id = i.shipment_id
                       WHERE NOT ir.is_finished ${sentFilter} GROUP BY 1`);
  const opMap = Object.fromEntries(op.map((r) => [r.s, r.n]));
  const dist = await timed(`/api/dashboard/tests/status-distribution?${P(scope)}`);
  const dm = Object.fromEntries(dist.json.map((r) => [r._new_stateKey, r.count]));
  for (const [st, key] of [[1, "testing"], [2, "queued"], [4, "queued_research"], [5, "in_research"], [6, "waiting_for_package_items"]]) ok(`[${scope}] live ${key}`, dm[key] ?? 0, opMap[st] ?? 0);
  const k = await timed(`/api/dashboard/tests/kpis?${P(scope)}`);
  ok(`[${scope}] kpi queue`, k.json.itemsCurrentlyInQueue, (opMap[2] ?? 0) + (opMap[4] ?? 0) + (opMap[6] ?? 0));
  ok(`[${scope}] kpi in test`, k.json.itemsCurrentlyInTest, (opMap[1] ?? 0) + (opMap[5] ?? 0));
  const fin = await q(`SELECT count(*)::int n FROM item_routes ir JOIN items i ON i.item_id = ir.item_id JOIN shipments sh ON sh.id = i.shipment_id
                        WHERE ir.is_finished AND (ir.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem')::date = (now() AT TIME ZONE 'Asia/Jerusalem')::date ${sentFilter}`);
  ok(`[${scope}] kpi finished today`, k.json.treatedCount, fin[0].n);

  // 2. per shipment: runs by state (the tab's columns) vs item_routes, boxes vs declared
  const sh = await timed(`/api/dashboard/tests/shipments?${P(scope)}`);
  const ops = await q(`SELECT i.shipment_id::int id, count(*) FILTER (WHERE NOT ir.is_finished AND ir.current_status=2)::int queue,
                              count(*) FILTER (WHERE NOT ir.is_finished AND ir.current_status=1)::int test,
                              count(*) FILTER (WHERE ir.is_finished)::int fin, count(*)::int runs,
                              count(*) FILTER (WHERE i.package_id IS NULL)::int boxes,
                              count(*) FILTER (WHERE i.package_id IS NULL AND ir.is_finished)::int boxes_fin
                         FROM item_routes ir JOIN items i ON i.item_id = ir.item_id GROUP BY 1`);
  for (const r of sh.json) {
    const o = ops.find((x) => x.id === r.shipmentId) ?? { queue: 0, test: 0, fin: 0, runs: 0, boxes: 0, boxes_fin: 0 };
    ok(`[${scope}] ship ${r.shipmentCode} queue/test/finished (runs)`, [r.itemsInQueue, r.itemsInTest, r.itemsFinished], [o.queue, o.test, o.fin]);
    ok(`[${scope}] ship ${r.shipmentCode} UNIT CONSISTENCY: finished <= total`, r.itemsFinished <= r.totalItems, true);
  }
  // 3. the board vs each station's own screen (/api/testing/items)
  const board = await timed(`/api/dashboard/tests/by-station?${P(scope)}`);
  for (const b of board.json) {
    const screen = (await api("GET", `/api/testing/items?stationId=${b.stationId}`)).json || [];
    const inTest = screen.filter((x) => x.current_status === 1 || x.current_status === 5).length;
    const queued = screen.filter((x) => x.current_status === 2).length;
    ok(`[${scope}] board ${b.stationName}: in test == station screen`, b.itemsInTest + (b._new_itemsInResearch ?? 0), inTest);
    // the queue is the TYPE's; a station's screen shows that same type queue
    if (!/מחקר/.test(b.stationName)) ok(`[${scope}] board ${b.stationName}: queue == station screen`, b.itemsInQueue, queued);
  }
  console.log(`[${scope}] latency ms: kpis=${k.ms} dist=${dist.ms} ships=${sh.ms} board=${board.ms}`);
}
const bad = res.filter((r) => !r.ok);
console.log(`\n${res.length - bad.length}/${res.length} OK`);
for (const r of bad) console.log(`  XX ${r.n}: dashboard=${JSON.stringify(r.a)} operational=${JSON.stringify(r.e)}`);
await pool.end();
