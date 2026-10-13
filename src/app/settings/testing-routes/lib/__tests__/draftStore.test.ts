import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { DraftStore, DraftStoreProvider, useDraftSummary, useFieldsMap, useRouteDraft, writeOutcome } from "../draftStore";
import type { TimerApi } from "../draftStore";
import { artboard1, choice, wire } from "./fixtures";

// ---- a manual clock and a fetch whose answers the test gives --------------------------------------
class Clock implements TimerApi {
  now = 0;
  private seq = 0;
  private queue: { id: number; at: number; fn: () => void }[] = [];
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.queue.push({ id, at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.queue = this.queue.filter((t) => t.id !== h);
  };
  get pending(): number {
    return this.queue.length;
  }
  /** Move time on, firing every timer that falls due (in order), letting promises settle between. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.now = next.at;
      next.fn();
      await settle();
    }
    this.now = end;
  }
}

type Call = { url: string; method: string; body: Record<string, unknown> | null; reply: (status: number, body: unknown) => Promise<void>; fail: () => Promise<void> };

function fakeFetch() {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
        reply: async (status, body) => {
          resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
          await settle();
        },
        fail: async () => {
          reject(new TypeError("Failed to fetch"));
          await settle();
        },
      });
    });
  return { calls, fetch };
}

/** Let pending promise callbacks run (a few rounds: fetch → json() → dispatch → next write). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

function setup(opts: { retryDelaysMs?: number[] } = {}) {
  const clock = new Clock();
  const net = fakeFetch();
  const store = new DraftStore({ fetch: net.fetch, timers: clock, retryDelaysMs: opts.retryDelaysMs ?? [2000, 5000, 15000] });
  const ctx = wire(artboard1());
  store.load(ctx);
  return { clock, net, store, ctx };
}

const addField = (label: string) => (cfg: RouteFieldsConfig) => {
  cfg.steps.s_pcelec00.groups[0].fields.push(choice(label, ["pass", "fail"]));
};
const ok = (rev: number) => ({ draft_rev: rev, draft_updated_at: "2026-10-14T10:00:00.000Z", issues: [] });
const fieldCount = (cfg: unknown) => (cfg as RouteFieldsConfig).steps.s_pcelec00.groups[0].fields.length;

// ---- autosave -------------------------------------------------------------------------------------
test("an edit saves ~800 ms after the last one: one PUT with the working copy and base_rev", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(500);
  store.edit(101, addField("ב"));
  await clock.advance(799);
  assert.equal(net.calls.length, 0, "the timer restarts on every edit");
  await clock.advance(1);
  assert.equal(net.calls.length, 1);
  const [put] = net.calls;
  assert.equal(put.method, "PUT");
  assert.equal(put.url, "/api/settings/testing-routes/101/fields/draft");
  assert.equal(put.body?.base_rev, 4);
  assert.equal(fieldCount(put.body?.config), 7);
  assert.equal(store.getSnapshot().summary.saving, true);
  await put.reply(200, ok(5));
  const e = store.getSnapshot().model.routes[101];
  assert.equal(e.rev, 5);
  assert.equal(e.dirty, false);
  assert.equal(e.savedAt, "2026-10-14T10:00:00.000Z");
  assert.equal(store.getSnapshot().summary.lastSavedAt, "2026-10-14T10:00:00.000Z");
});

test("an edit during a PUT is saved after it, on the new rev — never two PUTs at once", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  assert.equal(net.calls.length, 1);
  store.edit(101, addField("ב"));
  await clock.advance(800);
  assert.equal(net.calls.length, 1, "the second save waits for the first");
  await net.calls[0].reply(200, ok(5));
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[1].body?.base_rev, 5);
  assert.equal(fieldCount(net.calls[1].body?.config), 7, "both edits");
  await net.calls[1].reply(200, ok(6));
  assert.equal(store.getSnapshot().model.routes[101].dirty, false);
  assert.equal(net.calls.length, 2);
});

test("an edit that lands while a PUT is in flight and before its debounce ends waits for the debounce", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  store.edit(101, addField("ב"));
  await net.calls[0].reply(200, ok(5));
  assert.equal(net.calls.length, 1, "its own timer is still running");
  await clock.advance(800);
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[1].body?.base_rev, 5);
});

test("routes save independently, each with its own base_rev", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  await clock.advance(800);
  assert.deepEqual(net.calls.map((c) => [c.url, c.body?.base_rev]), [
    ["/api/settings/testing-routes/101/fields/draft", 4],
    ["/api/settings/testing-routes/102/fields/draft", 0],
  ]);
});

test("undoing an edit before the timer fires saves nothing", async () => {
  const { clock, net, store, ctx } = setup();
  store.edit(101, addField("א"));
  store.edit(101, () => JSON.parse(JSON.stringify(ctx.lines[0].route!.draft)) as RouteFieldsConfig);
  await clock.advance(2000);
  assert.equal(net.calls.length, 0);
});

// ---- conflicts and failures -------------------------------------------------------------------------
test("409 DRAFT_CONFLICT: conflict state, no more PUTs; reloadRoute takes the server's route", async () => {
  const { clock, net, store, ctx } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].reply(409, { code: "DRAFT_CONFLICT", error: "x", draft: null, draft_rev: 9, draft_updated_at: null, draft_updated_by: "other" });
  const s = store.getSnapshot();
  assert.equal(s.model.routes[101].conflict?.rev, 9);
  assert.deepEqual(s.summary.conflictRoutes, [101]);
  store.edit(101, addField("ב"));
  await clock.advance(5000);
  assert.equal(net.calls.length, 1, "nothing is written over someone else's draft");

  const reloading = store.reloadRoute(101);
  await settle();
  const get = net.calls[1];
  assert.equal(get.method, "GET");
  assert.equal(get.url, "/api/settings/testing-routes/101/fields");
  await get.reply(200, { ...ctx.lines[0].route!, draft: null, draft_rev: 9, draft_updated_at: null, draft_updated_by: null });
  assert.equal(await reloading, true);
  const e = store.getSnapshot().model.routes[101];
  assert.equal(e.conflict, null);
  assert.equal(e.rev, 9);
  assert.equal(e.dirty, false);
  assert.deepEqual(e.current, ctx.lines[0].route!.published);
});

test("reloadRoute waits for the write in flight and starts no other write until the read is back", async () => {
  const { clock, net, store, ctx } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  store.edit(101, addField("ב"));
  const reloading = store.reloadRoute(101);
  await net.calls[0].reply(200, ok(5));
  await clock.advance(5000);
  assert.deepEqual(net.calls.map((c) => c.method), ["PUT", "GET"], "the pending edit is not saved while the route reloads");
  await net.calls[1].reply(200, { ...ctx.lines[0].route!, draft_rev: 5 });
  assert.equal(await reloading, true);
  assert.equal(store.getSnapshot().model.routes[101].dirty, false);
  await clock.advance(5000);
  assert.equal(net.calls.length, 2);
});

test("a reload that fails leaves the route as it was, and its edits save again", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  const reloading = store.reloadRoute(101);
  await settle();
  await net.calls[0].reply(500, { error: "x" });
  assert.equal(await reloading, false);
  assert.equal(store.getSnapshot().model.routes[101].dirty, true);
  await clock.advance(800);
  assert.deepEqual(net.calls.map((c) => c.method), ["GET", "PUT"]);
});

test("a 409 whose draft is exactly what was sent is a write that already happened", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  const sent = net.calls[0].body?.config;
  await net.calls[0].reply(409, { code: "DRAFT_CONFLICT", draft: sent, draft_rev: 5, draft_updated_at: "t", draft_updated_by: "admin" });
  const e = store.getSnapshot().model.routes[101];
  assert.equal(e.conflict, null);
  assert.equal(e.rev, 5);
  assert.equal(e.dirty, false);
});

test("a network failure: the error state, then automatic retries", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].fail();
  assert.deepEqual(store.getSnapshot().model.routes[101].error, { kind: "network", op: "put" });
  assert.deepEqual(store.getSnapshot().summary.failedRoutes, [101]);
  await clock.advance(1999);
  assert.equal(net.calls.length, 1);
  await clock.advance(1);
  assert.equal(net.calls.length, 2, "retried after 2 s");
  assert.equal(net.calls[1].body?.base_rev, 4);
  await net.calls[1].reply(503, { error: "down" });
  assert.deepEqual(store.getSnapshot().model.routes[101].error, { kind: "server", op: "put", status: 503 });
  await clock.advance(5000);
  assert.equal(net.calls.length, 3, "then after 5 s");
  await net.calls[2].reply(200, ok(5));
  assert.equal(store.getSnapshot().model.routes[101].error, null);
  assert.deepEqual(store.getSnapshot().summary.failedRoutes, []);
});

test("the automatic retries stop; retry() and the next edit try again", async () => {
  const { clock, net, store } = setup({ retryDelaysMs: [100] });
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].fail();
  await clock.advance(100);
  await net.calls[1].fail();
  await clock.advance(60_000);
  assert.equal(net.calls.length, 2, "one automatic retry only");
  store.retry();
  assert.equal(net.calls.length, 3);
  await net.calls[2].fail();
  store.edit(101, addField("ב"));
  await clock.advance(800);
  assert.equal(net.calls.length, 4);
});

test("a refusal (400 SHAPE_INVALID) is not retried by itself", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].reply(400, { code: "SHAPE_INVALID", error: "x" });
  assert.deepEqual(store.getSnapshot().model.routes[101].error, { kind: "rejected", op: "put", status: 400, code: "SHAPE_INVALID" });
  await clock.advance(60_000);
  assert.equal(net.calls.length, 1, "no retry, no reload");
});

test("409 STEP_UNKNOWN (D7): the error state, then the route is read back and nothing is PUT again", async () => {
  const { clock, net, store, ctx } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].reply(409, { code: "STEP_UNKNOWN", error: "x", route_id: 101, uids: ["s_x"] });
  assert.deepEqual(store.getSnapshot().model.routes[101].error, { kind: "rejected", op: "put", status: 409, code: "STEP_UNKNOWN" });
  assert.deepEqual(store.getSnapshot().summary.failedRoutes, [101]);
  const get = net.calls[1];
  assert.equal(get?.method, "GET");
  assert.equal(get.url, "/api/settings/testing-routes/101/fields");
  // Someone removed the visual-check step meanwhile: the route answers its new steps and draft.
  const server = ctx.lines[0].route!;
  const steps = { ...server.route, route_steps: server.route.route_steps.filter((_, i) => i !== 2), step_uids: server.route.step_uids.filter((_, i) => i !== 2) };
  await get.reply(200, { ...server, route: steps, draft_rev: 6 });
  const e = store.getSnapshot().model.routes[101];
  assert.equal(e.error, null);
  assert.equal(e.rev, 6);
  assert.equal(e.dirty, false);
  assert.deepEqual(e.route.step_uids, steps.step_uids);
  await clock.advance(60_000);
  assert.equal(net.calls.length, 2, "no PUT after the reload");
});

test("409 STEP_UNKNOWN whose read-back fails keeps the error, and does not PUT the refused config again", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  await clock.advance(800);
  await net.calls[0].reply(409, { code: "STEP_UNKNOWN", error: "x", route_id: 101, uids: ["s_x"] });
  await net.calls[1].reply(500, { error: "x" });
  const e = store.getSnapshot().model.routes[101];
  assert.deepEqual(e.error, { kind: "rejected", op: "put", status: 409, code: "STEP_UNKNOWN" });
  assert.equal(e.dirty, true);
  await clock.advance(60_000);
  assert.deepEqual(net.calls.map((c) => c.method), ["PUT", "GET"], "no PUT / GET loop");
});

// ---- flush and discard ----------------------------------------------------------------------------
test("flushAll saves pending edits now and resolves when every route is saved", async () => {
  const { net, store } = setup();
  store.edit(101, addField("א"));
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  let done: unknown = null;
  const flushing = store.flushAll().then((r) => {
    done = r;
  });
  await settle();
  assert.equal(net.calls.length, 2, "no debounce");
  await net.calls[0].reply(200, ok(5));
  assert.equal(done, null, "still waiting for route 102");
  await net.calls[1].reply(200, ok(1));
  await flushing;
  assert.deepEqual(done, { ok: true });
});

test("flushAll waits for an edit made while it waits, and reports a route it could not save", async () => {
  const { net, store } = setup();
  store.edit(101, addField("א"));
  const flushing = store.flushAll();
  await settle();
  store.edit(101, addField("ב"));
  await net.calls[0].reply(200, ok(5));
  assert.equal(net.calls.length, 2, "the edit made during the flush is saved at once");
  await net.calls[1].reply(500, { error: "x" });
  assert.deepEqual(await flushing, { ok: false, failed: [101], conflicts: [] });
});

test("flushAll with nothing to save resolves at once", async () => {
  const { store } = setup();
  assert.deepEqual(await store.flushAll(), { ok: true });
});

test("discardAll: DELETE for every route with a server draft, a local reset for the rest", async () => {
  const { clock, net, store, ctx } = setup();
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  const discarding = store.discardAll();
  await settle();
  await clock.advance(5000);
  assert.deepEqual(net.calls.map((c) => [c.method, c.url, c.body]), [
    ["DELETE", "/api/settings/testing-routes/101/fields/draft", { base_rev: 4 }],
  ], "route 102's edit was never saved: nothing to delete");
  await net.calls[0].reply(200, { draft_rev: 5 });
  assert.deepEqual(await discarding, { ok: true });
  const s = store.getSnapshot();
  assert.deepEqual(s.model.routes[101].current, ctx.lines[0].route!.published);
  assert.equal(s.model.routes[101].rev, 5);
  assert.equal(s.model.routes[102].dirty, false);
  assert.equal(s.summary.hasDraft, false);
  assert.equal(s.summary.changeCount, 0);
});

test("discardAll waits for a PUT in flight, then deletes the draft it created", async () => {
  const { clock, net, store } = setup();
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  await clock.advance(800);
  const discarding = store.discardAll();
  await settle();
  const deletesBefore = net.calls.filter((c) => c.method === "DELETE").length;
  assert.equal(deletesBefore, 0, "no DELETE while the PUT is in flight");
  await net.calls[0].reply(200, ok(1));
  const del = net.calls.find((c) => c.method === "DELETE" && c.url.includes("/102/"));
  assert.deepEqual(del?.body, { base_rev: 1 });
  for (const c of net.calls.filter((x) => x.method === "DELETE")) await c.reply(200, { draft_rev: (c.body?.base_rev as number) + 1 });
  assert.deepEqual(await discarding, { ok: true });
  assert.equal(store.getSnapshot().model.routes[102].serverDraft, null);
});

test("an edit made while discardAll runs is saved once the discard is over", async () => {
  const { clock, net, store } = setup();
  const discarding = store.discardAll();
  await settle();
  assert.deepEqual(net.calls.map((c) => c.method), ["DELETE"], "route 101's draft; route 102 has none (reset locally)");
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  await clock.advance(800);
  assert.equal(net.calls.length, 1, "nothing autosaves during the discard");
  await net.calls[0].reply(200, { draft_rev: 5 });
  assert.deepEqual(await discarding, { ok: true });
  await clock.advance(800);
  const put = net.calls[1];
  assert.equal(put?.method, "PUT");
  assert.equal(put.url, "/api/settings/testing-routes/102/fields/draft");
  await put.reply(200, ok(1));
  assert.equal(store.getSnapshot().model.routes[102].dirty, false);
});

test("flushAll called while discardAll runs resolves once the discard is over", async () => {
  const { net, store } = setup();
  const discarding = store.discardAll();
  await settle();
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  let flushed: unknown = null;
  const flushing = store.flushAll().then((r) => {
    flushed = r;
  });
  await settle();
  assert.equal(flushed, null);
  await net.calls[0].reply(200, { draft_rev: 5 });
  await discarding;
  await settle();
  const put = net.calls.find((c) => c.method === "PUT");
  assert.ok(put, "the edit is flushed at once");
  await put.reply(200, ok(1));
  await flushing;
  assert.deepEqual(flushed, { ok: true });
});

test("retry() after a failed DELETE deletes again (it does not save the draft back)", async () => {
  const { clock, net, store, ctx } = setup();
  const discarding = store.discardAll();
  await settle();
  await net.calls[0].fail();
  const r = await discarding;
  assert.deepEqual(r, { ok: false, failed: [101], conflicts: [] });
  assert.deepEqual(store.getSnapshot().summary.failedRoutes, [101]);
  await clock.advance(60_000);
  assert.equal(net.calls.length, 1, "a failed DELETE is not retried by itself");
  store.retry();
  assert.deepEqual(net.calls.map((c) => [c.method, c.body]), [["DELETE", { base_rev: 4 }], ["DELETE", { base_rev: 4 }]]);
  await net.calls[1].reply(200, { draft_rev: 5 });
  const e = store.getSnapshot().model.routes[101];
  assert.equal(e.error, null);
  assert.equal(e.serverDraft, null);
  assert.deepEqual(e.current, ctx.lines[0].route!.published);
});

test("flushPending starts every waiting save at once (leaving the page)", async () => {
  const { clock, net, store } = setup();
  store.edit(101, addField("א"));
  store.flushPending();
  await settle();
  assert.equal(net.calls.length, 1);
  assert.equal(clock.pending, 0);
  store.flushPending();
  assert.equal(net.calls.length, 1, "idempotent");
});

test("load() merges: the same answer twice is one load; a shared route keeps its pending edit", async () => {
  const { net, store, ctx } = setup();
  const before = store.getSnapshot();
  store.load(ctx);
  assert.equal(store.getSnapshot(), before);
  store.edit(102, (cfg) => {
    delete cfg.steps.s_moelec00;
  });
  const edited = store.getSnapshot().model.routes[102].current;
  store.load(wire(artboard1()));
  assert.equal(store.getSnapshot().model.routes[102].current, edited);
  assert.equal(net.calls.length, 0);
});

test("subscribe: listeners hear every change and can leave", () => {
  const { store } = setup();
  let n = 0;
  const off = store.subscribe(() => {
    n += 1;
  });
  store.edit(101, addField("א"));
  assert.equal(n, 1);
  off();
  store.edit(101, addField("ב"));
  assert.equal(n, 1);
});

// ---- answers ----------------------------------------------------------------------------------------
test("writeOutcome reads the draft endpoints' answers", () => {
  assert.deepEqual(writeOutcome("put", 200, ok(3)), { type: "saved", result: ok(3) });
  assert.deepEqual(writeOutcome("delete", 200, { draft_rev: 4 }), { type: "discarded", rev: 4 });
  assert.deepEqual(writeOutcome("put", 200, { draft_rev: "3" }), { type: "failed", error: { kind: "server", op: "put", status: 200 } });
  assert.deepEqual(writeOutcome("put", 409, { code: "DRAFT_CONFLICT", draft: null, draft_rev: 7 }),
    { type: "conflict", conflict: { draft: null, rev: 7, updatedAt: null, updatedBy: null } });
  assert.deepEqual(writeOutcome("put", 409, { code: "DRAFT_CONFLICT", draft: { schema: 2 }, draft_rev: 7 }),
    { type: "failed", error: { kind: "rejected", op: "put", status: 409, code: "DRAFT_CONFLICT" } }, "a conflict body that does not parse");
  assert.deepEqual(writeOutcome("put", 400, { code: "SHAPE_INVALID" }), { type: "failed", error: { kind: "rejected", op: "put", status: 400, code: "SHAPE_INVALID" } });
  assert.deepEqual(writeOutcome("delete", 502, null), { type: "failed", error: { kind: "server", op: "delete", status: 502 } });
});

// ---- React -----------------------------------------------------------------------------------------
test("the provider loads its context on the first render; the hooks read the store", () => {
  const ctx = wire(artboard1());
  const seen: { changes: number; pcRev: number | null; columns: number }[] = [];
  function Probe() {
    seen.push({
      changes: useDraftSummary().changeCount,
      pcRev: useRouteDraft(101)?.rev ?? null,
      columns: useFieldsMap(ctx)?.columns.length ?? 0,
    });
    return null;
  }
  renderToStaticMarkup(createElement(DraftStoreProvider, { context: ctx }, createElement(Probe)));
  assert.deepEqual(seen, [{ changes: 1, pcRev: 4, columns: 5 }]);
});

test("useDraftStore outside the provider is a programming error", () => {
  function Probe() {
    useRouteDraft(1);
    return null;
  }
  assert.throws(() => renderToStaticMarkup(createElement(Probe)), /DraftStoreProvider/);
});
