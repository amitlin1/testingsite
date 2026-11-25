import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FieldsContextState, FieldsContextSubject } from "../useFieldsContext";
import { fetchFieldsContext, useFieldsContext } from "../useFieldsContext";
import { API, BadBody, parseFieldsContext, parseRouteFields } from "../wire";
import { artboard1, artboard11, wire } from "./fixtures";

test("a kit's context comes through as it was sent", () => {
  const ctx = wire(artboard1());
  assert.deepEqual(parseFieldsContext(wire(ctx)), ctx);
  const ctx11 = wire(artboard11());
  assert.deepEqual(parseFieldsContext(wire(ctx11)), ctx11);
  const missing = wire({ ...ctx, kit: null, kit_missing: "ROUTE_MISSING" });
  assert.deepEqual(parseFieldsContext(missing), missing);
});

test("the configs are parsed like the server parses them (a sanitized copy)", () => {
  const ctx = wire(artboard1()) as unknown as Record<string, unknown> & { kit: { published: { steps: Record<string, Record<string, unknown>> } } };
  ctx.kit.published.steps.s_kitopen1.smuggled = "x";
  const parsed = parseFieldsContext(ctx);
  assert.equal("smuggled" in parsed.kit!.published!.steps.s_kitopen1, false);
});

test("anything else is not a context (→ the error state, never an empty route) — an item route's included", () => {
  const ctx = wire(artboard1());
  const kit = ctx.kit!;
  const bad: unknown[] = [
    null, [], "x", {},
    { ...ctx, kind: "other" },
    // The screen asks for kits only: an item route's context is not what it asked for.
    { ...ctx, kind: "item", item: ctx.lines[0].route, lines: [] },
    { ...ctx, subject: { ...ctx.subject, item_type_id: "50" } },
    { ...ctx, stations: [] },
    { ...ctx, stations: { x: { label: "a", package_level: true } } },
    { ...ctx, stations: { 11: { label: "a" } } },
    { ...ctx, lines: {} },
    { ...ctx, lines: [{ ...ctx.lines[0], quantity: "1" }] },
    { ...ctx, lines: [{ ...ctx.lines[0], missing: 3 }] },
    { ...ctx, kit: { ...kit, draft_rev: -1 } },
    { ...ctx, kit: { ...kit, route: { ...kit.route, route_steps: ["11"] } } },
    { ...ctx, kit: { ...kit, published: { schema: 1, steps: { bad: {} } } } },
    { ...ctx, kit: { ...kit, issues: [{ level: "fatal", code: "X", message: "m" }] } },
    { ...ctx, kit: { ...kit, shared_with: [{ package_type_id: 0, desc: "x" }] } },
    { ...ctx, kit_missing: 1 },
  ];
  for (const b of bad) assert.throws(() => parseFieldsContext(b), BadBody, JSON.stringify(b)?.slice(0, 80));
  assert.throws(() => parseRouteFields({ ...kit, draft_updated_at: 5 }), BadBody);
  assert.deepEqual(parseRouteFields(wire(kit)), kit);
});

test("the request names the kit by packageTypeId", () => {
  assert.equal(API.fieldsContext(50, 1), "/api/settings/testing-routes/fields-context?packageTypeId=50&routeNumber=1");
});

test("fetchFieldsContext: the context on a valid 200, null on anything else", async () => {
  const ctx = wire(artboard1());
  const url = API.fieldsContext(50, 1);
  const seen: string[] = [];
  const reply = (status: number, body: unknown) => async (u: string, init: RequestInit) => {
    seen.push(u + " " + String(init.cache));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  assert.deepEqual(await fetchFieldsContext(url, undefined, reply(200, ctx)), ctx);
  assert.equal(seen[0], url + " no-store");
  assert.equal(await fetchFieldsContext(url, undefined, reply(500, { error: "x" })), null);
  assert.equal(await fetchFieldsContext(url, undefined, reply(404, ctx)), null, "only a 200 is a context");
  assert.equal(await fetchFieldsContext(url, undefined, reply(200, "<html>")), null);
  assert.equal(await fetchFieldsContext(url, undefined, reply(200, { ...ctx, lines: null })), null);
  assert.equal(await fetchFieldsContext(url, undefined, async () => {
    throw new TypeError("Failed to fetch");
  }), null);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await fetchFieldsContext(url, aborted.signal, reply(200, ctx)), null, "an answer to a request no longer wanted");
});

test("the hook: idle without a route (or with one that names none), loading until the first answer (never empty)", () => {
  const states: FieldsContextState["status"][] = [];
  function Probe({ subject }: { subject: FieldsContextSubject | null }) {
    states.push(useFieldsContext(subject).status);
    return null;
  }
  renderToStaticMarkup(createElement(Probe, { subject: null }));
  renderToStaticMarkup(createElement(Probe, { subject: { packageTypeId: 50, routeNumber: 1 } }));
  renderToStaticMarkup(createElement(Probe, { subject: { packageTypeId: 0, routeNumber: 1 } }));
  renderToStaticMarkup(createElement(Probe, { subject: { packageTypeId: 50, routeNumber: 1.5 } }));
  assert.deepEqual(states, ["idle", "loading", "idle", "idle"]);
});
