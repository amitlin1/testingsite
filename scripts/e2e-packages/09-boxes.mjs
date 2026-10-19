// A box from the shipment to its opening (docs/packages/PLAN.md §6, 2026-10-19):
// the shipment mints pending boxes with its line's certificate details, their
// labels print from the shipment, the intake scans them into their routes (no
// serials; the items take the box's details), the opening station's contents
// step records what is in the box with a serial for every item.
import { launch, login, api, goto, shot, bodyHas, check, summary, resolveConfig } from "./lib.mjs";

const tag = `X${Date.now().toString().slice(-6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const post = (page, p, body, method = "POST") => api(page, p, { method, body: JSON.stringify(body) });

const { browser, page, errors } = await launch();
page.setDefaultTimeout(90000);
try {
  await login(page);
  const { OPENING_TYPE, PKG_TYPE, TYPES } = await resolveConfig(page);
  const template = (await api(page, `/api/settings/item-types/${PKG_TYPE}/contents`)).json?.lines ?? [];
  const units = template.reduce((n, l) => n + Math.max(1, Number(l.quantity)), 0);
  const ship0 = ((await api(page, "/api/shipments")).json || [])[0];
  // The line as a scanned certificate row leaves it: the whole row, makat / version (model) / manufacturer for the boxes.
  const ROW = { cert_row_no: "4", serial_no: `SN-${tag}`, batch_size: "1", qty_to_test: 1, purchase_order: `PO-${tag}`, cert_row_raw: `4|MN-${tag}|CERT-MFR|MD-${tag}|MK-${tag}|SN-${tag}|1|1|PO-${tag}` };
  const line = (qty) => ({ item_type_id: PKG_TYPE, quantity: qty, makat: `MK-${tag}`, model: `MD-${tag}`, manufacturer_name: "CERT-MFR", manufacturer_no: `MN-${tag}`, ...ROW });
  const rowOf = (l) => l && Object.keys(ROW).every((k) => l[k] === ROW[k]);
  const certOf = (x) => `${(x.makat ?? "").trim()}|${(x.model ?? "").trim()}|${(x.manufacturer_name ?? "").trim()}|${(x.manufacturer_no ?? "").trim()}`;
  const CERT = `MK-${tag}|MD-${tag}|CERT-MFR|MN-${tag}`;
  const newShipment = (code, qty) => post(page, "/api/shipments", {
    shipment_code: code, customer_id: ship0.customer_id, shipment_date: new Date().toISOString(), amount: qty, source_id: 1,
    shipment_items: [line(qty)],
  });

  // ---- the shipment mints its boxes ------------------------------------------
  const created = await newShipment(tag, 3);
  const sid = created.json?.id;
  check("shipment saved", created.status === 201, `${created.status}`);
  const savedLine = ((await api(page, "/api/shipments")).json || []).find((s) => s.id === sid)?.shipment_items?.[0];
  check("the line keeps the whole certificate row", rowOf(savedLine) && certOf(savedLine) === CERT, JSON.stringify(savedLine));
  let boxes = (await post(page, `/api/shipments/${sid}/boxes`, {})).json?.boxes ?? [];
  check("3 pending boxes, ids ending 00, the line's certificate details", boxes.length === 3 && boxes.every((b) => b.status === "pending" && /^1\d{13}00$/.test(b.item_id) && certOf(b) === CERT), JSON.stringify(boxes.map((b) => [b.item_id, b.status, certOf(b)])));
  const ids = boxes.map((b) => b.item_id);
  const loc = await api(page, `/api/testing/locate-by-barcode?barcode=${ids[0]}`);
  check("a station scan of a pending box says it was not taken in", loc.status === 404 && loc.json?.pendingIntake === true, JSON.stringify(loc.json));
  check("the items list leaves pending boxes out", !((await api(page, "/api/items")).json || []).some((i) => ids.includes(String(i.item_id))));

  // ---- shipment edits follow the boxes -----------------------------------------
  const ship = ((await api(page, "/api/shipments")).json || []).find((s) => s.id === sid);
  const put = (qty) => post(page, `/api/shipments/${sid}`, {
    shipment_code: tag, customer_id: ship0.customer_id, shipment_date: ship.shipment_date, amount: Math.max(qty, 1), source_id: 1,
    shipment_items: [line(qty)],
  }, "PUT");
  let r = await put(2);
  boxes = (await post(page, `/api/shipments/${sid}/boxes`, {})).json?.boxes ?? [];
  check("quantity 3 → 2 drops the newest pending box", r.ok && boxes.length === 2 && boxes.every((b) => ids.slice(0, 2).includes(b.item_id)), boxes.map((b) => b.item_id).join());
  check("an edit keeps the line's details on the boxes", boxes.every((b) => certOf(b) === CERT), JSON.stringify(boxes.map(certOf)));
  check("… and the row on the line", rowOf(((await api(page, "/api/shipments")).json || []).find((s) => s.id === sid)?.shipment_items?.[0]));

  // ---- labels from the shipments page -------------------------------------------
  await goto(page, "/shipments");
  await page.waitForFunction((t) => document.body.innerText.includes(t), {}, tag);
  const opened = await page.evaluate((t) => {
    const row = [...document.querySelectorAll("tr")].find((x) => x.innerText.includes(t));
    const b = row && [...row.querySelectorAll("button")].find((x) => /מדבקות/.test(x.getAttribute("aria-label") ?? x.title ?? ""));
    b?.click(); return !!b;
  }, tag);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.innerText.includes("יודפסו")), { timeout: 20000 }).catch(() => {});
  const labelText = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText.replace(/\s+/g, " ")).pop() ?? "");
  check("labels: one per box, with the box ids", opened && labelText.includes("יודפסו 2 מדבקות") && (labelText.match(/\d{4} \d{4} \d{4} \d{2} 00/g) ?? []).length === 2, labelText.slice(0, 200));
  await shot(page, "90-shipment-box-labels");
  await page.keyboard.press("Escape");
  await sleep(400);

  // ---- intake: scan, refuse, undo ----------------------------------------------------
  await goto(page, "/packages");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("קליטת מארז"))?.click());
  await page.waitForSelector('input[aria-label="מדבקת מארז"]');
  const scan = async (v) => { await page.focus('input[aria-label="מדבקת מארז"]'); await page.keyboard.type(v); await page.keyboard.press("Enter"); await sleep(1500); };
  const said = () => page.evaluate(() => document.querySelector('[role="dialog"] [role="alert"], [role="dialog"] [role="status"]')?.textContent ?? "");
  await scan(ship0.shipment_code.replace(/\D/g, "").slice(0, 6) || "2111");
  check("a shipment label is not a box label", (await said()).includes("אינו") || (await said()).includes("לא נמצא"), await said());
  await scan(`${ids[0].slice(0, 14)}01`);
  check("an item label is refused", (await said()).includes("פריט בתוך מארז"), await said());
  await scan(ids[0]);
  check("box 1 taken in, its template items with it", (await said()).includes("נקלט") && (await said()).includes(`${units} פריטים`), await said());
  const intaken = (await api(page, `/api/packages/${ids[0]}`)).json?.package?.items ?? [];
  check("its items carry the box's details", intaken.length === units && intaken.every((it) => certOf(it) === CERT), JSON.stringify(intaken.map(certOf)));
  await scan(ids[1]);
  await scan(ids[1]);
  check("the same box twice → already taken in", (await said()).includes("כבר נקלט"), await said());
  await shot(page, "91-intake-scan");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("בטל את הקליטה"))?.click());
  // A cold dev server compiles the undo route first: wait for it, not a fixed time.
  let undone = false;
  for (let t0 = Date.now(); !undone && Date.now() - t0 < 15000; await sleep(500)) undone = (await api(page, `/api/packages/${ids[1]}`)).json?.package?.status === "pending";
  check("undo the newest: pending again", undone);
  await page.keyboard.press("Escape");
  await sleep(400);
  r = await put(0);
  check("declaring fewer boxes than were taken in is refused", r.status === 409, `${r.status} ${r.json?.error}`);
  r = await api(page, `/api/shipments/${sid}`, { method: "DELETE" });
  check("a shipment with a box taken in is not deleted", r.status === 400, `${r.status}`);
  // A line with nothing from the certificate: still saved, its boxes still minted.
  const bare = await post(page, "/api/shipments", {
    shipment_code: `${tag}e`, customer_id: ship0.customer_id, shipment_date: new Date().toISOString(), amount: 1, source_id: 1,
    shipment_items: [{ item_type_id: PKG_TYPE, quantity: 1, makat: "", model: "", manufacturer_name: "", manufacturer_no: "", cert_row_raw: "||||||||" }],
  });
  const bareBoxes = bare.json?.id ? (await post(page, `/api/shipments/${bare.json.id}/boxes`, {})).json?.boxes ?? [] : [];
  check("a line without certificate details still saves and mints its box", bare.status === 201 && bareBoxes.length === 1, `${bare.status} ${bare.json?.error ?? ""}`);
  if (bare.json?.id) await api(page, `/api/shipments/${bare.json.id}`, { method: "DELETE" });
  const s2 = await newShipment(`${tag}d`, 2);
  r = await api(page, `/api/shipments/${s2.json?.id}`, { method: "DELETE" });
  check("a shipment of pending boxes deletes them with it", r.ok, `${r.status}`);

  // ---- opening: contents & serials ----------------------------------------------------
  const openSt = ((await api(page, `/api/testing/test-stations?typeId=${OPENING_TYPE}`)).json || []).find((s) => !s.is_research);
  await goto(page, `/testing?type=${OPENING_TYPE}&station=${openSt.test_station_id}`);
  await sleep(1500);
  const started = await page.evaluate((head) => {
    const b = [...document.querySelectorAll("button")].filter((x) => (x.innerText || "").includes("התחל פתיחת מארז"))
      .find((x) => (x.parentElement?.innerText || "").replace(/\s/g, "").includes(head));
    b?.click(); return !!b;
  }, ids[0].slice(0, 14));
  check("the box waits at the opening station", started);
  const waitText = async (t, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await bodyHas(page, t)) return true; await sleep(300); } return false; };
  const click = (label) => page.evaluate((t) => { const els = [...document.querySelectorAll("button")].filter((e) => (e.innerText || "").trim() === t && !e.disabled); els.at(-1)?.click(); return els.length > 0; }, label);
  await waitText("סריקת מק״ט המארז");
  await page.type('input[placeholder="סרוק את מדבקת הקופסה"]', `KIT-${tag}`);
  await sleep(1500);
  await click("המשך"); await sleep(500);
  await click("תקין"); await sleep(300);
  await click("המשך");
  check("contents step after the box photo", await waitText("פתח את הקופסה"));
  const serialSel = 'input[aria-label^="מספר סריאלי · שורה"]';
  check("rows from the template, no serials, no going on", (await page.$$(serialSel)).length === units &&
    !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "שמור והמשך" && !b.disabled))));
  check("details closed: nothing to type but serials", (await page.$$('table input[id$="-makat"]')).length === 0);
  // Row 1: a unit's certificate row — serial and details. Row 2: a batch row, then its serial.
  await (await page.$$(serialSel))[0].focus();
  await page.keyboard.type(`2^1|M-1|SONY|145DL|111|${tag}-A|1|1|PO-1`); await page.keyboard.press("Enter"); await sleep(500);
  await (await page.$$(serialSel))[1].focus();
  await page.keyboard.type("2^2|M-2|LG|X2|222||5|5|"); await page.keyboard.press("Enter"); await sleep(400);
  await page.keyboard.type(`${tag}-B`); await sleep(300);
  // The last template row did not come; an item the template did not foresee did.
  await page.evaluate(() => [...document.querySelectorAll('button[title="הפריט לא הגיע"]')].at(-1)?.click());
  await click("הוסף פריט שלא היה בתבנית"); await sleep(300);
  const ampDesc = ((await api(page, "/api/itemTypes")).json || []).find((t) => t.item_type_id === TYPES.amp)?.item_type_desc ?? "";
  const combos = await page.$$('table input[role="combobox"]');
  await combos.at(-1).click(); await sleep(300); await page.keyboard.type(ampDesc); await sleep(400);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await sleep(300);
  // Its serial typed: the details stay the box's.
  await (await page.$$(serialSel)).at(-1).focus();
  await page.keyboard.type(`${tag}-C`); await sleep(400);
  await shot(page, "92-opening-contents");
  check("contents filled → שמור והמשך", await click("שמור והמשך"));
  check("saved → items step", await waitText("כל פריט עובר סריקה, צילום ושקילה", 15000));
  const view = (await api(page, `/api/packages/${ids[0]}`)).json?.package;
  const got = (view?.items ?? []).map((it) => `${it.serial_no}|${(it.makat ?? "").trim()}|${(it.model ?? "").trim()}`);
  check("the box as saved: kept items with serials, the missing one gone, the new one added with the box's details",
    got.length === units && got.includes(`${tag}-A|111|145DL`) && got.includes(`${tag}-C|MK-${tag}|MD-${tag}`) && got.some((g) => g.startsWith(`${tag}-B|222|X2`)), JSON.stringify(got));
  // An item may lose every detail: editing it still saves (only its serial is required).
  const kept = (view?.items ?? []).find((it) => it.serial_no === `${tag}-A`);
  r = await post(page, `/api/items/${kept?.item_id}`, {
    customer: ship0.customer_id, itemType: kept?.item_type_id, serialNumber: `${tag}-A`, makat: "", model: "", manufacturer: "", manufacturerNo: "",
  }, "PUT");
  check("an item edit with no makat, model or manufacturer saves", r.ok, `${r.status} ${r.json?.error ?? ""}`);
  const undo = await api(page, `/api/packages/${ids[0]}/intake`, { method: "DELETE" });
  check("an intake cannot be taken back once the box is open at its station", !undo.ok, `${undo.status} ${undo.json?.error}`);
  await api(page, "/api/testing/release-test", { method: "POST", body: JSON.stringify({ itemId: Number(ids[0]), stationId: openSt.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });

  const realErrors = errors.filter((e) => !/40[049]/.test(e));
  check("no page errors / 5xx", realErrors.length === 0, realErrors.slice(0, 5).join(" || "));
} catch (e) {
  check("boxes script completed", false, e.stack?.split("\n").slice(0, 2).join(" "));
} finally {
  await browser.close();
  summary();
}
