// Full package lifecycle through the APIs the screens use, with the testing
// screen photographed at each stage: intake → opening (group start, per-item
// results + box result under one submit id) → items through their own stations
// → meeting point (status 6 / closing queue) → closing → done.
import { launch, login, api, goto, shot, bodyHas, check, summary } from "./lib.mjs";

const OPENING_TYPE = 5;  // אשף קליטה (dev config)
const CLOSING_TYPE = 8;  // בדיקת סביבה (dev config)
const PKG_TYPE_AMP = 15; // מארז מגבר: מגבר הספק + ערכת מחברים + כבל תדר גבוה
const TYPES = { amp: 6, kit: 11, cable: 10 };
const uuid = () => crypto.randomUUID();
const tag = Date.now().toString().slice(-6);

const { browser, page, errors } = await launch();
try {
  await login(page);
  const stations = async (typeId) => (await api(page, `/api/testing/test-stations?typeId=${typeId}`)).json || [];
  const openSt = (await stations(OPENING_TYPE)).find((s) => !s.is_research);
  const closeSt = (await stations(CLOSING_TYPE)).find((s) => !s.is_research);
  check("opening and closing stations exist", !!openSt && !!closeSt, `${openSt?.test_station_desc} / ${closeSt?.test_station_desc}`);

  // ---- 1. intake ---------------------------------------------------------------
  const ships = (await api(page, "/api/shipments")).json || [];
  const ship = ships.find((s) => s.shipment_items?.some((l) => l.item_type_id === PKG_TYPE_AMP)) ?? ships[0];
  const create = await api(page, "/api/packages", {
    method: "POST",
    body: JSON.stringify({
      customer: ship.customer_id, shipment: ship.id, packageType: PKG_TYPE_AMP, makat: "KIT-AMP-" + tag,
      items: [
        { itemType: TYPES.amp, serialNumber: "AMP-" + tag, makat: "MK-6130", model: "A1", manufacturer: "Acme" },
        { itemType: TYPES.kit, serialNumber: "KIT-" + tag, makat: "745781", model: "K1", manufacturer: "Acme" },
        { itemType: TYPES.cable, serialNumber: "CBL-" + tag, makat: "CB-9", model: "C1", manufacturer: "Acme" },
      ],
    }),
  });
  check("POST /api/packages creates a box with 3 items", create.status === 201 && create.json?.packageId, `status ${create.status} ${create.json?.error ?? ""} ${create.text ?? ""}`);
  const pkgId = String(create.json?.packageId ?? "");
  check("new id is 16 digits ending 00", pkgId.length === 16 && pkgId.endsWith("00"), pkgId);
  let view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("box waits at opening with 3 items 01..03", view?.status === "queue" && view.items.map((i) => i.package_seq).join(",") === "1,2,3" && view.items.every((i) => String(i.item_id) === pkgId.slice(0, 14) + String(i.package_seq).padStart(2, "0")), JSON.stringify(view?.items.map((i) => [i.item_id, i.state])));

  // guard rails
  const lock = await api(page, `/api/packages/${pkgId}`, { method: "PATCH", body: JSON.stringify({ itemType: 13 }) });
  check("package type is locked (409)", lock.status === 409, `status ${lock.status} ${lock.json?.code ?? ""}`);
  const lastDel = await api(page, `/api/items/${view.items[0].item_id}`, { method: "DELETE" });
  check("deleting one of several items is allowed, not the last", lastDel.ok || lastDel.status === 409, `status ${lastDel.status}`);
  if (lastDel.ok) {
    const back = await api(page, `/api/packages/${pkgId}/items`, { method: "POST", body: JSON.stringify({ itemType: TYPES.amp, serialNumber: "AMP-" + tag + "b", makat: "MK-6130", model: "A1", manufacturer: "Acme" }) });
    check("re-adding an item gets the next position (04, never reused)", back.status === 201 && String(back.json?.itemId ?? back.json?.item_id ?? "").endsWith("04"), `status ${back.status} ${JSON.stringify(back.json).slice(0, 120)}`);
  }
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;

  // ---- 2. testing screen: opening queue shows the box -------------------------
  await goto(page, `/testing?type=${OPENING_TYPE}&station=${openSt.test_station_id}`);
  check("opening queue is a package grid with the new box", await bodyHas(page, "מארזים בתור") && await bodyHas(page, "התחל פתיחת מארז") && await bodyHas(page, pkgId.slice(0, 4)), "");
  await shot(page, "20-opening-queue");

  const queue = (await api(page, `/api/testing/items?stationId=${openSt.test_station_id}`)).json || [];
  const row = queue.find((r) => String(r.item_id) === pkgId);
  check("queue API lists the box with its package view and hides its items", !!row?.is_package && row.package?.items?.length === view.items.length && !queue.some((r) => String(r.package_id) === pkgId), `${queue.length} rows`);

  // ---- 3. opening: group start, per-item results, box result -----------------
  const start = await api(page, "/api/testing/start-test", { method: "POST", body: JSON.stringify({ itemId: Number(pkgId), stationId: openSt.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
  check("start-test on the box (group start)", start.ok, `status ${start.status} ${JSON.stringify(start.json).slice(0, 160)}`);
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("box and all items are in test after group start", view?.status === "test" && view.items.every((i) => i.state === "test"), JSON.stringify(view?.items.map((i) => i.state)));
  await goto(page, `/testing?type=${OPENING_TYPE}&station=${openSt.test_station_id}`);
  await shot(page, "21-opening-in-test");

  const submitId = uuid();
  for (const it of view.items) {
    const r = await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(it.item_id), StationID: openSt.test_station_id, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: submitId, Result: 1, Passed: true, Details: { opening: true, package_id: pkgId } }) });
    check(`item ${it.package_seq} result at opening`, r.ok, `status ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  }
  const boxRes = await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(pkgId), StationID: openSt.test_station_id, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: submitId, Result: 1, Passed: true, Details: { opening: true, itemCount: view.items.length } }) });
  check("box result at opening", boxRes.ok, `status ${boxRes.status} ${JSON.stringify(boxRes.json).slice(0, 200)}`);
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("after opening: box waits for its items (status 6) and items are queued at step 2", view?.status === "waitItems" && view.items.every((i) => i.state === "queue" && i.current_route_step === 2), `${view?.status} ${JSON.stringify(view?.items.map((i) => [i.state, i.current_route_step, i.station_name]))}`);
  check("blocked_by lists every item", view?.blocked_by?.length === view.items.length);

  // closing station banner
  await goto(page, `/testing?type=${CLOSING_TYPE}&station=${closeSt.test_station_id}`);
  check("closing station shows the waiting banner for this box", await bodyHas(page, "ממתינים לפריטים לפני הסגירה") || await bodyHas(page, "ממתין לפריטים לפני הסגירה"), "");
  await shot(page, "22-closing-banner");

  // ---- 4. items through their own stations -----------------------------------
  // each item: current step's type → pick a station → start → result, until it reaches the closing type
  const routes = new Map();
  for (let guard = 0; guard < 12; guard++) {
    view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
    const pending = view.items.filter((i) => !i.arrived_at_closing && i.state !== "done");
    if (pending.length === 0) break;
    for (const it of pending) {
      const detail = (await api(page, `/api/items/${it.item_id}`)).json?.item;
      const step = detail?.current_route_step ?? 1;
      const stepType = detail?.route_steps?.[step - 1];
      if (!stepType || stepType === CLOSING_TYPE) continue;
      if (!routes.has(stepType)) routes.set(stepType, (await stations(stepType)).find((s) => !s.is_research));
      const st = routes.get(stepType);
      const s = await api(page, "/api/testing/start-test", { method: "POST", body: JSON.stringify({ itemId: Number(it.item_id), stationId: st.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
      const r = s.ok ? await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(it.item_id), StationID: st.test_station_id, CurrentRouteStep: step, RouteStepsLength: detail.route_steps.length, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: uuid(), Result: 1, Passed: true }) }) : s;
      if (!r.ok) check(`item ${it.package_seq} step ${step} at type ${stepType}`, false, `status ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
    }
  }
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("all items arrived at the closing step", view.items.every((i) => i.arrived_at_closing), JSON.stringify(view.items.map((i) => [i.state, i.current_route_step, i.arrived_at_closing])));
  check("meeting point: box moved from waitItems to the closing queue", view.status === "readyClose", view.status);

  await goto(page, `/testing?type=${CLOSING_TYPE}&station=${closeSt.test_station_id}`);
  check("closing queue shows the box with N/N arrived", await bodyHas(page, "התחל סגירת מארז") && await bodyHas(page, `${view.items.length}/${view.items.length} הגיעו לסגירה`), "");
  await shot(page, "23-closing-queue");

  // ---- 5. closing --------------------------------------------------------------
  const cs = await api(page, "/api/testing/start-test", { method: "POST", body: JSON.stringify({ itemId: Number(pkgId), stationId: closeSt.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
  check("start-test on the box at closing", cs.ok, `status ${cs.status} ${JSON.stringify(cs.json).slice(0, 160)}`);
  const closeSubmit = uuid();
  for (const it of view.items) {
    const r = await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(it.item_id), StationID: closeSt.test_station_id, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: closeSubmit, Result: 1, Passed: true, Details: { closing: true, packed: true } }) });
    check(`item ${it.package_seq} result at closing`, r.ok, `status ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  }
  const cr = await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(pkgId), StationID: closeSt.test_station_id, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: closeSubmit, Result: 1, Passed: true, Details: { closing: true, packed: view.items.map((i) => i.item_id), decisions: [] } }) });
  check("box result at closing", cr.ok, `status ${cr.status} ${JSON.stringify(cr.json).slice(0, 200)}`);
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("package done, every item done", view.status === "done" && view.items.every((i) => i.state === "done") && view.finished_count === view.items.length, `${view.status} ${view.finished_count}/${view.items.length}`);

  await goto(page, `/packages/${pkgId}`);
  check("package page shows the completed timeline", await bodyHas(page, "הושלם"), "");
  await shot(page, "24-package-done");
  await goto(page, "/shipments");
  await shot(page, "25-shipments-after");

  // ---- 6. legacy loose item still works at a regular station ----------------
  const legacyQueue = (await api(page, `/api/testing/items?stationId=15`)).json || [];
  check("regular station queue still lists legacy loose items as item rows", legacyQueue.length > 0 && legacyQueue.every((r) => !r.is_package), `${legacyQueue.length} rows`);

  const realErrors = errors.filter((e) => !/409/.test(e)); // the type-lock check above deliberately triggers a 409
  check("no page errors / 5xx during flow", realErrors.length === 0, realErrors.slice(0, 5).join(" || "));
} catch (e) {
  check("flow script completed", false, e.stack?.split("\n").slice(0, 2).join(" "));
  await shot(page, "99-flow-error");
} finally {
  summary();
  await browser.close();
}
