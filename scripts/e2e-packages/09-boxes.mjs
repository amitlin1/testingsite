// A box from the shipment to its opening (docs/packages/PLAN.md §6, 2026-10-19):
// the shipment mints pending boxes, their labels print from the shipment, the
// intake scans them into their routes (no serials), the opening station's
// contents step records what is in the box with a serial for every item.
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
  const newShipment = (code, qty) => post(page, "/api/shipments", {
    shipment_code: code, customer_id: ship0.customer_id, shipment_date: new Date().toISOString(), amount: qty, source_id: 1,
    shipment_items: [{ item_type_id: PKG_TYPE, quantity: qty, makat: `MK-${tag}` }],
  });

  // ---- the shipment mints its boxes ------------------------------------------
  const created = await newShipment(tag, 3);
  const sid = created.json?.id;
  check("shipment saved", created.status === 201, `${created.status}`);
  let boxes = (await post(page, `/api/shipments/${sid}/boxes`, {})).json?.boxes ?? [];
  check("3 pending boxes, ids ending 00, makat from the line", boxes.length === 3 && boxes.every((b) => b.status === "pending" && /^1\d{13}00$/.test(b.item_id) && b.makat === `MK-${tag}`), JSON.stringify(boxes.map((b) => [b.item_id, b.status])));
  const ids = boxes.map((b) => b.item_id);
  const loc = await api(page, `/api/testing/locate-by-barcode?barcode=${ids[0]}`);
  check("a station scan of a pending box says it was not taken in", loc.status === 404 && loc.json?.pendingIntake === true, JSON.stringify(loc.json));
  check("the items list leaves pending boxes out", !((await api(page, "/api/items")).json || []).some((i) => ids.includes(String(i.item_id))));

  // ---- shipment edits follow the boxes -----------------------------------------
  const ship = ((await api(page, "/api/shipments")).json || []).find((s) => s.id === sid);
  const put = (qty) => post(page, `/api/shipments/${sid}`, {
    shipment_code: tag, customer_id: ship0.customer_id, shipment_date: ship.shipment_date, amount: Math.max(qty, 1), source_id: 1,
    shipment_items: [{ item_type_id: PKG_TYPE, quantity: qty, makat: `MK-${tag}` }],
  }, "PUT");
  let r = await put(2);
  boxes = (await post(page, `/api/shipments/${sid}/boxes`, {})).json?.boxes ?? [];
  check("quantity 3 → 2 drops the newest pending box", r.ok && boxes.length === 2 && boxes.every((b) => ids.slice(0, 2).includes(b.item_id)), boxes.map((b) => b.item_id).join());

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
  await scan(ids[1]);
  await scan(ids[1]);
  check("the same box twice → already taken in", (await said()).includes("כבר נקלט"), await said());
  await shot(page, "91-intake-scan");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("בטל את הקליטה"))?.click());
  await sleep(1500);
  check("undo the newest: pending again", (await api(page, `/api/packages/${ids[1]}`)).json?.package?.status === "pending");
  await page.keyboard.press("Escape");
  await sleep(400);
  r = await put(0);
  check("declaring fewer boxes than were taken in is refused", r.status === 409, `${r.status} ${r.json?.error}`);
  r = await api(page, `/api/shipments/${sid}`, { method: "DELETE" });
  check("a shipment with a box taken in is not deleted", r.status === 400, `${r.status}`);
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
  await (await page.$$(serialSel)).at(-1).focus();
  await page.keyboard.type(`2^9|M-9|ACME|Z9|999|${tag}-C|1|1|`); await page.keyboard.press("Enter"); await sleep(400);
  await shot(page, "92-opening-contents");
  check("contents filled → שמור והמשך", await click("שמור והמשך"));
  check("saved → items step", await waitText("כל פריט עובר סריקה, צילום ושקילה", 15000));
  const view = (await api(page, `/api/packages/${ids[0]}`)).json?.package;
  const got = (view?.items ?? []).map((it) => `${it.serial_no}|${(it.makat ?? "").trim()}|${(it.model ?? "").trim()}`);
  check("the box as saved: kept items with serials, the missing one gone, the new one added",
    got.length === units && got.includes(`${tag}-A|111|145DL`) && got.includes(`${tag}-C|999|Z9`) && got.some((g) => g.startsWith(`${tag}-B|222|X2`)), JSON.stringify(got));
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
