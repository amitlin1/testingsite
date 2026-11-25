// Where Keycloak is: the back channel falls back to the public issuer; the admin API base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminApiBase, internalIssuer, isKeycloakConfigured } from "../keycloak-env";

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the back channel uses the internal issuer when set, the public one when unset or empty", () => {
  const pub = "https://host/auth/realms/testing";
  withEnv({ AUTH_KEYCLOAK_ISSUER: pub, KEYCLOAK_INTERNAL_ISSUER: "http://keycloak:8080/auth/realms/testing" }, () =>
    assert.equal(internalIssuer(), "http://keycloak:8080/auth/realms/testing"),
  );
  withEnv({ AUTH_KEYCLOAK_ISSUER: pub, KEYCLOAK_INTERNAL_ISSUER: undefined }, () => assert.equal(internalIssuer(), pub));
  withEnv({ AUTH_KEYCLOAK_ISSUER: pub, KEYCLOAK_INTERNAL_ISSUER: "" }, () => assert.equal(internalIssuer(), pub));
});

test("the provider is configured only with client id, secret and issuer all set", () => {
  const all = { AUTH_KEYCLOAK_ID: "web", AUTH_KEYCLOAK_SECRET: "s", AUTH_KEYCLOAK_ISSUER: "https://host/realms/r" };
  withEnv(all, () => assert.equal(isKeycloakConfigured(), true));
  withEnv({ ...all, AUTH_KEYCLOAK_SECRET: "" }, () => assert.equal(isKeycloakConfigured(), false));
  withEnv({ ...all, AUTH_KEYCLOAK_ISSUER: undefined }, () => assert.equal(isKeycloakConfigured(), false));
});

test("the admin API sits beside the realm: {server}/admin/realms/{realm}", () => {
  assert.equal(adminApiBase("http://keycloak:8080/auth/realms/testing"), "http://keycloak:8080/auth/admin/realms/testing");
  assert.equal(adminApiBase("https://host/realms/testing"), "https://host/admin/realms/testing");
});
