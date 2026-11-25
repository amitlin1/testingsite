// apiFetch's contract with the server: a 401 forces a session refresh and the request is retried
// once; a terminal session (or a second 401) sends the browser to /login. getJson/sendJson turn a
// non-2xx answer into an ApiError carrying the server's message.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiFetch, getArray, getJson, sendJson } from "../client";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let replies: Response[] = [];
const location = { pathname: "/packages", search: "?q=1", href: "" };

beforeEach(() => {
  calls = [];
  replies = [];
  location.href = "";
  (globalThis as { window?: unknown }).window = { location };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  }) as typeof fetch;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a non-401 answer is returned as it is, with no session round trip", async () => {
  replies = [json(500, { error: "x" })];
  const res = await apiFetch("/api/items");
  assert.equal(res.status, 500);
  assert.deepEqual(calls.map((c) => c.url), ["/api/items"]);
});

test("a 401 refreshes the session and retries the request once", async () => {
  replies = [json(401, {}), json(200, { user: {} }), json(200, { ok: true })];
  const res = await apiFetch("/api/items", { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.url), ["/api/items", "/api/auth/session", "/api/items"]);
  assert.equal(calls[2].init?.method, "POST");
  assert.equal(calls[1].init?.cache, "no-store");
  assert.equal(location.href, "");
});

test("a session that reports a terminal refresh failure goes to /login without retrying", async () => {
  replies = [json(401, {}), json(200, { error: "RefreshAccessTokenError" })];
  const res = await apiFetch("/api/items");
  assert.equal(res.status, 401);
  assert.equal(calls.length, 2);
  assert.equal(location.href, `/login?callbackUrl=${encodeURIComponent("/packages?q=1")}`);
});

test("a second 401 after the retry goes to /login", async () => {
  replies = [json(401, {}), json(200, {}), json(401, {})];
  const res = await apiFetch("/api/items");
  assert.equal(res.status, 401);
  assert.equal(calls.length, 3);
  assert.match(location.href, /^\/login\?callbackUrl=/);
});

test("retryOnUnauthorized:false hands the 401 back untouched", async () => {
  replies = [json(401, {})];
  const res = await apiFetch("/api/items", { retryOnUnauthorized: false });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 1);
  assert.equal(location.href, "");
});

test("getJson / sendJson: the server's error text, else the caller's fallback, on an ApiError with the status", async () => {
  replies = [json(409, { error: "כבר קיים", code: "DUP" })];
  await assert.rejects(getJson("/api/x"), (e: unknown) => e instanceof ApiError && e.status === 409 && e.message === "כבר קיים" && e.body.code === "DUP");
  replies = [json(500, {})];
  await assert.rejects(sendJson("/api/x", "PUT", { a: 1 }, "השמירה נכשלה"), (e: unknown) => e instanceof ApiError && e.message === "השמירה נכשלה");
  replies = [json(200, { id: 7 })];
  assert.deepEqual(await sendJson("/api/x", "POST", { a: 1 }), { id: 7 });
  assert.equal(calls.at(-1)?.init?.body, JSON.stringify({ a: 1 }));
});

test("getArray: the rows, no rows for an answer that is not a list, an ApiError for a refusal", async () => {
  replies = [json(200, [{ id: 1 }]), json(200, { rows: [] }), json(503, {})];
  assert.deepEqual(await getArray("/api/x"), [{ id: 1 }]);
  assert.deepEqual(await getArray("/api/x"), []);
  await assert.rejects(getArray("/api/x", "הטעינה נכשלה"), (e: unknown) => e instanceof ApiError && e.status === 503);
});
