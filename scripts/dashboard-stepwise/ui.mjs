// Browser check: what the manager actually SEES on the dashboard, per tab,
// compared with what the API returned for the same window.
import { createRequire } from "node:module";
// playwright is not a dependency of the app: take it from PLAYWRIGHT_PATH, or from wherever require finds it.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
import fs from "node:fs";
import { login, api, pool, sessionToken, API } from "./lib.mjs";

const OUT = process.argv[2] || "dashboard-ui-check";
fs.mkdirSync(OUT, { recursive: true });
const token = await sessionToken();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: new URL(API).hostname, path: "/", httpOnly: true }]);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.url().includes("/api/dashboard") && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

const tabs = ["overview", "kpis", "stations", "shipments", "customers", "types", "times", "status", "slow"];
const texts = {};
for (const tab of tabs) {
  const scope = process.argv[3] === "all" ? "&showAllHistory=true" : "";
  await page.goto(`${API}/dashboard/tests?tab=${tab}${scope}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${tab}.png`, fullPage: true });
  texts[tab] = await page.evaluate(() => document.body.innerText);
}
fs.writeFileSync(`${OUT}/texts.json`, JSON.stringify(texts, null, 1));

// The KPI tab: card values vs the API for the same (default = today) window.
await login();
const d = new Date();
const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7), e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16);
const k = (await api("GET", `/api/dashboard/tests/kpis?startDate=${s.toISOString()}&endDate=${e.toISOString()}&scope=${process.argv[3] === "all" ? "all" : "open_shipments"}`)).json;
const card = (label) => {
  const t = texts.kpis; const i = t.indexOf(label); return i < 0 ? null : t.slice(i, i + 80).replace(/\s+/g, " ");
};
console.log("API kpis:", JSON.stringify({ q: k.itemsCurrentlyInQueue, t: k.itemsCurrentlyInTest, treated: k.treatedCount, avgQ: k.averageQueueTimeMinutes, avgP: k.averageProcessingTimeMinutes }));
for (const l of ["ממתינים כרגע", "בבדיקה כרגע", "מסלולים שנסגרו", "זמן המתנה ממוצע · ברוטו", "זמן ביצוע ממוצע · ברוטו", "העמדה העמוסה"]) console.log("UI card:", card(l));
console.log("console/HTTP errors:", errors.length ? errors : "none");
await browser.close(); await pool.end();
