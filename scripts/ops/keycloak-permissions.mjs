#!/usr/bin/env node
// Keycloak side of the permissions (src/lib/auth/roles.ts): for every permission in
// permissions.json a pair of realm roles — perm-<name> grants it, no-<name> takes it away from one
// user — and every main role (manager, tester, …) made a BUNDLE: a composite role holding its
// permissions, so whoever has the main role has them all.
//
//   node keycloak-permissions.mjs check  --url http://keycloak:8080/auth     (default: read only)
//   node keycloak-permissions.mjs apply  --url http://keycloak:8080/auth [--deny step-back=user1,user2]
//
// Normally run through keycloak-permissions.ps1. On the machine Keycloak runs on, that one needs no
// password: it has Keycloak itself create a temporary admin login (kc.sh bootstrap-admin service)
// and runs this with it — --client-id, secret in KC_ADMIN_CLIENT_SECRET, --temp-client — and this
// deletes that login at the end (and any left over by an earlier run that died). From elsewhere
// the Keycloak admin logs in with a password (KC_ADMIN_PASSWORD, --user). Either way it is an
// admin of the master realm: the app's own service account cannot create roles.
//
// What apply does — only ever ADDS, never touches a user it was not asked about:
//   1. creates the roles the realm lacks: missing main roles, and every perm-… / no-… pair;
//   2. fills the bundles: a main role with no perm-… role yet (never migrated) gets its whole
//      default bundle; a permission created in this very run is added to the bundles the table
//      names. A bundle that was already filled is left as it is — someone may have changed it in
//      Keycloak on purpose — and its differences from the table are only reported
//      (--reset-bundles makes every bundle exactly the table's, adding and removing);
//   3. gives the app's service account (--service-client, testing-admin-api) the realm-management
//      role manage-realm, which the managers' role editor needs to change a bundle;
//   4. --deny <permission>=<user>,<user> (repeatable): gives those users the no-… role.
// It runs check again at the end and fails if anything is still pending. Safe to run any number of
// times. SQL into Keycloak's database is not an alternative: Keycloak caches it and owns its schema.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    realm: { type: "string", default: "testing" },
    user: { type: "string", default: "admin" },
    "client-id": { type: "string" },
    "temp-client": { type: "boolean", default: false },
    "admin-realm": { type: "string", default: "master" },
    table: { type: "string" },
    deny: { type: "string", multiple: true, default: [] },
    "reset-bundles": { type: "boolean", default: false },
    "service-client": { type: "string", default: "testing-admin-api" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const USAGE = `usage: node keycloak-permissions.mjs [check|apply] --url <keycloak server, e.g. http://keycloak:8080/auth>
         [--realm testing] [--admin-realm master] [--table permissions.json]
         [--deny <permission>=<user>,<user> ...] [--reset-bundles] [--service-client testing-admin-api]
  login: --user admin + KC_ADMIN_PASSWORD, or --client-id <id> + KC_ADMIN_CLIENT_SECRET
         [--temp-client: delete that client at the end, and leftover perm-script-* clients]`;

// A refusal: printed by main()'s catch, exit code 1. (Never process.exit() with fetch's sockets
// open — on Windows node aborts on it.)
class Fatal extends Error {}
function fail(message) {
  throw new Fatal(message);
}

const mode = positionals[0] ?? "check";
const password = process.env.KC_ADMIN_PASSWORD;
const clientSecret = process.env.KC_ADMIN_CLIENT_SECRET;
const clientId = opt["client-id"];
/** The temporary logins keycloak-permissions.ps1 creates are named so. */
const TEMP_PREFIX = "perm-script-";

// ---- the table (the app's own: src/lib/auth/permissions.json) --------------------------------

function findTable() {
  const candidates = opt.table
    ? [opt.table]
    : [path.join(HERE, "permissions.json"), path.join(HERE, "..", "..", "src", "lib", "auth", "permissions.json")];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) fail(`permissions.json not found (looked in: ${candidates.join(", ")}). Pass --table.`);
  return found;
}
let tablePath;
let table;
try {
  tablePath = findTable();
  table = JSON.parse(fs.readFileSync(tablePath, "utf8"));
} catch (e) {
  // Nothing is open yet, so exiting here is safe.
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
}
const MAIN = Object.keys(table.mainRoles);
const PERMS = Object.entries(table.permissions).map(([key, p]) => ({
  key,
  suffix: p.role,
  role: table.grant + p.role,
  deny: table.deny + p.role,
  label: p.label,
  bundles: p.bundles,
}));
/** Never taken away from one user (the app refuses it too: src/lib/users/rules.ts UNDENIABLE). */
const UNDENIABLE = new Set(["usersAdmin"]);

// ---- Keycloak ----------------------------------------------------------------------------------

// Accept the server ("…/auth") or an issuer ("…/auth/realms/testing").
const SERVER = opt.url.replace(/\/+$/, "").replace(/\/realms\/[^/]+$/, "");
const ADMIN = `${SERVER}/admin/realms/${encodeURIComponent(opt.realm)}`;
/** The admin realm's own admin API (where the temporary logins live). */
const ADMIN_REALM_API = `${SERVER}/admin/realms/${encodeURIComponent(opt["admin-realm"])}`;
let token = null;

async function login() {
  const form = clientId
    ? { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }
    : { grant_type: "password", client_id: "admin-cli", username: opt.user, password };
  const who = clientId ? `client "${clientId}"` : `"${opt.user}"`;
  const res = await fetch(`${SERVER}/realms/${encodeURIComponent(opt["admin-realm"])}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  }).catch((e) => fail(`cannot reach Keycloak at ${SERVER}: ${e.cause?.code ?? e.message}`));
  if (!res.ok) fail(`login as ${who} in realm "${opt["admin-realm"]}" failed: ${res.status} ${await res.text().catch(() => "")}`);
  token = (await res.json()).access_token;
}

/** One admin call (a path under the realm's admin API, or a full URL); a 401 (the admin token
 *  lives a minute) logs in again once. */
async function kc(method, p, body, retried = false) {
  if (!token) await login();
  const res = await fetch(p.startsWith("http") ? p : `${ADMIN}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    token = null;
    return kc(method, p, body, true);
  }
  return res;
}

/** The temporary logins (perm-script-…) in the admin realm: every one but ours, or ours too. */
async function deleteTempClients({ includingOurs }) {
  const res = await kc("GET", `${ADMIN_REALM_API}/clients?clientId=${encodeURIComponent(TEMP_PREFIX)}&search=true&max=100`);
  if (!res.ok) return;
  // Ours last: once it is gone, this login is too.
  const clients = (await res.json()).sort((x, y) => (x.clientId === clientId) - (y.clientId === clientId));
  for (const c of clients) {
    if (!c.clientId.startsWith(TEMP_PREFIX) || (!includingOurs && c.clientId === clientId)) continue;
    const del = await kc("DELETE", `${ADMIN_REALM_API}/clients/${c.id}`);
    console.log(del.ok ? `  temporary login ${c.clientId} deleted` : `  WARNING: could not delete temporary login ${c.clientId} (${del.status})`);
  }
}

async function json(method, p, body) {
  const res = await kc(method, p, body);
  if (!res.ok) fail(`${method} ${p}: ${res.status} ${await res.text().catch(() => "")}`);
  return res.status === 204 || res.headers.get("content-length") === "0" ? null : res.json();
}

const enc = encodeURIComponent;
const ref = (r) => ({ id: r.id, name: r.name });

async function realmRoles() {
  const all = [];
  for (let first = 0; ; first += 500) {
    const page = await json("GET", `/roles?first=${first}&max=500&briefRepresentation=true`);
    all.push(...page);
    if (page.length < 500) return new Map(all.map((r) => [r.name, r]));
  }
}

const bundleOf = async (name) => (await json("GET", `/roles/${enc(name)}/composites/realm`)).map((r) => r.name);

async function userByName(username) {
  const [u] = await json("GET", `/users?username=${enc(username)}&exact=true&max=1`);
  return u ?? null;
}

// ---- the plan ----------------------------------------------------------------------------------

function parseDeny(spec) {
  const at = spec.indexOf("=");
  if (at < 1) fail(`--deny "${spec}": expected <permission>=<user>,<user>`);
  const name = spec.slice(0, at).trim();
  const p = PERMS.find((x) => x.key === name || x.suffix === name || x.role === name || x.deny === name);
  if (!p) fail(`--deny "${spec}": no permission "${name}". Known: ${PERMS.map((x) => x.suffix).join(", ")}`);
  if (UNDENIABLE.has(p.key)) fail(`--deny "${spec}": ${p.role} cannot be taken away from one user (change the main role instead).`);
  const users = spec.slice(at + 1).split(",").map((s) => s.trim()).filter(Boolean);
  if (users.length === 0) fail(`--deny "${spec}": no users`);
  return { perm: p, users };
}

async function plan() {
  const roles = await realmRoles();
  const create = [];
  for (const name of MAIN) if (!roles.has(name)) create.push({ name, description: table.mainRoles[name] });
  for (const p of PERMS) {
    if (!roles.has(p.role)) create.push({ name: p.role, description: `הרשאה: ${p.label}`, perm: p });
    if (!roles.has(p.deny)) create.push({ name: p.deny, description: `בלי: ${p.label}` });
  }
  const created = new Set(create.map((c) => c.name));

  const bundles = [];
  for (const name of MAIN) {
    const current = roles.has(name) ? (await bundleOf(name)).filter((r) => r.startsWith(table.grant)) : [];
    const want = PERMS.filter((p) => p.bundles.includes(name)).map((p) => p.role);
    const fresh = current.length === 0;
    const missing = want.filter((r) => !current.includes(r));
    const extra = current.filter((r) => !want.includes(r));
    const add = missing.filter((r) => fresh || created.has(r) || opt["reset-bundles"]);
    const keptOut = missing.filter((r) => !add.includes(r));
    const remove = opt["reset-bundles"] ? extra : [];
    const keptIn = extra.filter((r) => !remove.includes(r));
    bundles.push({ name, fresh, current, add, remove, keptOut, keptIn });
  }

  const denies = [];
  for (const spec of opt.deny) {
    const { perm, users } = parseDeny(spec);
    for (const username of users) {
      const u = await userByName(username);
      if (!u) fail(`--deny: no user "${username}" in realm "${opt.realm}"`);
      const direct = (await json("GET", `/users/${u.id}/role-mappings/realm`)).map((r) => r.name);
      if (!direct.includes(perm.deny)) denies.push({ username, id: u.id, perm, mainRole: direct.find((r) => MAIN.includes(r)) ?? null });
    }
  }

  const service = await serviceAccountPlan();

  const unknown = [...roles.keys()].filter(
    (n) => (n.startsWith(table.grant) || n.startsWith(table.deny)) && !PERMS.some((p) => p.role === n || p.deny === n),
  );
  return { create, bundles, denies, unknown, service };
}

/** The app's service account must hold realm-management's manage-realm (the role editor). */
async function serviceAccountPlan() {
  const name = opt["service-client"];
  const [rm] = await json("GET", `/clients?clientId=realm-management`);
  const [svc] = await json("GET", `/clients?clientId=${enc(name)}`);
  if (!rm || !svc) return { name, missing: true };
  const user = await json("GET", `/clients/${svc.id}/service-account-user`);
  const held = (await json("GET", `/users/${user.id}/role-mappings/clients/${rm.id}/composite`)).map((r) => r.name);
  if (held.includes("manage-realm")) return { name, ok: true };
  return { name, grant: { userId: user.id, rmId: rm.id, role: await json("GET", `/clients/${rm.id}/roles/manage-realm`) } };
}

const pendingOf = (pl) =>
  pl.create.length + pl.bundles.reduce((n, b) => n + b.add.length + b.remove.length, 0) + pl.denies.length + (pl.service.grant ? 1 : 0);

function report(pl) {
  console.log(`\nRealm "${opt.realm}" at ${SERVER}  (table: ${tablePath})`);
  console.log(`\nRoles to create: ${pl.create.length}`);
  for (const c of pl.create) console.log(`  + ${c.name}`);
  console.log("\nBundles (main role -> its perm-… roles):");
  for (const b of pl.bundles) {
    const state = b.fresh ? "not a bundle yet" : `${b.current.length} permissions`;
    console.log(`  ${b.name}: ${state}`);
    for (const r of b.add) console.log(`    + ${r}`);
    for (const r of b.remove) console.log(`    - ${r}`);
    for (const r of b.keptOut) console.log(`    = ${r}  (default, but left out in Keycloak — kept; --reset-bundles adds it)`);
    for (const r of b.keptIn) console.log(`    = ${r}  (not a default, added in Keycloak — kept; --reset-bundles removes it)`);
  }
  console.log(`\nService account ${pl.service.name} (the app's): ${
    pl.service.missing ? "NOT FOUND — the role editor will not be able to save" : pl.service.ok ? "has manage-realm" : "+ manage-realm"}`);
  if (pl.denies.length) {
    console.log("\nPermissions to take away:");
    for (const d of pl.denies) console.log(`  + ${d.username} (${d.mainRole ?? "no main role"}): ${d.perm.deny}`);
  }
  if (pl.unknown.length) {
    console.log("\nperm-/no- roles in the realm that the table does not know (left alone):");
    for (const n of pl.unknown) console.log(`  ? ${n}`);
  }
}

async function apply(pl) {
  for (const c of pl.create) {
    const res = await kc("POST", "/roles", { name: c.name, description: c.description });
    if (!res.ok && res.status !== 409) fail(`create role ${c.name}: ${res.status} ${await res.text()}`);
    console.log(`  created ${c.name}`);
  }
  const roles = await realmRoles();
  for (const b of pl.bundles) {
    if (b.add.length) {
      await json("POST", `/roles/${enc(b.name)}/composites`, b.add.map((n) => ref(roles.get(n))));
      console.log(`  ${b.name}: +${b.add.length}`);
    }
    if (b.remove.length) {
      await json("DELETE", `/roles/${enc(b.name)}/composites`, b.remove.map((n) => ref(roles.get(n))));
      console.log(`  ${b.name}: -${b.remove.length}`);
    }
  }
  if (pl.service.grant) {
    const g = pl.service.grant;
    await json("POST", `/users/${g.userId}/role-mappings/clients/${g.rmId}`, [ref(g.role)]);
    console.log(`  ${pl.service.name}: + manage-realm`);
  }
  for (const d of pl.denies) {
    await json("POST", `/users/${d.id}/role-mappings/realm`, [ref(roles.get(d.perm.deny))]);
    console.log(`  ${d.username}: ${d.perm.deny}`);
  }
}

/** Who has something taken away, after the run. */
async function exceptions() {
  const lines = [];
  for (const p of PERMS) {
    const res = await kc("GET", `/roles/${enc(p.deny)}/users?first=0&max=1000`);
    if (!res.ok) continue;
    for (const u of await res.json()) lines.push(`  ${u.username}: ${p.deny}`);
  }
  console.log(`\nUsers with a permission taken away: ${lines.length}`);
  for (const l of lines.sort()) console.log(l);
}

// ---- run ---------------------------------------------------------------------------------------

async function main() {
  if (opt.help || !["check", "apply"].includes(mode) || !opt.url) {
    console.log(USAGE);
    if (!opt.help) process.exitCode = 1;
    return;
  }
  if (clientId ? !clientSecret : !password) fail(clientId ? "KC_ADMIN_CLIENT_SECRET is not set." : "KC_ADMIN_PASSWORD is not set.");
  await login();
  if (opt["temp-client"]) {
    if (!clientId?.startsWith(TEMP_PREFIX)) fail(`--temp-client needs a --client-id starting with "${TEMP_PREFIX}"`);
    try {
      await deleteTempClients({ includingOurs: false });
      await run();
    } finally {
      await deleteTempClients({ includingOurs: true });
    }
    return;
  }
  await run();
}

async function run() {
  const realm = await kc("GET", "");
  if (realm.status === 404) fail(`realm "${opt.realm}" does not exist at ${SERVER}`);
  if (!realm.ok) fail(`reading realm "${opt.realm}": ${realm.status} — is this login an admin of it?`);

  const before = await plan();
  report(before);
  const pending = pendingOf(before);

  if (mode === "check") {
    console.log(pending ? `\n${pending} change(s) pending — run apply to make them.` : "\nNothing to do: the realm matches.");
    await exceptions();
    return;
  }

  if (pending === 0) {
    console.log("\nNothing to do: the realm matches.");
  } else {
    console.log("\nApplying…");
    await apply(before);
    const after = await plan();
    const left = pendingOf(after);
    if (left) {
      report(after);
      fail(`${left} change(s) still pending after apply.`);
    }
    console.log("\nDone and verified: nothing pending.");
  }
  await exceptions();
  console.log("\nUsers see the change at their next token refresh (at most the access-token lifespan, 15 min here), or at once after signing in again.");
}

main().catch((e) => {
  console.error(`\nERROR: ${e instanceof Fatal ? e.message : (e?.stack ?? e)}`);
  process.exitCode = 1;
});
