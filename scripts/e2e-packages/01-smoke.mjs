// Smoke: login, every package-model screen renders, the read APIs answer with the
// upgraded data. Screenshots land in e2e/shots.
import { launch, login, api, goto, shot, bodyHas, check, summary, BASE, resolveConfig } from "./lib.mjs";

const { browser, page, errors } = await launch();
try {
  const url = await login(page);
  check("login lands in the app", !url.includes("/auth/realms/"), url);
  const cfg = await resolveConfig(page);
  await shot(page, "01-home");

  // ---- read APIs ------------------------------------------------------------
  const pk = await api(page, "/api/packages");
  check("GET /api/packages", pk.ok && Array.isArray(pk.json), `status ${pk.status}, ${Array.isArray(pk.json) ? pk.json.length : "?"} packages`);
  const pkgs = Array.isArray(pk.json) ? pk.json : [];
  check("packages have 16-digit ids and items", pkgs.length > 0 && pkgs.every((p) => String(p.item_id).length === 16 && Array.isArray(p.items) && p.items.length > 0));
  check("package status keys valid", pkgs.every((p) => ["queue", "test", "waitItems", "readyClose", "done"].includes(p.status)), [...new Set(pkgs.map((p) => p.status))].join(","));

  const pt = await api(page, "/api/settings/package-types");
  check("GET /api/settings/package-types", pt.ok && Array.isArray(pt.json) && pt.json.length >= 1, `status ${pt.status}, ${pt.json?.length} types: ${(pt.json || []).map((t) => t.item_type_desc + "(" + t.health + ")").join(", ")}`);

  const st = await api(page, "/api/testing/stations");
  const pkgLevel = (st.json || []).filter((t) => t.packageLevel).map((t) => `${t.id}:${t.name}`);
  check("station types expose packageLevel (opening + closing)", st.ok && pkgLevel.length === 2, pkgLevel.join(" | "));

  const sh = await api(page, "/api/shipments");
  check("GET /api/shipments has package counters", sh.ok && Array.isArray(sh.json) && sh.json.length > 0 && "sent_amount" in sh.json[0] && "sampled_amount" in sh.json[0], `status ${sh.status}`);
  const withBoxes = (sh.json || []).filter((s) => (s.sampled_amount || 0) > 0);
  check("some shipment counts intake boxes", withBoxes.length > 0, withBoxes.map((s) => `${s.shipment_code}: ${s.amount}/${s.sampled_amount}`).join(", "));

  const first = pkgs[0];
  const det = await api(page, `/api/packages/${first.item_id}`);
  check("GET /api/packages/[id] returns view + timeline", det.ok && det.json?.package?.item_id === String(first.item_id) && Array.isArray(det.json?.timeline), `status ${det.status}`);

  const item0 = first.items[0];
  const it = await api(page, `/api/items/${item0.item_id}`);
  check("GET /api/items/[id] carries the package view", it.ok && it.json?.package?.item_id === String(first.item_id) && it.json?.item?.package_seq === item0.package_seq, `status ${it.status}`);

  const srch = await api(page, `/api/search/items?q=${String(first.item_id).slice(0, 14)}`);
  const hits = srch.json || [];
  check("search finds the box and its items by id prefix", srch.ok && hits.some((h) => h.isPackage) && hits.some((h) => h.packageId === String(first.item_id)), `${hits.length} hits`);

  const closingStation = ((await api(page, `/api/testing/test-stations?typeId=${cfg.CLOSING_TYPE}`)).json || []).find((st) => !st.is_research);
  const bp = await api(page, `/api/testing/blocked-packages?stationId=${closingStation?.test_station_id ?? 0}`);
  check("GET /api/testing/blocked-packages answers a list", bp.ok && Array.isArray(bp.json), `status ${bp.status}, ${bp.json?.length}`);

  // ---- screens --------------------------------------------------------------
  await goto(page, "/packages");
  check("/packages renders the list", await bodyHas(page, "מארזים") && await bodyHas(page, first.item_type_desc));
  await shot(page, "02-packages-list");

  await goto(page, `/packages/${first.item_id}`);
  check("/packages/[id] renders", await bodyHas(page, first.item_type_desc) && await bodyHas(page, "ציר זמן") || await bodyHas(page, "פריטים"));
  await shot(page, "03-package-page");

  await goto(page, "/settings/packages");
  let allTypesShown = true;
  for (const name of cfg.PKG_TYPE_NAMES) if (!(await bodyHas(page, name))) allTypesShown = false;
  check("/settings/packages renders the types", allTypesShown, cfg.PKG_TYPE_NAMES.join(", "));
  await shot(page, "04-settings-packages");

  await goto(page, "/settings/item-types");
  check("/settings/item-types shows the מארז pill", await bodyHas(page, "מארז"));
  await shot(page, "05-settings-item-types");

  await goto(page, "/settings/testing-routes");
  check("/settings/testing-routes renders", await bodyHas(page, "מסלול"));
  await shot(page, "06-settings-routes");

  await goto(page, "/shipments");
  check("/shipments shows package columns", await bodyHas(page, "מארזים שהוצהרו") && await bodyHas(page, "נקלטו"));
  await shot(page, "07-shipments");

  await goto(page, `/items/${item0.item_id}/history`);
  check("item history shows המארז שלי", await bodyHas(page, "המארז שלי") && await bodyHas(page, "הפריט הזה"));
  await shot(page, "08-item-history");

  await goto(page, "/");
  check("/ (items) renders with קליטת מארז", await bodyHas(page, "קליטת מארז"));
  await shot(page, "09-items");

  await goto(page, "/testing");
  check("/testing renders", await bodyHas(page, "בחר עמדת בדיקה") || await bodyHas(page, "עמדה"));
  await shot(page, "10-testing-empty");

  check("no page errors / 5xx during smoke", errors.length === 0, errors.slice(0, 5).join(" || "));
} catch (e) {
  check("smoke script completed", false, e.message);
  await shot(page, "99-smoke-error");
} finally {
  summary();
  await browser.close();
}
