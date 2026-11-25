// URLs under a basePath. The browser's base path is baked from NEXT_PUBLIC_BASE_PATH when the
// module loads, so it is set before the import (each test file runs in its own process).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_BASE_PATH = "myapp";
const basePath = import("../base-path");

test("the env carries a bare name or a /name; unset is a root mount", async () => {
  const { normalizeBasePath } = await basePath;
  assert.equal(normalizeBasePath("myapp"), "/myapp");
  assert.equal(normalizeBasePath("/myapp"), "/myapp");
  assert.equal(normalizeBasePath(""), "");
  assert.equal(normalizeBasePath(undefined), "");
});

test("withBasePath prefixes an app path once, and leaves absolute and relative URLs alone", async () => {
  const { withBasePath } = await basePath;
  assert.equal(withBasePath("/api/auth/session"), "/myapp/api/auth/session");
  assert.equal(withBasePath("/myapp/api/x"), "/myapp/api/x");
  assert.equal(withBasePath("/myapp"), "/myapp");
  assert.equal(withBasePath("/myappx/y"), "/myapp/myappx/y");
  assert.equal(withBasePath("https://kc.example/realms/x"), "https://kc.example/realms/x");
  assert.equal(withBasePath("//cdn.example/a"), "//cdn.example/a");
  assert.equal(withBasePath("relative/path"), "relative/path");
});

test("stripBasePath removes the prefix only on a segment boundary", async () => {
  const { stripBasePath } = await basePath;
  assert.equal(stripBasePath("/myapp/dashboard", "/myapp"), "/dashboard");
  assert.equal(stripBasePath("/myapp", "/myapp"), "/");
  assert.equal(stripBasePath("/myappx", "/myapp"), "/myappx");
  assert.equal(stripBasePath("/dashboard", ""), "/dashboard");
});

test("login's callbackUrl: a same-app path; never an auth endpoint, /login itself, or another site", async () => {
  const { safeCallbackUrl } = await basePath;
  assert.equal(safeCallbackUrl("/myapp/packages?q=1", "/myapp"), "/myapp/packages?q=1");
  assert.equal(safeCallbackUrl(null, "/myapp"), "/myapp/");
  assert.equal(safeCallbackUrl("https://evil.example/", "/myapp"), "/myapp/");
  assert.equal(safeCallbackUrl("/myapp/api/auth/signin", "/myapp"), "/myapp/");
  assert.equal(safeCallbackUrl("/myapp/login?callbackUrl=/x", "/myapp"), "/myapp/");
  assert.equal(safeCallbackUrl("/login", ""), "/");
  assert.equal(safeCallbackUrl("/packages", ""), "/packages");
});
