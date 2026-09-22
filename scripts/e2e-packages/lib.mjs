// Shared harness for the package-model browser tests (puppeteer-core + local Chrome).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

export const S = path.dirname(fileURLToPath(import.meta.url));
export const shotsDir = path.join(S, "shots");
fs.mkdirSync(shotsDir, { recursive: true });
// Target and login come from the environment (see README.md):
//   E2E_BASE=http://<app host>  E2E_USER=<keycloak user>  E2E_PASS=...
const credsFile = process.env.E2E_CREDS_FILE ?? path.join(S, ".e2e-user.json");
const fileCreds = fs.existsSync(credsFile) ? JSON.parse(fs.readFileSync(credsFile, "utf8")) : {};
export const creds = { base: process.env.E2E_BASE ?? fileCreds.base, username: process.env.E2E_USER ?? fileCreds.username, password: process.env.E2E_PASS ?? fileCreds.password };
if (!creds.base || !creds.username || !creds.password) throw new Error("set E2E_BASE, E2E_USER and E2E_PASS (or E2E_CREDS_FILE)");
export const BASE = creds.base;

export const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

export async function launch() {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--lang=he-IL", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror @ ${page.url()}: ${e.message.slice(0, 140)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`); });
  return { browser, page, errors };
}

export async function shot(page, name) {
  const p = path.join(shotsDir, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

/** Keycloak login through the app's own redirect. */
export async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  if (page.url().includes("/auth/realms/")) {
    await page.waitForSelector("#username");
    await page.type("#username", creds.username);
    await page.type("#password", creds.password);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }), page.click("#kc-login")]);
  }
  return page.url();
}

/** Same-origin fetch inside the page (carries the session cookie). */
export async function api(page, pathname, init = {}) {
  return page.evaluate(async (p, i) => {
    const r = await fetch(p, { ...i, headers: { "Content-Type": "application/json", ...(i.headers || {}) } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, ok: r.ok, json, text: json ? null : text.slice(0, 300) };
  }, pathname, init);
}

export async function goto(page, pathname) {
  await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
}

export async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.innerText).catch(() => null);
}

export async function bodyHas(page, needle) {
  const t = await page.evaluate(() => document.body.innerText);
  return t.includes(needle);
}

/** Clicks the first <tag> whose text contains `text` — or equals it with `{ exact: true }`,
 *  for labels that are a prefix of another button's ("מדבקות" vs "מדבקות למארזים שהוסבו"). */
export async function clickByText(page, text, tag = "button", { exact = false } = {}) {
  const handle = await page.evaluateHandle((t, tg, ex) => {
    const els = [...document.querySelectorAll(tg)];
    return els.find((e) => { const s = (e.innerText || "").trim(); return ex ? s === t : s.includes(t); }) || null;
  }, text, tag, exact);
  const el = handle.asElement();
  if (!el) throw new Error(`no <${tag}> with text "${text}"`);
  await el.click();
  await new Promise((r) => setTimeout(r, 500));
}

export function summary() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  for (const r of results.filter((r) => !r.ok)) console.log(`  FAIL ${r.name} ${r.detail}`);
  fs.writeFileSync(path.join(S, "results.json"), JSON.stringify(results, null, 2));
}

/**
 * The ids the suites need, resolved by NAME from the running app after login,
 * so the same scripts run against any database (dev config, the production
 * clone, a fresh one):
 *   PKG_TYPE / PKG_TYPE_NAME   the package type (E2E_PKG_TYPE, default "מארז מגבר"); PKG_TYPE_NAMES = every package type's name
 *   OTHER_PKG_TYPE   any other package type (for the "cannot retype a box" rule)
 *   OPENING_TYPE / CLOSING_TYPE   first and last step of that package type's route
 *   RESEARCH_TYPE   the station type that has a research station
 *   TYPES   item types by key; E2E_ITEM_TYPES="amp=מגבר הספק,kit=ערכת מחברים,..." overrides
 */
export async function resolveConfig(page) {
  const pkgName = process.env.E2E_PKG_TYPE ?? "מארז מגבר";
  const itemNames = { amp: "מגבר הספק", kit: "ערכת מחברים", cable: "כבל תדר גבוה", psu: "ספק כוח" };
  for (const kv of (process.env.E2E_ITEM_TYPES ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    if (k && v) itemNames[k.trim()] = v.trim();
  }
  const pkgTypes = (await api(page, "/api/settings/package-types")).json || [];
  const pkg = pkgTypes.find((t) => t.item_type_desc === pkgName);
  if (!pkg) throw new Error(`package type "${pkgName}" not found (set E2E_PKG_TYPE); have: ${pkgTypes.map((t) => t.item_type_desc).join(", ") || "none"}`);
  const other = pkgTypes.find((t) => t.item_type_id !== pkg.item_type_id);
  const routes = (await api(page, `/api/settings/testing-routes?itemTypeId=${pkg.item_type_id}&routeNumber=${pkg.default_route_number ?? 1}`)).json || [];
  const steps = routes[0]?.route_steps ?? [];
  if (steps.length < 2) throw new Error(`package type "${pkgName}" has no usable route (steps: ${JSON.stringify(steps)})`);
  const itemTypes = (await api(page, "/api/itemTypes")).json || [];
  const TYPES = {};
  for (const [k, name] of Object.entries(itemNames)) {
    const t = itemTypes.find((x) => x.item_type_desc === name);
    if (t) TYPES[k] = t.item_type_id;
  }
  const missing = Object.keys(itemNames).filter((k) => TYPES[k] == null);
  if (missing.length) throw new Error(`item types not found by name: ${missing.map((k) => k + "=" + itemNames[k]).join(", ")} (set E2E_ITEM_TYPES)`);
  let RESEARCH_TYPE = null;
  for (const st of (await api(page, "/api/settings/test-stations-type")).json || []) {
    const stations = (await api(page, `/api/testing/test-stations?typeId=${st.test_station_type_id}`)).json || [];
    if (stations.some((x) => x.is_research)) { RESEARCH_TYPE = st.test_station_type_id; break; }
  }
  const cfg = { PKG_TYPE: pkg.item_type_id, PKG_TYPE_NAME: pkg.item_type_desc, PKG_TYPE_NAMES: pkgTypes.map((t) => t.item_type_desc), OTHER_PKG_TYPE: other?.item_type_id ?? null, OPENING_TYPE: Number(steps[0]), CLOSING_TYPE: Number(steps[steps.length - 1]), RESEARCH_TYPE, TYPES };
  console.log(`config: package type ${pkg.item_type_desc} #${cfg.PKG_TYPE}, opening #${cfg.OPENING_TYPE}, closing #${cfg.CLOSING_TYPE}, research #${cfg.RESEARCH_TYPE}, items ${JSON.stringify(TYPES)}`);
  return cfg;
}
