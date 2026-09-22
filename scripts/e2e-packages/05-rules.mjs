// Rules and edge cases: retype after opening (warning + whole-box reset), last
// item, nested package, add-after-opening, cascade delete, shipments declare
// package types only, package-type settings API, the "item that never arrived"
// decision in the closing wizard, dashboard render.
import { launch, login, api, goto, shot, bodyHas, check, summary, resolveConfig } from "./lib.mjs";

// Ids are resolved by name from the running app after login (lib.mjs resolveConfig).
let OPENING_TYPE, CLOSING_TYPE, RESEARCH_TYPE, PKG_TYPE_AMP, TYPES;
const uuid = () => crypto.randomUUID();
const tag = Date.now().toString().slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = { WorkerID: 9902, WorkerName: "pkgtest" };

const { browser, page, errors } = await launch();
try {
  await login(page);
  ({ OPENING_TYPE, CLOSING_TYPE, RESEARCH_TYPE, PKG_TYPE: PKG_TYPE_AMP, TYPES } = await resolveConfig(page));
  const stations = async (typeId) => (await api(page, `/api/testing/test-stations?typeId=${typeId}`)).json || [];
  const openSt = (await stations(OPENING_TYPE)).find((s) => !s.is_research);
  const closeSt = (await stations(CLOSING_TYPE)).find((s) => !s.is_research);
  for (const st of [openSt, closeSt]) for (const r of ((await api(page, `/api/testing/items?stationId=${st.test_station_id}`)).json || []).filter((r) => r.is_package && r.current_status === 1)) {
    await api(page, "/api/testing/release-test", { method: "POST", body: JSON.stringify({ itemId: Number(r.item_id), stationId: st.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
  }
  const researchSt = (await stations(RESEARCH_TYPE)).find((s) => s.is_research);
  const ships = (await api(page, "/api/shipments")).json || [];
  const ship = ships[2] ?? ships[0];
  const view = async (id) => (await api(page, `/api/packages/${id}`)).json?.package;
  const mk = async (items, makat) => (await api(page, "/api/packages", { method: "POST", body: JSON.stringify({ customer: ship.customer_id, shipment: ship.id, packageType: PKG_TYPE_AMP, makat, items }) })).json?.packageId;
  const start = (itemId, st) => api(page, "/api/testing/start-test", { method: "POST", body: JSON.stringify({ itemId: Number(itemId), stationId: st.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
  const result = (itemId, st, extra = {}) => api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(itemId), StationID: st.test_station_id, SubmitID: uuid(), Result: 1, Passed: true, ...W, ...extra }) });
  const openBox = async (id) => {
    await start(id, openSt);
    const v = await view(id); const sid = uuid();
    for (const it of v.items) await result(it.item_id, openSt, { SubmitID: sid, Details: { opening: true } });
    await result(id, openSt, { SubmitID: sid, Details: { opening: true } });
    return view(id);
  };
  const advance = async (id, skipIds = []) => {
    const cache = new Map();
    for (let g = 0; g < 12; g++) {
      const v = await view(id);
      const pending = v.items.filter((i) => !skipIds.includes(String(i.item_id)) && !i.arrived_at_closing && i.state !== "done");
      if (!pending.length) break;
      for (const it of pending) {
        const d = (await api(page, `/api/items/${it.item_id}`)).json?.item; const step = d?.current_route_step ?? 1; const t = d?.route_steps?.[step - 1];
        if (!t || t === CLOSING_TYPE) continue;
        if (!cache.has(t)) cache.set(t, (await stations(t)).find((s) => !s.is_research));
        const st = cache.get(t); const s = await start(it.item_id, st);
        if (s.ok) await result(it.item_id, st, { CurrentRouteStep: step, RouteStepsLength: d.route_steps.length });
      }
    }
    return view(id);
  };

  // ---- A. retype after opening = warning + whole-box reset ----------------------
  const A = String(await mk([{ itemType: TYPES.amp, serialNumber: "RA-" + tag, makat: "MK-1", model: "m", manufacturer: "x" }, { itemType: TYPES.kit, serialNumber: "RK-" + tag, makat: "MK-2", model: "m", manufacturer: "x" }], "RULES-A-" + tag));
  check("A: box created", A.length === 16, A);
  const addBefore = await api(page, `/api/packages/${A}/items`, { method: "POST", body: JSON.stringify({ itemType: TYPES.cable, serialNumber: "RC-" + tag, makat: "MK-3", model: "m", manufacturer: "x" }) });
  check("A: adding an item while still at opening is allowed", addBefore.status === 201, `status ${addBefore.status} ${addBefore.json?.error ?? ""}`);
  const nested = await api(page, `/api/packages/${A}/items`, { method: "POST", body: JSON.stringify({ itemType: PKG_TYPE_AMP, serialNumber: "RN-" + tag, makat: "MK-9", model: "m", manufacturer: "x" }) });
  check("A: a package type cannot be an item inside a box", nested.status === 409 || nested.status === 400, `status ${nested.status} ${nested.json?.code ?? nested.json?.error ?? ""}`);
  let vA = await openBox(A);
  check("A: opened (waitItems, items at step 2)", vA.status === "waitItems" && vA.items.every((i) => i.current_route_step === 2), vA.status);
  const addAfter = await api(page, `/api/packages/${A}/items`, { method: "POST", body: JSON.stringify({ itemType: TYPES.cable, serialNumber: "RC2-" + tag, makat: "MK-3", model: "m", manufacturer: "x" }) });
  check("A: adding an item after opening is refused", addAfter.status === 409, `status ${addAfter.status} ${addAfter.json?.code ?? addAfter.json?.error ?? ""}`);
  const itemA = vA.items[0];
  const retype = await api(page, `/api/items/${itemA.item_id}`, { method: "PUT", body: JSON.stringify({ customer: ship.customer_id, itemType: TYPES.psu, serialNumber: itemA.serial_no, makat: itemA.makat, model: "m", manufacturer: "x", workerId: 9902, workerName: "pkgtest" }) });
  check("A: retype after opening warns (409 PACKAGE_RESET_REQUIRED)", retype.status === 409 && retype.json?.code === "PACKAGE_RESET_REQUIRED", `status ${retype.status} ${JSON.stringify(retype.json).slice(0, 160)}`);
  const retypeOk = await api(page, `/api/items/${itemA.item_id}`, { method: "PUT", body: JSON.stringify({ customer: ship.customer_id, itemType: TYPES.psu, serialNumber: itemA.serial_no, makat: itemA.makat, model: "m", manufacturer: "x", confirmPackageReset: true, workerId: 9902, workerName: "pkgtest" }) });
  check("A: confirmed retype resets the whole box", retypeOk.ok && Array.isArray(retypeOk.json?.packageReset) && retypeOk.json.packageReset.length >= 3, `status ${retypeOk.status} ${JSON.stringify(retypeOk.json).slice(0, 200)}`);
  vA = await view(A);
  check("A: box back in the opening queue with every item at step 1", vA.status === "queue" && vA.items.every((i) => i.current_route_step === 1 && i.state === "new"), `${vA.status} ${JSON.stringify(vA.items.map((i) => [i.item_type_desc, i.current_route_step, i.state]))}`);
  check("A: the retyped item now has the new type", vA.items.some((i) => i.item_type_id === TYPES.psu));
  check("A: the PUT reported the retype", retypeOk.json?.retyped === true);

  // ---- B. last item / cascade delete --------------------------------------------
  const B = String(await mk([{ itemType: TYPES.amp, serialNumber: "BA-" + tag, makat: "MK-1", model: "m", manufacturer: "x" }, { itemType: TYPES.kit, serialNumber: "BK-" + tag, makat: "MK-2", model: "m", manufacturer: "x" }], "RULES-B-" + tag));
  let vB = await view(B);
  const d1 = await api(page, `/api/items/${vB.items[0].item_id}`, { method: "DELETE" });
  const d2 = await api(page, `/api/items/${vB.items[1].item_id}`, { method: "DELETE" });
  check("B: first delete ok, deleting the LAST item is refused with LAST_PACKAGE_ITEM", d1.ok && d2.status === 409 && d2.json?.code === "LAST_PACKAGE_ITEM", `${d1.status} / ${d2.status} ${d2.json?.code ?? ""}`);
  const delB = await api(page, `/api/packages/${B}`, { method: "DELETE", body: JSON.stringify({ cascade: true }) });
  const goneB = await api(page, `/api/packages/${B}`);
  check("B: deleting the box cascades (box gone, 404 afterwards)", delB.ok && goneB.status === 404, `${delB.status} / ${goneB.status}`);

  // ---- C. shipments declare package types only ---------------------------------
  const badShip = await api(page, "/api/shipments", { method: "POST", body: JSON.stringify({ shipment_code: "PKG-BAD-" + tag, customer_id: ship.customer_id, shipment_date: new Date().toISOString(), amount: 2, recieving_worker_id: 9902, recieving_worker_name: "pkgtest", shipment_items: [{ item_type_id: TYPES.amp, quantity: 2, makat: "X" }] }) });
  check("C: POST /api/shipments refuses a non-package type", badShip.status === 400 && badShip.json?.code === "SHIPMENT_TYPES_MUST_BE_PACKAGES", `status ${badShip.status} ${badShip.json?.code ?? badShip.json?.error ?? ""}`);
  const goodShip = await api(page, "/api/shipments", { method: "POST", body: JSON.stringify({ shipment_code: "PKG-OK-" + tag, customer_id: ship.customer_id, shipment_date: new Date().toISOString(), amount: 3, recieving_worker_id: 9902, recieving_worker_name: "pkgtest", shipment_items: [{ item_type_id: PKG_TYPE_AMP, quantity: 3, makat: "KIT-X" }] }) });
  check("C: POST /api/shipments accepts package types", goodShip.status === 201, `status ${goodShip.status} ${goodShip.json?.error ?? ""}`);
  await goto(page, "/shipments");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("משלוח חדש"))?.click());
  await sleep(1000);
  check("C: new-shipment dialog shows מארזים במשלוח", await bodyHas(page, "מארזים במשלוח") && await bodyHas(page, "סה״כ מארזים"));
  await shot(page, "60-shipment-new-dialog");

  // ---- D. package-type settings API ---------------------------------------------
  const newType = await api(page, "/api/settings/item-types", { method: "POST", body: JSON.stringify({ item_type_desc: "מארז בדיקה " + tag, is_package: true, default_route_number: 1 }) });
  const newTypeId = newType.json?.item_type_id ?? newType.json?.id;
  check("D: create a package type", (newType.status === 201 || newType.ok) && newTypeId, `status ${newType.status} ${JSON.stringify(newType.json).slice(0, 120)}`);
  if (newTypeId) {
    const contents = await api(page, `/api/settings/item-types/${newTypeId}/contents`, { method: "PUT", body: JSON.stringify({ default_route_number: 1, lines: [{ item_type_id: TYPES.amp, quantity: 1, manufacturer_sku: "MK-6130" }, { item_type_id: TYPES.kit, quantity: 2 }] }) });
    check("D: save contents", contents.ok, `status ${contents.status} ${JSON.stringify(contents.json).slice(0, 160)}`);
    const list = (await api(page, "/api/settings/package-types")).json || [];
    const mine = list.find((t) => t.item_type_id === newTypeId);
    check("D: package-types list shows it with a health flag (no route yet → warn/none)", !!mine && ["warn", "none", "ok"].includes(mine.health), `${mine?.health} ${mine?.warning ?? ""}`);
    const del = await api(page, `/api/settings/item-types/${newTypeId}`, { method: "DELETE" });
    check("D: delete the unused package type", del.ok, `status ${del.status} ${del.json?.error ?? ""}`);
  }

  // ---- E. an item that finished elsewhere → decision at closing ----------------
  const E = String(await mk([{ itemType: TYPES.amp, serialNumber: "EA-" + tag, makat: "MK-1", model: "m", manufacturer: "x" }, { itemType: TYPES.kit, serialNumber: "EK-" + tag, makat: "MK-2", model: "m", manufacturer: "x" }], "RULES-E-" + tag));
  let vE = await openBox(E);
  const strayId = String(vE.items[0].item_id); // the amplifier: send to research at its step-2 station, then finish it there
  const dStray = (await api(page, `/api/items/${strayId}`)).json?.item;
  const st2 = (await stations(dStray.route_steps[1])).find((s) => !s.is_research);
  await start(strayId, st2);
  const toResearch = await result(strayId, st2, { sendToResearch: true, Comments: "לבדיקה במחקר", CurrentRouteStep: 2, RouteStepsLength: dStray.route_steps.length });
  check("E: item sent to research", toResearch.ok && toResearch.json?.recommendedResearchStation, `status ${toResearch.status} ${JSON.stringify(toResearch.json).slice(0, 160)}`);
  const rs = await start(strayId, researchSt);
  const fin = await result(strayId, researchSt, { finishRoute: true, Comments: "הסתיים במחקר" });
  check("E: research finished the item's route early", rs.ok && fin.ok, `${rs.status} / ${fin.status} ${JSON.stringify(fin.json).slice(0, 120)}`);
  vE = await advance(E, [strayId]);
  check("E: other item arrived; box ready to close with one item not arrived", vE.status === "readyClose" && vE.items.some((i) => !i.arrived_at_closing && i.state === "done"), `${vE.status} ${JSON.stringify(vE.items.map((i) => [i.state, i.arrived_at_closing]))}`);

  await goto(page, `/testing?type=${CLOSING_TYPE}&station=${closeSt.test_station_id}`);
  const startedClose = await page.evaluate((head) => { const b = [...document.querySelectorAll("button")].filter((x) => (x.innerText || "").includes("התחל סגירת מארז")).find((x) => (x.parentElement?.innerText || "").replace(/\s/g, "").includes(head)); b?.click(); return !!b; }, E.slice(0, 14));
  check("E: closing wizard started from the card", startedClose);
  await sleep(1500);
  await page.type('input[placeholder="סרוק את מדבקת הקופסה"]', "RULES-E-" + tag);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((e) => (e.innerText || "").trim() === "המשך"); b[b.length - 1]?.click(); });
  await sleep(800);
  check("E: arrival step shows the stray item as לא הגיע with a decision button", await bodyHas(page, "לא הגיע") && await bodyHas(page, "נדרשת החלטה"));
  await shot(page, "61-close-arrival-missing");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "נדרשת החלטה")?.click());
  await sleep(600);
  check("E: decision dialog opened", await bodyHas(page, "פריט שלא הגיע לסגירה"));
  await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => (d.innerText || "").trim() === "חסר במארז")?.click());
  await page.type('textarea[placeholder="מה קרה לפריט?"]', "נשאר במעבדת המחקר");
  await shot(page, "62-close-decision");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "שמור החלטה")?.click());
  await sleep(600);
  await page.evaluate(() => { [...document.querySelectorAll("span")].filter((s) => (s.innerText || "").trim() === "נארז").forEach((s) => s.click()); });
  await sleep(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((e) => (e.innerText || "").trim() === "המשך"); b[b.length - 1]?.click(); });
  await sleep(600);
  await page.evaluate(() => { [...document.querySelectorAll("span")].filter((s) => ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת הקופסה קריאה"].includes((s.innerText || "").trim())).forEach((s) => s.click()); });
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "סגור מארז")?.click());
  let closed = false; for (let i = 0; i < 60 && !closed; i++) { await sleep(500); closed = await bodyHas(page, "המארז נסגר"); }
  check("E: closing finished with a recorded decision", closed);
  await shot(page, "63-close-done-missing");
  vE = await view(E);
  const stray = vE.items.find((i) => String(i.item_id) === strayId);
  check("E: box done; the stray item carries pack_decision=missing and its note", vE.status === "done" && stray?.pack_decision === "missing" && (stray?.pack_note || "").includes("מחקר"), `${vE.status} ${stray?.pack_decision} ${stray?.pack_note}`);
  await goto(page, `/packages/${E}`);
  check("E: package page shows the missing item", await bodyHas(page, "חסר במארז"));
  await shot(page, "64-package-page-missing");

  // ---- F. dashboard renders with packages --------------------------------------
  await goto(page, "/dashboard/tests");
  check("F: /dashboard/tests renders", !(await bodyHas(page, "Application error")), "");
  await shot(page, "70-dashboard");

  const realErrors = errors.filter((e) => !/409|400|404/.test(e));
  check("no page errors / 5xx during rules run", realErrors.length === 0, realErrors.slice(0, 5).join(" || "));
} catch (e) {
  check("rules script completed", false, e.stack?.split("\n").slice(0, 2).join(" "));
  console.log("browser errors so far:", errors.slice(0, 8).join("\n  "));
  await shot(page, "99-rules-error");
} finally {
  summary();
  await browser.close();
}
