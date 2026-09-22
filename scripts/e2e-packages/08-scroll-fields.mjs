// /packages internal scroll (page never scrolls, at any size) and the package
// screens' list fields being the shared SearchableCombobox (dense contract:
// geometry, typing filter, keyboard, Esc / outside-click revert, locked mode).
// Creates test packages until there are 50, plus one box with 8 items.
import { launch, login, api, goto, shot, check, summary, clickByText, resolveConfig } from "./lib.mjs";

// Ids are resolved by name from the running app after login (lib.mjs resolveConfig).
let PKG_TYPE_AMP, TYPES;
const tag = Date.now().toString().slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { browser, page, errors } = await launch();

// Geometry of a combobox trigger, measured from its .sh-input-wrap.
await page.evaluateOnNewDocument(() => {
  window.__geo = (wrap) => {
    const r = wrap.getBoundingClientRect();
    const cs = getComputedStyle(wrap);
    const rtl = cs.direction === "rtl";
    const bs = parseFloat(rtl ? cs.borderLeftWidth : cs.borderRightWidth);
    const end = (sel) => {
      const el = wrap.querySelector(sel);
      if (!el) return null;
      const e = el.getBoundingClientRect();
      return Math.round(rtl ? e.left - r.left - bs : r.right - bs - e.right);
    };
    const input = wrap.querySelector("input");
    const lockEl = wrap.querySelector(".sh-combo-lock")?.getBoundingClientRect();
    return {
      lockSize: lockEl ? Math.round(lockEl.width) : null,
      lockDy: lockEl ? Math.round(lockEl.top + lockEl.height / 2 - (r.top + r.height / 2)) : null,
      h: Math.round(r.height * 10) / 10, radius: cs.borderRadius, font: getComputedStyle(input).fontSize,
      padStart: cs.paddingInlineStart, padEnd: cs.paddingInlineEnd,
      arrow: end(".sh-ac-arrow"), clear: end(".sh-ac-clear"), lock: end(".sh-combo-lock"),
      bg: cs.backgroundColor, color: getComputedStyle(input).color, value: input.value,
    };
  };
  window.__list = () => {
    const ul = document.querySelector("ul[role=listbox]");
    if (!ul) return null;
    const cs = getComputedStyle(ul);
    const lis = [...ul.querySelectorAll("li")];
    return {
      rect: ul.getBoundingClientRect().toJSON(), radius: cs.borderRadius, padding: cs.padding, maxHeight: cs.maxHeight,
      items: lis.map((li) => li.innerText.trim()),
      highlighted: lis.findIndex((li) => li.hasAttribute("data-highlighted")),
      highlightBg: lis.find((li) => li.hasAttribute("data-highlighted")) ? getComputedStyle(lis.find((li) => li.hasAttribute("data-highlighted"))).backgroundColor : null,
      selectedBg: lis.find((li) => li.getAttribute("aria-selected") === "true") ? getComputedStyle(lis.find((li) => li.getAttribute("aria-selected") === "true")).backgroundColor : null,
      emptyColor: ul.querySelector(".sh-combo-empty") ? getComputedStyle(ul.querySelector(".sh-combo-empty")).color : null,
    };
  };
});

const geo = (handle) => page.evaluate((w) => window.__geo(w), handle);
const list = () => page.evaluate(() => window.__list());
const wrapsIn = (root) => page.$$(`${root} .sh-input-wrap`);
/** Dense fields of the open dialog — the /packages filters stay mounted behind it. */
async function dialogFields(extra = "") {
  const all = await page.$$(`${extra} .sh-combo--dense`);
  const out = [];
  for (const h of all) if (!(await page.evaluate((w) => !!w.closest(".pkg-fixed"), h))) out.push(h);
  return out;
}
async function clickOutside() { await page.mouse.click(8, 70); await sleep(350); }

try {
  await login(page);
  const cfg = await resolveConfig(page);
  PKG_TYPE_AMP = cfg.PKG_TYPE; TYPES = [cfg.TYPES.amp, cfg.TYPES.kit, cfg.TYPES.cable];

  // ---- data ------------------------------------------------------------------
  let all = (await api(page, "/api/packages")).json || [];
  const ships = ((await api(page, "/api/shipments")).json || []).filter((s) => !s.is_sent);
  const ship = ships.find((s) => s.shipment_items?.some((l) => l.item_type_id === PKG_TYPE_AMP)) ?? ships[0];
  const create = (n, count) => api(page, "/api/packages", {
    method: "POST",
    body: JSON.stringify({
      customer: ship.customer_id, shipment: ship.id, packageType: PKG_TYPE_AMP, makat: `KIT-L${tag}`,
      items: Array.from({ length: count }, (_, i) => ({ itemType: TYPES[i % 3], serialNumber: `L${tag}-${n}-${i}`, makat: "MK-L", model: "M", manufacturer: "Acme" })),
    }),
  });
  let eight = all.find((p) => p.items.length >= 8)?.item_id;
  if (!eight) eight = String((await create("e", 8)).json?.packageId ?? "");
  for (let n = all.length + (all.some((p) => p.item_id === eight) ? 0 : 1); n < 50; n++) await create(n, 3);
  all = (await api(page, "/api/packages")).json || [];
  check("test data: 50+ packages, one with 8 items", all.length >= 50 && all.some((p) => p.item_id === eight && p.items.length >= 8), `${all.length} packages, 8-item box ${eight}`);

  // ---- 1. /packages never scrolls the page ----------------------------------
  const layout = () => page.evaluate(() => {
    const pg = document.querySelector(".pkg-page");
    const shell = pg.parentElement;
    const de = document.documentElement;
    const scroller = document.querySelector(".pkg-table-scroll");
    const split = document.querySelector(".pkg-split");
    const th = scroller.querySelector("thead th");
    return {
      docOk: de.scrollHeight === de.clientHeight,
      shellOk: shell.scrollHeight === shell.clientHeight,
      h1Top: pg.querySelector("h1").getBoundingClientRect().top,
      filtersTop: pg.querySelector(".sh-input-wrap").getBoundingClientRect().top,
      stats: getComputedStyle(document.querySelector(".pkg-stats")).display,
      statH: document.querySelector(".pkg-stat").getBoundingClientRect().height,
      thTopInSplit: Math.round(th.getBoundingClientRect().top - split.getBoundingClientRect().top),
      column: getComputedStyle(split).flexDirection === "column",
      splitOverflow: getComputedStyle(split).overflowY,
      table: document.querySelector(".pkg-table-wrap").getBoundingClientRect().toJSON(),
      panel: document.querySelector(".pkg-panel").getBoundingClientRect().toJSON(),
      vScroll: scroller.scrollHeight > scroller.clientHeight,
      // Wide: the table box scrolls sideways inside the card. Narrow: the split is the only scroller, so the bar lives there.
      hScroll: (getComputedStyle(split).flexDirection === "column" ? split : scroller).scrollWidth > (getComputedStyle(split).flexDirection === "column" ? split : scroller).clientWidth,
      thShadow: getComputedStyle(th).boxShadow,
    };
  });
  const scrollBy = (sel, y) => page.evaluate((s, v) => { document.querySelector(s).scrollTop += v; }, sel, y);
  const shellTop = () => page.evaluate(() => document.querySelector(".pkg-page").parentElement.scrollTop + window.scrollY);

  for (const [w, h] of [[1440, 900], [1440, 700], [1280, 640], [1000, 900], [1000, 650], [700, 800]]) {
    await page.setViewport({ width: w, height: h });
    await goto(page, "/packages");
    await page.waitForSelector(".pkg-table-scroll tbody tr td");
    const before = await layout();
    // The layout switches on the page's own width (container query, 1040px), which the rail shrinks.
    const pageW = await page.evaluate(() => document.querySelector(".pkg-page").clientWidth);
    const narrow = pageW <= 1040;
    const scrollSel = narrow ? ".pkg-split" : ".pkg-table-scroll";
    await scrollBy(scrollSel, 400);
    await sleep(200);
    const after = await layout();
    check(`${w}×${h}: document and shell do not scroll`, before.docOk && before.shellOk && after.docOk && after.shellOk && (await shellTop()) === 0);
    check(`${w}×${h}: header and filters stay put while ${narrow ? "the content area" : "the table"} scrolls`, before.h1Top === after.h1Top && before.filtersTop === after.filtersTop, `h1 ${before.h1Top}→${after.h1Top}`);
    // Short viewports collapse the cards to one compact strip (packages.css); they never disappear.
    check(`${w}×${h}: stats ${h <= 720 ? "compact strip" : "cards"}`, h <= 720 ? before.stats === "flex" && before.statH < 60 : before.stats === "grid" && before.statH >= 60, `${before.stats} ${Math.round(before.statH)}px`);
    if (narrow) {
      check(`${w}×${h}: panel under the table, the split is the scroller`, before.column && before.panel.top >= before.table.bottom && before.splitOverflow === "auto");
      check(`${w}×${h}: the header row sticks to the top of the content area while it scrolls`, after.thTopInSplit === 0 && before.thShadow.includes("224, 224, 224"), `offset ${after.thTopInSplit}, ${before.thShadow}`);
    } else {
      check(`${w}×${h}: table body scrolls, panel beside it`, before.vScroll && Math.abs(before.panel.top - before.table.top) < 1);
      const stuck = await page.evaluate(() => {
        const sc = document.querySelector(".pkg-table-scroll");
        return Math.round(sc.querySelector("thead th").getBoundingClientRect().top - sc.getBoundingClientRect().top);
      });
      check(`${w}×${h}: sticky header row with a rule under it`, stuck === 0 && before.thShadow.includes("224, 224, 224"), `offset ${stuck}, ${before.thShadow}`);
    }
    if (w === 700) check("700px: the table gets a horizontal bar (on the content area, which is the scroller there)", before.hScroll);
    if (w === 1440 && h === 900) await shot(page, "80-packages-scrolled");
  }

  // side panel with the 8-item box scrolls itself
  await page.setViewport({ width: 1440, height: 760 });
  await goto(page, `/packages?q=${eight}`);
  await page.waitForSelector(".pkg-table-scroll tbody tr td");
  await page.click(".pkg-table-scroll tbody tr");
  await sleep(400);
  const p0 = await page.evaluate(() => { const p = document.querySelector(".pkg-panel"); return { scrolls: p.scrollHeight > p.clientHeight, h1: document.querySelector(".pkg-page h1").getBoundingClientRect().top }; });
  await scrollBy(".pkg-panel", 250);
  await sleep(200);
  const p1 = await page.evaluate(() => ({ top: document.querySelector(".pkg-panel").scrollTop, h1: document.querySelector(".pkg-page h1").getBoundingClientRect().top, de: document.documentElement.scrollHeight === document.documentElement.clientHeight, shell: document.querySelector(".pkg-page").parentElement.scrollTop }));
  check("panel with 8 items scrolls on its own, page stays", p0.scrolls && p1.top > 0 && p0.h1 === p1.h1 && p1.de && p1.shell === 0, JSON.stringify({ p0, p1 }));
  await shot(page, "81-panel-8-items");

  // /packages/[id]: scrolls inside the frame
  await page.setViewport({ width: 1440, height: 600 });
  await goto(page, `/packages/${eight}`);
  const pg = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("חזרה למארזים"));
    let el = btn; while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement;
    const before = el.scrollHeight > el.clientHeight;
    el.scrollTop = 300;
    const shell = el.parentElement;
    return { before, moved: el.scrollTop > 0, shellOk: shell.scrollHeight === shell.clientHeight && shell.scrollTop === 0, de: document.documentElement.scrollHeight === document.documentElement.clientHeight };
  });
  check("/packages/[id]: its wrapper scrolls, not the shell or the document", pg.before && pg.moved && pg.shellOk && pg.de, JSON.stringify(pg));

  // ---- 2. fields on /packages -------------------------------------------------
  await page.setViewport({ width: 1440, height: 900 });
  await goto(page, "/packages");
  await page.waitForSelector(".pkg-table-scroll tbody tr td");
  const filters = await wrapsIn(".pkg-page");
  const fgeo = [];
  for (const f of filters) fgeo.push(await geo(f));
  check("/packages: 4 filters are dense comboboxes", filters.length === 4 && fgeo.every((g) => g.h === 44 && g.radius === "8px" && g.font === "14.5px" && g.padStart === "13px" && g.padEnd === "66px" && g.arrow === 12), JSON.stringify(fgeo[0]));

  const status = filters[3];
  const statusInput = await status.$("input");
  await statusInput.click();
  await sleep(300);
  let l = await list();
  check("status filter opens a panel under the field", l && l.items.length === 5 && Math.round(l.rect.top) >= Math.round((await page.evaluate((w) => w.getBoundingClientRect().bottom, status))), JSON.stringify(l?.items));
  check("panel radius 10 / padding 5", l?.radius === "10px" && l?.padding === "5px", `${l?.radius} ${l?.padding}`);
  const gapBelow = Math.round(l.rect.top - (await page.evaluate((w) => w.getBoundingClientRect().bottom, status)));
  check("panel 6px under the field, at most 264px tall", gapBelow === 6 && l.maxHeight === "264px", `gap ${gapBelow}, max ${l.maxHeight}`);
  await page.keyboard.type("בבד");
  await sleep(200);
  l = await list();
  check("typing filters (includes)", l?.items.length === 1 && l.items[0] === "בבדיקה", JSON.stringify(l?.items));
  await page.keyboard.press("Enter");
  await sleep(300);
  let g = await geo(status);
  check("Enter picks the highlighted match and closes", g.value === "בבדיקה" && !(await list()), g.value);
  check("× at 38px, arrow at 12px once there is a value", g.clear === 38 && g.arrow === 12, `× ${g.clear} arrow ${g.arrow}`);
  const rowsFiltered = await page.$$eval(".pkg-table-scroll tbody tr", (trs) => trs.length);

  await statusInput.click();
  await sleep(300);
  l = await list();
  check("click reopens with a value: full list, value kept, selected row tinted", l?.items.length === 5 && (await geo(status)).value === "בבדיקה" && l.selectedBg === "rgb(243, 248, 255)", `${l?.items.length} ${l?.selectedBg}`);
  const checkWidth = await page.evaluate(() => document.querySelector("li[aria-selected=true] .sh-combo-check")?.getBoundingClientRect().width);
  check("selected row has the 15px blue check", checkWidth === 15, String(checkWidth));
  await page.keyboard.press("ArrowDown");
  await sleep(120);
  await page.keyboard.press("ArrowDown");
  await sleep(120);
  await page.keyboard.press("ArrowUp");
  await sleep(150);
  l = await list();
  check("ArrowDown/ArrowUp move the highlight (#f5f5f7)", l?.highlighted >= 0 && l.highlightBg === "rgb(245, 245, 247)", `${l?.highlighted} ${l?.highlightBg}`);
  await page.keyboard.type("zz");
  await sleep(200);
  l = await list();
  check("no match → אין תוצאה תואמת in #9a9aa0", l?.items[0] === "אין תוצאה תואמת" && l.emptyColor === "rgb(154, 154, 160)", `${l?.items[0]} ${l?.emptyColor}`);
  await page.keyboard.press("Escape");
  await sleep(300);
  g = await geo(status);
  await statusInput.click();
  await sleep(300);
  const reopened = await list();
  check("Esc with a partial search returns to the value, not empty", g.value === "בבדיקה" && !!reopened && reopened.items.length === 5 && (await geo(status)).value === "בבדיקה", `${g.value} / reopen ${reopened?.items.length}`);
  await page.keyboard.press("Escape");
  await sleep(200);

  // × clears; partial text with no value is dropped on outside click
  await page.evaluate((w) => w.querySelector(".lucide-x").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), status);
  await sleep(300);
  const rowsAll = await page.$$eval(".pkg-table-scroll tbody tr", (trs) => trs.length);
  check("× clears the filter", (await geo(status)).value === "" && rowsAll >= rowsFiltered, `${rowsFiltered} → ${rowsAll}`);
  await statusInput.click();
  await page.keyboard.type("qq");
  await sleep(150);
  await clickOutside();
  check("outside click drops a partial search", (await geo(status)).value === "" && !(await list()));

  // ---- labels dialog: two fields, identical geometry ------------------------
  await page.click(".pkg-table-scroll tbody tr");
  await sleep(400);
  await clickByText(page, "מדבקות", "button", { exact: true }); // the panel button; the header has "מדבקות למארזים שהוסבו"
  await sleep(500);
  const labelWraps = await dialogFields();
  const lg = [];
  for (const w of labelWraps) lg.push(await geo(w));
  check("labels dialog: printer and size are comboboxes, identical to the pixel", lg.length === 2 && JSON.stringify({ ...lg[0], value: 0 }) === JSON.stringify({ ...lg[1], value: 0 }) && lg[0].clear === 38 && lg[0].arrow === 12, JSON.stringify(lg));
  await shot(page, "82-labels-fields");
  await clickByText(page, "ביטול");

  // ---- edit dialog: locked fields ------------------------------------------
  await clickByText(page, "עריכה");
  await sleep(600);
  const locked = await page.$$(".sh-combo--locked");
  const lk = [];
  for (const w of locked) lk.push(await geo(w));
  check("edit dialog: 4 locked comboboxes (lock, no arrow, no ×, #f5f5f7 / #7a7a7a)", locked.length === 4 && lk.every((x) => x.lock === 12 && x.lockSize === 15 && Math.abs(x.lockDy) <= 1 && x.arrow == null && x.clear == null && x.bg === "rgb(245, 245, 247)" && x.color === "rgb(122, 122, 122)" && x.padEnd === "36px" && x.h === 44), JSON.stringify(lk[0]));
  await (await locked[0].$("input")).click();
  await sleep(300);
  check("locked package type does not open", !(await list()));
  await shot(page, "83-edit-locked");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "ביטול")?.click());
  await sleep(300);

  // ---- intake dialog ----------------------------------------------------------
  // a shipment that still has a declared package left to receive
  const pkgTypeIds = new Set(((await api(page, "/api/itemTypes")).json || []).filter((t) => t.is_package).map((t) => t.item_type_id));
  let open = null;
  for (const s of ships) {
    const d = (await api(page, `/api/shipments/${s.id}/items`)).json || [];
    const left = d.find((x) => pkgTypeIds.has(x.item_type_id) && Number(x.total_quantity) > Number(x.sample_count));
    if (left) { open = { code: s.shipment_code, typeDesc: left.item_type_desc }; break; }
  }
  check("test data: a shipment with a package left to receive", !!open, JSON.stringify(open));

  await clickByText(page, "קליטת מארז");
  await sleep(800);
  const shipWrap = (await dialogFields())[0];
  const shipInput = await shipWrap.$("input");
  await shipInput.click();
  await sleep(300);
  const allShips = (await list())?.items.length ?? 0;
  await page.keyboard.type(open.code);
  await sleep(250);
  l = await list();
  check("intake: shipment field filters as you type", allShips > 0 && l && l.items.length >= 1 && l.items.length < allShips && l.items[0].includes(open.code), `${allShips} → ${l?.items.length}`);
  await page.keyboard.press("Enter");
  await sleep(800);
  await page.evaluate((desc) => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(desc) && tr.innerText.includes("בחר"))?.click(), open.typeDesc);
  await sleep(800);
  await clickByText(page, "הבא");
  await sleep(800);
  const detailWraps = await dialogFields();
  const dg = [];
  for (const w of detailWraps) dg.push(await geo(w));
  const [routeG, typeG] = dg;
  check("intake details: route and locked type share height, radius and the arrow/lock inset", dg.length === 2 && routeG.h === typeG.h && routeG.radius === typeG.radius && routeG.arrow === 12 && typeG.lock === 12 && typeG.arrow == null && typeG.clear == null, JSON.stringify(dg));
  await shot(page, "84-intake-details");

  await clickByText(page, "הבא");
  await sleep(600);
  for (let i = 0; i < 6; i++) await clickByText(page, "הוסף פריט");
  // 800px tall: the last row ends ~260px above the window's bottom — inside the
  // contract's "under 280px ⇒ open upward".
  await page.setViewport({ width: 1440, height: 800 });
  await sleep(400);
  const rowWraps = await page.$$("td .sh-combo--dense");
  const lastRow = rowWraps.at(-1);
  await page.evaluate((w) => { let el = w; while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement; el.scrollTop = el.scrollHeight; }, lastRow);
  await sleep(300);
  check("intake row type field is 38px", (await geo(lastRow)).h === 38, String((await geo(lastRow)).h));
  await (await lastRow.$("input")).click();
  await sleep(350);
  const bottomField = await page.evaluate((w) => { const r = w.getBoundingClientRect(); const ul = document.querySelector("ul[role=listbox]").getBoundingClientRect(); return { fieldTop: r.top, fieldBottom: r.bottom, below: innerHeight - r.bottom, ulTop: ul.top, ulBottom: ul.bottom }; }, lastRow);
  check("intake bottom field opens upward (contract: under 280px below)", bottomField.below >= 280 || bottomField.ulBottom <= bottomField.fieldTop, `room below ${Math.round(bottomField.below)}px; list ${Math.round(bottomField.ulTop)}–${Math.round(bottomField.ulBottom)}, field ${Math.round(bottomField.fieldTop)}–${Math.round(bottomField.fieldBottom)}`);
  await shot(page, "85-intake-bottom-field");
  await page.keyboard.press("Escape");
  await sleep(200);
  // panel stays glued to a field while the dialog scrolls
  const midRow = rowWraps[Math.max(0, rowWraps.length - 4)];
  await page.evaluate((w) => w.scrollIntoView({ block: "center" }), midRow);
  await (await midRow.$("input")).click();
  await sleep(300);
  const gap0 = await page.evaluate((w) => { const u = document.querySelector("ul[role=listbox]").getBoundingClientRect(); const r = w.getBoundingClientRect(); return Math.round(u.top - r.bottom); }, midRow);
  await page.evaluate((w) => { let el = w; while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement; el.scrollTop -= 40; }, midRow);
  await sleep(300);
  const gap1 = await page.evaluate((w) => { const u = document.querySelector("ul[role=listbox]"); if (!u) return null; const r = w.getBoundingClientRect(); return Math.round(u.getBoundingClientRect().top - r.bottom); }, midRow);
  check("list stays glued to the field while the dialog scrolls", gap1 != null && gap0 === gap1, `gap ${gap0} → ${gap1}`);
  await page.keyboard.press("Escape");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "ביטול")?.click());
  await sleep(300);

  // ---- /settings/packages: row field opens over the following rows ---------
  await goto(page, "/settings/packages");
  await page.evaluate((name) => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(name))?.click(), cfg.PKG_TYPE_NAME);
  await sleep(800);
  const cell = (await page.$$("td .sh-combo--dense"))[0];
  await page.evaluate((w) => w.closest("tr").scrollIntoView({ block: "start" }), cell);
  await sleep(300);
  const cg = await geo(cell);
  await (await cell.$("input")).click();
  await sleep(350);
  const over = await page.evaluate((w) => {
    const ul = document.querySelector("ul[role=listbox]");
    const u = ul.getBoundingClientRect();
    const tr = w.closest("tr");
    const hit = document.elementFromPoint(u.left + u.width / 2, u.bottom - 12);
    const next = tr.nextElementSibling?.getBoundingClientRect();
    return { td: getComputedStyle(w.closest("td")).overflow, minW: getComputedStyle(w.closest("td")).minWidth, overRows: !!next && u.top < next.top && u.bottom > next.bottom, visible: ul.contains(hit), ul: [Math.round(u.top), Math.round(u.bottom)], row: Math.round(tr.getBoundingClientRect().bottom) };
  }, cell);
  check("settings row field: 38px, cell min-width 186 with no overflow clip, list over the next rows", cg.h === 38 && over.minW === "186px" && over.td === "visible" && over.overRows && over.visible, JSON.stringify({ h: cg.h, ...over }));
  await shot(page, "86-settings-row-field");
  await page.keyboard.press("Escape");

  // ---- other screens keep their metrics, gain the keyboard ------------------
  await goto(page, "/settings/testing-routes");
  const other = (await page.$$(".sh-input-wrap"))[0];
  const og = await geo(other);
  await (await other.$("input")).click();
  await sleep(300);
  await page.keyboard.press("ArrowDown");
  await sleep(150);
  const ol = await list();
  check("testing-routes combobox: default metrics unchanged, ArrowDown highlights", og.font === "17px" && ol?.highlighted === 0, `${og.h}px ${og.font} highlight ${ol?.highlighted}`);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("script ran to the end", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
  summary();
  await browser.close();
}
