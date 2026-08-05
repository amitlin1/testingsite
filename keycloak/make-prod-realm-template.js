// Produce a PRODUCTION realm import TEMPLATE from the dev export.
//
//   node keycloak/make-prod-realm-template.js
//
// Reads  keycloak/import/testing-realm.json            (the dev export)
// Writes keycloak/import-prod/testing-realm.template.json
//
// The template is committed; the FINAL realm file is generated on the target
// machine by prod-deploy/app-server/scripts/2-prepare-realm.ps1, which
// substitutes the __PLACEHOLDER__ tokens from .env. That split is what keeps the
// air-gap install to "edit one .env, run two scripts" with ZERO clicking in the
// Keycloak admin console, while keeping secrets out of git.
//
// What it changes versus the dev export:
//   1. dev test users (manager1 / bodek1 / mahsan1) removed — the service-account
//      user for the admin API is KEPT (it carries the realm-management mapping)
//   2. a single bootstrap MANAGER user added, with a temporary password → the
//      operator can log into the app immediately and is forced to change it
//   3. baked client secrets replaced by placeholders → the app's .env and the
//      realm agree by construction, so nothing has to be regenerated and copied
//   4. every localhost URL (redirect URIs, web origins, post-logout URIs)
//      replaced by the __APP_URL__ placeholder
//
// Everything else — roles, the employeeNumber attribute, brute-force settings,
// token lifespans, the shifthouse login theme — carries over untouched, which is
// the point: production comes up configured identically to dev.

const fs = require("fs");
const path = require("path");

const inPath = path.join(__dirname, "import", "testing-realm.json");
const outDir = path.join(__dirname, "import-prod");
const outPath = path.join(outDir, "testing-realm.template.json");

const DEV_TEST_USERS = new Set(["manager1", "bodek1", "mahsan1"]);

// Placeholder tokens. Deliberately __UPPER__ with double underscores: they are
// not valid URL/secret characters, so a missed substitution fails loudly rather
// than silently producing a working-but-wrong config.
const P_APP_URL = "__APP_URL__";
const P_WEB_SECRET = "__WEB_CLIENT_SECRET__";
const P_ADMIN_SECRET = "__ADMIN_API_CLIENT_SECRET__";
const P_MGR_USER = "__BOOTSTRAP_MANAGER_USERNAME__";
const P_MGR_PASS = "__BOOTSTRAP_MANAGER_PASSWORD__";
const P_MGR_EMPNO = "__BOOTSTRAP_MANAGER_EMPLOYEE_NUMBER__";

const realm = JSON.parse(fs.readFileSync(inPath, "utf8"));

// ---- 1. users: drop the dev testers, keep service accounts ----
if (Array.isArray(realm.users)) {
  const before = realm.users.length;
  realm.users = realm.users.filter((u) => !DEV_TEST_USERS.has(u.username));
  console.log(`users: ${before} -> ${realm.users.length} (removed dev test users)`);
} else {
  realm.users = [];
}

// ---- 2. bootstrap manager, so the app is usable the moment Keycloak is up ----
// The operator must be forced to replace the seeded password at first login. The
// shifthouse theme already ships login-update-password.ftl for that screen.
//
// requiredActions is set EXPLICITLY rather than relying on the credential's
// `temporary: true` flag. Verified against Keycloak 26.7.0: realm import writes
// the credential directly and does NOT translate `temporary` into an
// UPDATE_PASSWORD action (that only happens through the admin REST API), so a
// realm relying on it alone comes up with a permanent, shared, file-stored
// password and no prompt. `temporary` is kept for correctness in case the file
// is ever replayed through the REST API.
realm.users.push({
  username: P_MGR_USER,
  enabled: true,
  emailVerified: false,
  firstName: "מנהל",
  lastName: "מערכת",
  attributes: { employeeNumber: [P_MGR_EMPNO] },
  credentials: [{ type: "password", value: P_MGR_PASS, temporary: true }],
  realmRoles: ["default-roles-testing", "manager"],
  requiredActions: ["UPDATE_PASSWORD"],
  groups: [],
});
console.log("added bootstrap manager user (must change password at first login)");

// ---- 3. client secrets -> placeholders ----
// Setting an explicit secret (rather than deleting it) is what removes the
// "regenerate in the console and copy it into the app env" step: the same value
// is written into both the realm and .env by the prepare script.
const CLIENT_SECRET_PLACEHOLDER = {
  "testing-web": P_WEB_SECRET,
  "testing-admin-api": P_ADMIN_SECRET,
};

let secretsSet = 0;
let urlsRewritten = 0;

if (Array.isArray(realm.clients)) {
  for (const c of realm.clients) {
    const placeholder = CLIENT_SECRET_PLACEHOLDER[c.clientId];
    if (placeholder) {
      c.secret = placeholder;
      secretsSet++;
    } else if (c.secret) {
      // Any other client that somehow carries a baked secret: strip it rather
      // than ship a dev value into production.
      delete c.secret;
    }

    // ---- 4. localhost -> __APP_URL__ ----
    const rewrite = (v) =>
      typeof v === "string"
        ? v.replace(/https?:\/\/localhost(:\d+)?/g, P_APP_URL)
        : v;

    for (const field of ["redirectUris", "webOrigins"]) {
      if (Array.isArray(c[field])) {
        const before = JSON.stringify(c[field]);
        // De-duplicate: dev lists both :3000 and :80 variants, which collapse to
        // the same string once the port-bearing host becomes one placeholder.
        c[field] = [...new Set(c[field].map(rewrite))];
        if (JSON.stringify(c[field]) !== before) urlsRewritten++;
      }
    }

    if (c.attributes && typeof c.attributes === "object") {
      for (const [k, v] of Object.entries(c.attributes)) {
        const next = rewrite(v);
        if (next !== v) {
          // The post-logout attribute is a ##-separated list — dedupe it too.
          c.attributes[k] =
            typeof next === "string" && next.includes("##")
              ? [...new Set(next.split("##"))].join("##")
              : next;
          urlsRewritten++;
        }
      }
    }
  }
}

console.log(`set ${secretsSet} client secret placeholder(s)`);
console.log(`rewrote ${urlsRewritten} localhost URL field(s) -> ${P_APP_URL}`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(realm, null, 2));
console.log("wrote", outPath);
