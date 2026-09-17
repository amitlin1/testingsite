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
//   E2E_BASE=http://10.10.200.120  E2E_USER=pkgtest  E2E_PASS=...
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

export async function clickByText(page, text, tag = "button") {
  const handle = await page.evaluateHandle((t, tg) => {
    const els = [...document.querySelectorAll(tg)];
    return els.find((e) => (e.innerText || "").trim().includes(t)) || null;
  }, text, tag);
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
