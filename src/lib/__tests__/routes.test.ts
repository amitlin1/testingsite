// The middleware's access decision and the request classification it answers by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS } from "@/lib/auth/roles";
import { canSeeInNav, isDataRequest, resolveAccess } from "../routes";

test("public routes pass with or without a session, and only on their own path or under it", () => {
  assert.deepEqual(resolveAccess("/login", null), { kind: "public" });
  assert.deepEqual(resolveAccess("/api/cron/release-stale-tests", null), { kind: "public" });
  assert.deepEqual(resolveAccess("/api/files/download/items/1/a.pdf", null), { kind: "public" });
  assert.deepEqual(resolveAccess("/api/health", ["tester"]), { kind: "public" });
  assert.deepEqual(resolveAccess("/loginx", null), { kind: "needs-auth" });
});

test("a public path opens what is under it only when it says so: /api/health/jobs needs a session", () => {
  assert.deepEqual(resolveAccess("/api/health/schema", null), { kind: "public" });
  assert.deepEqual(resolveAccess("/api/health/jobs", null), { kind: "needs-auth" });
  assert.deepEqual(resolveAccess("/login/anything", null), { kind: "needs-auth" });
});

test("no session on a non-public route needs a login", () => {
  assert.deepEqual(resolveAccess("/packages", null), { kind: "needs-auth" });
  assert.deepEqual(resolveAccess("/api/users", null), { kind: "needs-auth" });
});

test("a role-protected route answers forbidden with the ACCESS set it requires", () => {
  assert.deepEqual(resolveAccess("/api/users/abc", ["tester"]), { kind: "forbidden", required: ACCESS.usersAdmin });
  assert.deepEqual(resolveAccess("/settings/users", ["manager"]), { kind: "allowed" });
  assert.deepEqual(resolveAccess("/dashboard/tests/kpis", ["storekeeper"]), { kind: "forbidden", required: ACCESS.dashboard });
});

test("the more specific settings rule wins over the catch-all, and an unlisted settings page is manager-only", () => {
  assert.equal(resolveAccess("/settings/customers", ["storekeeper"]).kind, "allowed");
  assert.equal(resolveAccess("/settings/something-new", ["storekeeper"]).kind, "forbidden");
  assert.equal(resolveAccess("/settings/something-new", ["manager"]).kind, "allowed");
});

test("routes not listed are open to any signed-in user", () => {
  assert.equal(resolveAccess("/packages/12", ["mashan"]).kind, "allowed");
  assert.equal(resolveAccess("/", []).kind, "allowed");
});

test("navigation: an unknown identity shows only what needs no role, never more than allowed", () => {
  assert.equal(canSeeInNav("/packages", null), true);
  assert.equal(canSeeInNav("/testing", null), false);
  assert.equal(canSeeInNav("/testing", ["tester"]), true);
  assert.equal(canSeeInNav("/settings/users", ["tester"]), false);
});

test("API paths and plain fetches are data requests; page and RSC navigations are not", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  assert.equal(isDataRequest("/api/items", h({ accept: "text/html", "sec-fetch-mode": "navigate" })), true);
  assert.equal(isDataRequest("/packages", h({ rsc: "1" })), false);
  assert.equal(isDataRequest("/packages", h({ "sec-fetch-mode": "navigate" })), false);
  assert.equal(isDataRequest("/packages", h({ accept: "text/html,application/xhtml+xml" })), false);
  assert.equal(isDataRequest("/packages", h({ accept: "application/json" })), true);
});
