// Shared plumbing for the stepwise dashboard check (see README.md here).
// Everything comes from the environment; nothing points at a real database by default.
import pg from "pg";
import crypto from "node:crypto";

export const DATABASE_URL = process.env.DATABASE_URL || "";
export const API = (process.env.API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

// The check never TRUNCATEs, but it writes fabricated customers, stations and boxes:
// never against production.
const PROD_LOOKING = /(^|[^a-z])(prod|production|inventorydb)([^a-z]|$)/i;
const dbName = (() => { try { return new URL(DATABASE_URL).pathname.replace(/^\//, ""); } catch { return ""; } })();
if (!dbName) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (PROD_LOOKING.test(dbName)) { console.error(`refusing a production-looking database: "${dbName}"`); process.exit(2); }
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error(`refusing a non-local API_BASE: ${API}`); process.exit(2); }
if (!AUTH_SECRET || !CRON_SECRET) { console.error("AUTH_SECRET and CRON_SECRET must match the running app"); process.exit(2); }

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
export const q = async (s, p = []) => (await pool.query(s, p)).rows;
export const q1 = async (s, p = []) => (await q(s, p))[0] ?? null;

let cookie = null;
export async function sessionToken(roles = ["manager", "mashan", "tester"]) {
  const { encode } = await import("next-auth/jwt");
  const now = Math.floor(Date.now() / 1000);
  return encode({
    secret: AUTH_SECRET, salt: "authjs.session-token", maxAge: 86400,
    token: { sub: "dashboard-check", name: "Dashboard Check", email: "check@example.local", preferred_username: "dashcheck",
      employee_number: "9001", roles, access_token: "x", expires_at: (now + 86400) * 1000,
      refresh_expires_at: (now + 86400) * 1000, iat: now, exp: now + 86400 },
  });
}
export async function login(roles) { cookie = await sessionToken(roles); }

export async function api(method, path, body, { expect = [200, 201], cron = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = `authjs.session-token=${cookie}`;
  if (cron) headers["x-cron-secret"] = CRON_SECRET;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const ok = expect.includes(res.status);
  if (!ok) console.log(`  !! ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return { ok, status: res.status, json, text, headers: res.headers };
}
export const uuid = () => crypto.randomUUID();
