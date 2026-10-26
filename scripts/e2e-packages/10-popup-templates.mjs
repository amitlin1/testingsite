// Popup templates (docs/popup-templates/PLAN.md, phase 1): the API (save, versions, conflicts,
// content issues, base rules), the editor and its preview, and a real test at a station whose popup
// is built from the template. The station type's own template — or its absence — is put back at
// the end, so a run leaves the type as it found it (plus one test result when an item was waiting).
//
// Station types are picked from the running app: the first type that is not package-level and has
// an item waiting at one of its stations; without such an item the real test is "skipped".
import { launch, login, api, goto, shot, bodyHas, check, summary } from "./lib.mjs";

const tag = Date.now().toString().slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const pid = () => "p_" + rnd();
const kid = () => "k_" + rnd();

/** Click the LAST button whose trimmed text starts with `label` (dialog footers are last in the DOM). */
async function clickStarting(page, label) {
  const ok = await page.evaluate((t) => {
    const els = [...document.querySelectorAll("button")].filter((e) => (e.innerText || "").trim().startsWith(t) && !e.disabled);
    const el = els[els.length - 1]; if (!el) return false; el.click(); return true;
  }, label);
  if (!ok) throw new Error(`no enabled button "${label}…"`);
  await sleep(500);
}
async function waitText(page, needle, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await bodyHas(page, needle)) return true; await sleep(300); }
  return false;
}
async function typeInto(page, placeholder, text) {
  const sel = `[role=dialog] input[placeholder="${placeholder}"]`;
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, text);
}

const MESSAGE = (sku) => `בדיקת תבנית ${tag}: מק״ט ${sku}`;
const config = () => ({
  steps: [
    { id: pid(), title: "סריקת מק״ט יצרן", desc: "", components: [{ id: kid(), kind: "sku_scan", required: true, carry_last: false, lookup_reference: false }] },
    {
      id: pid(), title: "בדיקת {עמדה}", desc: "", components: [
        { id: kid(), kind: "message", text: MESSAGE("{מק״ט}") },
        { id: kid(), kind: "route_fields" },
        { id: kid(), kind: "verdict", question: "בדיקה תקינה?", note_max: 1000 },
      ],
    },
  ],
  finish_label: "סיום בדיקת {עמדה}",
});

const { browser, page, errors } = await launch();
let typeId = null;
let original = null;
let current = null;
try {
  await login(page);

  // ---- pick a station type (and, if there is one, a waiting item at one of its stations) ----------
  const types = (await api(page, "/api/settings/test-stations-type")).json || [];
  const itemTypes = types.filter((t) => !t.package_level);
  const pkgType = types.find((t) => t.package_level);
  let station = null;
  for (const t of itemTypes) {
    const stations = (await api(page, `/api/testing/test-stations?typeId=${t.test_station_type_id}`)).json || [];
    for (const s of stations.filter((s) => !s.is_research)) {
      const items = (await api(page, `/api/testing/items?stationId=${s.test_station_id}`)).json || [];
      if (items.some((i) => i.current_status === 2 && !i.is_package)) { typeId = t.test_station_type_id; station = s; break; }
    }
    if (typeId != null) break;
  }
  typeId ??= itemTypes[0]?.test_station_type_id ?? null;
  check("a station type to template", typeId != null, `type ${typeId}${station ? `, station ${station.test_station_id} has a waiting item` : ", no waiting item"}`);
  if (typeId == null) throw new Error("no station type");

  const before = await api(page, `/api/settings/popup-templates/${typeId}`);
  original = before.status === 200 ? before.json : null;
  check("reading the type's template answers 200 or 404", before.status === 200 || before.status === 404, String(before.status));

  // ---- the API ------------------------------------------------------------------------------------
  const put = await api(page, `/api/settings/popup-templates/${typeId}`, { method: "PUT", body: JSON.stringify({ base: "item", config: config(), expected_version: original?.version ?? null }) });
  current = put.ok ? put.json : null;
  check("template saved as a new version", put.ok && current?.version > (original?.version ?? 0), `${put.status} v${current?.version}`);

  const stale = await api(page, `/api/settings/popup-templates/${typeId}`, { method: "PUT", body: JSON.stringify({ base: "item", config: config(), expected_version: original?.version ?? null }) });
  check("a stale editor is refused (409 TEMPLATE_CONFLICT)", stale.status === 409 && stale.json?.code === "TEMPLATE_CONFLICT", `${stale.status} ${stale.json?.code}`);

  const noVerdict = config();
  noVerdict.steps[1].components.pop();
  const invalid = await api(page, `/api/settings/popup-templates/${typeId}`, { method: "PUT", body: JSON.stringify({ base: "item", config: noVerdict, expected_version: current?.version }) });
  check("a template without a verdict is refused (422, with the issue)", invalid.status === 422 && invalid.json?.issues?.some((i) => i.code === "VERDICT_MISSING"), `${invalid.status}`);

  if (pkgType) {
    const mismatch = await api(page, `/api/settings/popup-templates/${pkgType.test_station_type_id}`, { method: "PUT", body: JSON.stringify({ base: "item", config: config(), expected_version: null }) });
    check("an item template on a package-level type is refused (409 BASE_MISMATCH)", mismatch.status === 409 && mismatch.json?.code === "BASE_MISMATCH", `${mismatch.status} ${mismatch.json?.code}`);
  }

  const stationTypes = (await api(page, "/api/testing/stations")).json || [];
  check("the testing page learns the type has a template", stationTypes.find((t) => t.id === typeId)?.popupTemplate?.version === current?.version);

  // ---- the editor and its preview ------------------------------------------------------------------
  await goto(page, `/settings/popup-templates?type=${typeId}`);
  check("editor shows the template's version", await waitText(page, `גרסה ${current?.version}`, 15000));
  check("editor lists the message component", await bodyHas(page, `בדיקת תבנית ${tag}`));
  await shot(page, "100-template-editor");
  await clickStarting(page, "תצוגה מקדימה");
  check("preview opens the worker's popup", await waitText(page, "תצוגה מקדימה — שום דבר לא נשמר", 8000));
  await typeInto(page, "סרוק או הזן מק״ט…", `PRV-${tag}`);
  await clickStarting(page, "המשך");
  check("preview: the message with the scanned SKU", await waitText(page, MESSAGE(`PRV-${tag}`), 8000));
  check("preview: a placeholder where the route's fields go", await bodyHas(page, "כאן יופיעו שדות הבדיקה של העמדה"));
  await shot(page, "101-template-preview");
  await clickStarting(page, "יציאה");

  // ---- a real test at the station -----------------------------------------------------------------
  if (station) {
    await goto(page, `/testing?type=${typeId}&station=${station.test_station_id}`);
    await clickStarting(page, "התחל בדיקה");
    check("the station opens the template popup", await waitText(page, "סריקת מק״ט יצרן", 20000));
    await typeInto(page, "סרוק או הזן מק״ט…", `RUN-${tag}`);
    await clickStarting(page, "המשך");
    check("step 2 shows the template's message", await waitText(page, MESSAGE(`RUN-${tag}`), 8000));
    await clickStarting(page, "תקין");
    await clickStarting(page, "סיום בדיקת");
    check("the result is saved and the next station is named", await waitText(page, "הבדיקה הושלמה", 30000));
    await shot(page, "102-template-run-done");
    await clickStarting(page, "אישור");
  } else {
    check("real test at the station — skipped (no waiting item)", true);
  }
} catch (e) {
  check("script ran to the end", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
  // ---- put the type back as it was ----------------------------------------------------------------
  if (typeId != null && current) {
    const back = original
      ? await api(page, `/api/settings/popup-templates/${typeId}`, { method: "PUT", body: JSON.stringify({ base: original.base, config: original.config, expected_version: current.version }) })
      : await api(page, `/api/settings/popup-templates/${typeId}`, { method: "DELETE" });
    check("the type's template is put back", back.ok, `${back.status}`);
  }
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  summary();
  await browser.close();
}
