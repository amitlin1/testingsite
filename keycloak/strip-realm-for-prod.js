// Produce a PRODUCTION realm import from the dev export.
//
//   node keycloak/strip-realm-for-prod.js
//
// Reads keycloak/import/testing-realm.json (the dev export) and writes
// keycloak/import-prod/testing-realm.json with:
//   - the dev test users removed (manager1 / bodek1 / mahsan1) — keeps only the
//     service-account user needed by the admin API
//   - baked-in client `secret`s removed → Keycloak regenerates fresh secrets on
//     import; retrieve them afterwards and put them in the app's prod env
//
// The prod compose (docker-compose.keycloak.prod.yml) mounts import-prod, so the
// dev realm file is never imported in production.

const fs = require("fs");
const path = require("path");

const inPath = path.join(__dirname, "import", "testing-realm.json");
const outDir = path.join(__dirname, "import-prod");
const outPath = path.join(outDir, "testing-realm.json");

const DEV_TEST_USERS = new Set(["manager1", "bodek1", "mahsan1"]);

const realm = JSON.parse(fs.readFileSync(inPath, "utf8"));

if (Array.isArray(realm.users)) {
  const before = realm.users.length;
  realm.users = realm.users.filter((u) => !DEV_TEST_USERS.has(u.username));
  console.log(`users: ${before} -> ${realm.users.length} (removed dev test users)`);
}

let cleared = 0;
if (Array.isArray(realm.clients)) {
  for (const c of realm.clients) {
    if (c.secret) {
      delete c.secret;
      cleared++;
    }
  }
}
console.log(`cleared ${cleared} baked client secret(s) — Keycloak will regenerate`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(realm, null, 2));
console.log("wrote", outPath);
