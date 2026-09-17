// The two package wizards driven through the browser (real uploads to MinIO),
// plus the package dialogs and the command palette.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { launch, login, api, goto, shot, bodyHas, check, summary, S } from "./lib.mjs";

const OPENING_TYPE = 5, CLOSING_TYPE = 8, PKG_TYPE_AMP = 15;
const TYPES = { amp: 6, kit: 11 };
const uuid = () => crypto.randomUUID();
const tag = Date.now().toString().slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a valid 24×24 PNG so the upload path (presign → MinIO → confirm) is real
function png(w = 24, h = 24) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 30; raw[o + 1] = 120; raw[o + 2] = 200; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const photoPath = path.join(S, "photo.png");
fs.writeFileSync(photoPath, png());

/** Click the LAST button whose trimmed text equals `label` (the wizard footer is last in the DOM). */
async function clickExact(page, label, tag = "button") {
  const ok = await page.evaluate((t, tg) => {
    const els = [...document.querySelectorAll(tg)].filter((e) => (e.innerText || "").trim() === t && !e.disabled);
    const el = els[els.length - 1]; if (!el) return false; el.click(); return true;
  }, label, tag);
  if (!ok) throw new Error(`no enabled <${tag}> "${label}"`);
  await sleep(500);
}
async function waitEnabled(page, label, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const en = await page.evaluate((t) => [...document.querySelectorAll("button")].some((e) => (e.innerText || "").trim() === t && !e.disabled), label);
    if (en) return true;
    await sleep(300);
  }
  return false;
}
async function waitText(page, needle, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await bodyHas(page, needle)) return true; await sleep(300); }
  return false;
}
async function uploadPhoto(page) {
  const inputs = await page.$$("input[type=file][multiple]");
  const input = inputs[inputs.length - 1];
  if (!input) throw new Error("no gallery file input");
  await input.uploadFile(photoPath);
  await sleep(1500);
}
/** Click the topmost dialog's icon-only close button (last small button with no text). */
async function closeDialog(page) {
  // Only inside the topmost fixed overlay — never a sidebar icon (the logout button!).
  const ok = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll("div")].filter((d) => { const s = getComputedStyle(d); return s.position === "fixed" && Number(s.zIndex) >= 60 && d.offsetWidth > 600; });
    const top = overlays[overlays.length - 1]; if (!top) return false;
    const icon = [...top.querySelectorAll("button")].find((e) => (e.innerText || "").trim() === "" && e.offsetWidth > 0 && e.offsetWidth <= 44);
    const cancel = [...top.querySelectorAll("button")].find((e) => ["ביטול", "סגור", "יציאה"].includes((e.innerText || "").trim()));
    const el = icon || cancel; if (!el) return false; el.click(); return true;
  });
  if (!ok) await page.keyboard.press("Escape");
  await sleep(600);
}
async function typeInto(page, placeholder, text) {
  const sel = `input[placeholder="${placeholder}"]`;
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, text);
}

const { browser, page, errors } = await launch();
try {
  await login(page);
  const stations = async (typeId) => (await api(page, `/api/testing/test-stations?typeId=${typeId}`)).json || [];
  const openSt = (await stations(OPENING_TYPE)).find((s) => !s.is_research);
  // release boxes a previous aborted run left "in test" at the opening station
  for (const r of ((await api(page, `/api/testing/items?stationId=${openSt.test_station_id}`)).json || []).filter((r) => r.is_package && r.current_status === 1)) {
    await api(page, "/api/testing/release-test", { method: "POST", body: JSON.stringify({ itemId: Number(r.item_id), stationId: openSt.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
  }
  const closeSt = (await stations(CLOSING_TYPE)).find((s) => !s.is_research);
  const ships = (await api(page, "/api/shipments")).json || [];
  const ship = ships[1] ?? ships[0];
  const makat = "KIT-UI-" + tag;
  const create = await api(page, "/api/packages", { method: "POST", body: JSON.stringify({ customer: ship.customer_id, shipment: ship.id, packageType: PKG_TYPE_AMP, makat,
    items: [{ itemType: TYPES.amp, serialNumber: "UAMP-" + tag, makat: "MK-6130", model: "A1", manufacturer: "Acme" }, { itemType: TYPES.kit, serialNumber: "UKIT-" + tag, makat: "745781", model: "K1", manufacturer: "Acme" }] }) });
  const pkgId = String(create.json?.packageId ?? "");
  check("fixture package created", create.status === 201 && pkgId.length === 16, pkgId);

  // ---- package dialogs ---------------------------------------------------------
  await goto(page, `/packages/${pkgId}`);
  await clickExact(page, "מדבקות");
  check("labels dialog opens from the package page", await waitText(page, "הדפסת מדבקות", 8000));
  await shot(page, "30-labels-dialog");
  await closeDialog(page);
  await clickExact(page, "עריכת מארז");
  check("edit dialog opens", await waitText(page, "סוג המארז אינו ניתן לשינוי", 8000));
  await shot(page, "31-edit-dialog");
  await closeDialog(page);
  await goto(page, "/packages");
  await clickExact(page, "קליטת מארז");
  check("intake dialog opens on step 1", await waitText(page, "בחר משלוח, ואז סוג מארז", 8000));
  await shot(page, "32-intake-dialog");
  await closeDialog(page);

  // ---- command palette ---------------------------------------------------------
  await page.keyboard.down("Control"); await page.keyboard.press("KeyK"); await page.keyboard.up("Control");
  await sleep(500);
  await page.keyboard.type(pkgId.slice(0, 14));
  await sleep(1500);
  check("palette shows the box with the מארז tag and its page", await bodyHas(page, "עמוד המארז") && await bodyHas(page, "מארז"));
  await shot(page, "33-palette");
  await page.keyboard.press("Escape");

  // ---- opening wizard ----------------------------------------------------------
  await goto(page, `/testing?type=${OPENING_TYPE}&station=${openSt.test_station_id}`);
  // the card of OUR box: click the start button inside the card that shows our makat-less id head
  const started = await page.evaluate((head) => {
    const cards = [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").includes("התחל פתיחת מארז"));
    const mine = cards.find((b) => (b.parentElement?.innerText || "").replace(/\s/g, "").includes(head));
    mine?.click(); return !!mine;
  }, pkgId.slice(0, 14));
  check("clicked התחל פתיחת מארז", started);
  check("opening wizard opened", await waitText(page, "סריקת מק״ט המארז", 15000));
  await shot(page, "40-open-scan");
  await typeInto(page, "סרוק את מדבקת הקופסה", makat);
  check("scan recognised the box", await waitText(page, "זוהה", 5000));
  await clickExact(page, "המשך");
  check("box photo step", await waitText(page, "האריזה תקינה?", 8000));
  await uploadPhoto(page);
  await clickExact(page, "תקין");
  check("box photo uploaded and next enabled", await waitEnabled(page, "המשך", 20000));
  await shot(page, "41-open-box-photo");
  await clickExact(page, "המשך");
  check("items step", await waitText(page, "הוסף פריט שלא נרשם בקליטה", 8000));
  await shot(page, "42-open-items");
  for (let i = 0; i < 2; i++) {
    await clickExact(page, "התחל");
    check(`item ${i + 1}: photo phase`, await waitText(page, "הפריט תקין?", 8000));
    await uploadPhoto(page);
    await clickExact(page, "תקין");
    check(`item ${i + 1}: photo uploaded`, await waitEnabled(page, "המשך", 20000));
    if (i === 0) await shot(page, "43-open-item-photo");
    await clickExact(page, "המשך");
    check(`item ${i + 1}: weigh phase`, await waitText(page, "משקל פריט נבדק", 8000));
    await typeInto(page, "גר׳", "460");
    if (i === 0) await shot(page, "44-open-item-weigh");
    await clickExact(page, "סיום פריט");
  }
  check("both items done → count step available", await waitEnabled(page, "המשך לספירה", 8000));
  await clickExact(page, "המשך לספירה");
  check("count step", await waitText(page, "נספר בעמדה", 8000));
  await typeInto(page, "—", "2");
  await shot(page, "45-open-count");
  await clickExact(page, "המשך");
  check("labels step", await waitText(page, "מדבקת קופסה", 8000));
  await shot(page, "46-open-labels");
  await clickExact(page, "הדפס וסיים");
  check("labels dialog from the wizard", await waitText(page, "הדפסת מדבקות", 8000));
  await sleep(800);
  const printed = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => /^הדפס \d+ מדבקות$/.test((e.innerText || "").trim())); if (!b || b.disabled) return false; b.click(); return true; });
  check("print button enabled and clicked", printed);
  await sleep(1500);
  await closeDialog(page); // the X of the labels dialog → finish()
  check("opening finished (done step)", await waitText(page, "פתיחת המארז הושלמה", 40000));
  await shot(page, "47-open-done");
  await clickExact(page, "חזרה לתור");

  let view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("after UI opening: box waits for items, items queued at step 2", view?.status === "waitItems" && view.items.every((i) => i.state === "queue" && i.current_route_step === 2), `${view?.status} ${JSON.stringify(view?.items.map((i) => [i.state, i.current_route_step]))}`);
  const boxFiles = (await api(page, `/api/items/${pkgId}/files`)).json?.files || [];
  const itemFiles = (await api(page, `/api/items/${view.items[0].item_id}/files`)).json?.files || [];
  check("box photo stored in MinIO registry (photoType package)", boxFiles.length >= 1 && boxFiles.some((f) => (f.photoType ?? f.metadata?.photoType) === "package"), JSON.stringify(boxFiles.map((f) => [f.fileName, f.photoType ?? f.metadata?.photoType])));
  check("item photo stored (photoType product)", itemFiles.length >= 1, JSON.stringify(itemFiles.map((f) => [f.fileName, f.photoType ?? f.metadata?.photoType])));
  const loc = await api(page, `/api/testing/locate-by-barcode?barcode=${pkgId}`);
  check("locate-by-barcode explains a box waiting for its items", loc.ok && loc.json?.waitingForPackageItems === true && (loc.json.blockingItemIds || []).length === 2, JSON.stringify(loc.json).slice(0, 160));

  // ---- items through their stations (API) -------------------------------------
  const cache = new Map();
  for (let guard = 0; guard < 12; guard++) {
    view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
    const pending = view.items.filter((i) => !i.arrived_at_closing && i.state !== "done");
    if (pending.length === 0) break;
    for (const it of pending) {
      const detail = (await api(page, `/api/items/${it.item_id}`)).json?.item;
      const step = detail?.current_route_step ?? 1; const stepType = detail?.route_steps?.[step - 1];
      if (!stepType || stepType === CLOSING_TYPE) continue;
      if (!cache.has(stepType)) cache.set(stepType, (await stations(stepType)).find((s) => !s.is_research));
      const st = cache.get(stepType);
      const s = await api(page, "/api/testing/start-test", { method: "POST", body: JSON.stringify({ itemId: Number(it.item_id), stationId: st.test_station_id, actionUuid: uuid(), workerId: 9902, workerName: "pkgtest" }) });
      if (s.ok) await api(page, "/api/testing/results", { method: "POST", body: JSON.stringify({ ItemID: Number(it.item_id), StationID: st.test_station_id, CurrentRouteStep: step, RouteStepsLength: detail.route_steps.length, WorkerID: 9902, WorkerName: "pkgtest", SubmitID: uuid(), Result: 1, Passed: true }) });
    }
  }
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("items reached closing; box in closing queue", view.status === "readyClose" && view.items.every((i) => i.arrived_at_closing), view.status);

  // ---- closing wizard ----------------------------------------------------------
  await goto(page, `/testing?type=${CLOSING_TYPE}&station=${closeSt.test_station_id}`);
  await shot(page, "50-closing-queue");
  const startedClose = await page.evaluate((head) => {
    const cards = [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").includes("התחל סגירת מארז"));
    const mine = cards.find((b) => (b.parentElement?.innerText || "").replace(/\s/g, "").includes(head));
    mine?.click(); return !!mine;
  }, pkgId.slice(0, 14));
  check("clicked התחל סגירת מארז", startedClose);
  check("closing wizard opened", await waitText(page, "סגירת מארז", 15000) && await waitText(page, "סריקת מק״ט המארז", 15000));
  await typeInto(page, "סרוק את מדבקת הקופסה", makat);
  await clickExact(page, "המשך");
  check("arrival step lists both items as arrived", await waitText(page, "הגיע לסגירה", 8000));
  await shot(page, "51-close-arrival");
  const packedClicks = await page.evaluate(() => { const spans = [...document.querySelectorAll("span")].filter((s) => (s.innerText || "").trim() === "נארז"); spans.forEach((s) => s.click()); return spans.length; });
  check("marked every item נארז", packedClicks === 2, `${packedClicks} clicks`);
  await sleep(300);
  await clickExact(page, "המשך");
  check("packing checks step", await waitText(page, "האריזה סגורה ותקינה", 8000));
  const checks = await page.evaluate(() => { const spans = [...document.querySelectorAll("span")].filter((s) => ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת הקופסה קריאה"].includes((s.innerText || "").trim())); spans.forEach((s) => s.click()); return spans.length; });
  check("ticked the 3 packing checks", checks === 3, `${checks}`);
  await shot(page, "52-close-checks");
  await clickExact(page, "סגור מארז");
  check("closing finished", await waitText(page, "המארז נסגר", 40000));
  await shot(page, "53-close-done");
  await clickExact(page, "סיום וחזרה לתור");
  view = (await api(page, `/api/packages/${pkgId}`)).json?.package;
  check("package done after UI closing", view.status === "done" && view.items.every((i) => i.state === "done"), `${view.status} ${JSON.stringify(view.items.map((i) => i.state))}`);

  const realErrors = errors.filter((e) => !/409|404/.test(e));
  check("no page errors / 5xx during wizard run", realErrors.length === 0, realErrors.slice(0, 5).join(" || "));
} catch (e) {
  check("wizard script completed", false, e.stack?.split("\n").slice(0, 2).join(" "));
  console.log("browser errors so far:", errors.slice(0, 8).join("\n  "));
  await shot(page, "99-wizard-error");
} finally {
  summary();
  await browser.close();
}
