// Creates (or resets) a dedicated Keycloak test user for the browser tests.
// Usage: node kc-user.mjs create | delete
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// The app-server .env holds APP_PUBLIC_URL and the Keycloak admin client used to manage users.
const envPath = process.env.APP_SERVER_ENV ?? fileURLToPath(new URL("../../prod-deploy/app-server/.env", import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const base = env.APP_PUBLIC_URL;
const realm = `${base}/auth/realms/testing`;
const admin = `${base}/auth/admin/realms/testing`;
const outPath = new URL("./.e2e-user.json", import.meta.url);
const username = "pkgtest";

const tokRes = await fetch(`${realm}/protocol/openid-connect/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.KEYCLOAK_ADMIN_CLIENT_ID, client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET }),
});
const { access_token: tok } = await tokRes.json();
if (!tok) throw new Error("no admin token");
const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

const found = await (await fetch(`${admin}/users?username=${username}&exact=true`, { headers: h })).json();
const mode = process.argv[2] ?? "create";

if (mode === "delete") {
  for (const u of found) {
    const r = await fetch(`${admin}/users/${u.id}`, { method: "DELETE", headers: h });
    console.log("deleted", u.username, r.status);
  }
  process.exit(0);
}

const password = crypto.randomBytes(9).toString("base64url");
let id = found[0]?.id;
if (!id) {
  const r = await fetch(`${admin}/users`, {
    method: "POST", headers: h,
    body: JSON.stringify({ username, enabled: true, emailVerified: true, firstName: "בדיקות", lastName: "מארזים", email: "pkgtest@example.local",
      attributes: { employeeNumber: ["9902"] }, credentials: [{ type: "password", value: password, temporary: false }] }),
  });
  if (r.status !== 201) throw new Error(`create user: ${r.status} ${await r.text()}`);
  id = (await (await fetch(`${admin}/users?username=${username}&exact=true`, { headers: h })).json())[0].id;
} else {
  const r = await fetch(`${admin}/users/${id}/reset-password`, { method: "PUT", headers: h, body: JSON.stringify({ type: "password", value: password, temporary: false }) });
  if (r.status >= 300) throw new Error(`reset password: ${r.status}`);
}
const roles = await (await fetch(`${admin}/roles`, { headers: h })).json();
const wanted = roles.filter((r) => ["manager", "tester", "storekeeper"].includes(r.name)).map((r) => ({ id: r.id, name: r.name }));
const rm = await fetch(`${admin}/users/${id}/role-mappings/realm`, { method: "POST", headers: h, body: JSON.stringify(wanted) });
if (rm.status >= 300) throw new Error(`role mapping: ${rm.status} ${await rm.text()}`);
fs.writeFileSync(outPath, JSON.stringify({ base, username, password, employeeNumber: "9902", roles: wanted.map((w) => w.name) }, null, 2));
console.log(`user ${username} ready (id ${id}), roles: ${wanted.map((w) => w.name).join(",")}, creds saved to .e2e-user.json`);
