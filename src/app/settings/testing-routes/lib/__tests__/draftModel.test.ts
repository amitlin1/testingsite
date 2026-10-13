import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import type { DraftAction, DraftModel } from "../draftModel";
import {
  EMPTY_DRAFT_MODEL, contextRouteIds, copyConfig, currentConfigs, draftReducer, emptyConfig, entryHasDraft, jsonEqual, mergeRoute,
  routeChanges, routeIssues, setGroupFields, summarize,
} from "../draftModel";
import { groupFieldsOf } from "../mapModel";
import { ELEC, MON, OPEN, PC, artboard1, artboard11, choice, config, fields, step } from "./fixtures";

const run = (state: DraftModel, ...actions: DraftAction[]): DraftModel => actions.reduce(draftReducer, state);
const load = (ctx: FieldsContextJson): DraftModel => draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
/** Add one field to the computer's electrical cell (route 101). */
const addField = (label: string): DraftAction => ({
  type: "edit",
  routeId: 101,
  mutate: (cfg) => {
    cfg.steps.s_pcelec00.groups[0].fields.push(choice(label, ["pass", "fail"]));
  },
});
const saved = (rev: number): DraftAction => ({ type: "saveDone", routeId: 101, result: { draft_rev: rev, draft_updated_at: "2026-10-14T09:00:00.000Z", issues: [] } });

test("load: one entry per route of the context, in map order; current = draft ?? published ?? empty", () => {
  const ctx = artboard1();
  const m = load(ctx);
  assert.deepEqual(m.order, [100, 101, 102, 103, 104]);
  assert.deepEqual(contextRouteIds(ctx), [100, 101, 102, 103, 104]);
  assert.deepEqual(m.packageLevel, [11, 15]);
  const pc = m.routes[101];
  assert.deepEqual(pc.current, ctx.lines[0].route!.draft);
  assert.notEqual(pc.current, ctx.lines[0].route!.draft, "a copy, never the server's object");
  assert.equal(pc.rev, 4);
  assert.equal(pc.dirty, false);
  assert.equal(pc.savedAt, "2026-10-14T08:00:00.000Z");
  assert.deepEqual(m.routes[102].current, ctx.lines[1].route!.published);
  assert.equal(m.routes[102].serverDraft, null);
  const fresh = load(artboard11()).routes[200];
  assert.deepEqual(fresh.current, emptyConfig());
  assert.equal(fresh.published, null);
});

test("edit: mutate gets a deep copy; dirty against what the server holds; undoing clears it", () => {
  const m0 = load(artboard1());
  const before = m0.routes[101].current;
  let seen: RouteFieldsConfig | null = null;
  const m1 = draftReducer(m0, { type: "edit", routeId: 101, mutate: (cfg) => { seen = cfg; cfg.steps.s_pcelec00.groups[0].fields.pop(); } });
  assert.notEqual(seen, before);
  assert.equal(before.steps.s_pcelec00.groups[0].fields.length, 5, "the previous state is untouched");
  assert.equal(m1.routes[101].current.steps.s_pcelec00.groups[0].fields.length, 4);
  assert.equal(m1.routes[101].dirty, true);
  assert.notEqual(m1.routes[102], undefined);
  assert.equal(m1.routes[102], m0.routes[102], "other entries keep their identity");
  // Back to the server's draft → nothing to save.
  const m2 = draftReducer(m1, { type: "edit", routeId: 101, mutate: () => copyConfig(m0.routes[101].current) });
  assert.equal(m2.routes[101].dirty, false);
  // A route without a draft: an edit undone is the published config again → no draft.
  const m3 = run(m0,
    { type: "edit", routeId: 102, mutate: (cfg) => { delete cfg.steps.s_moelec00; } },
    { type: "edit", routeId: 102, mutate: () => copyConfig(m0.routes[102].published!) });
  assert.equal(m3.routes[102].dirty, false);
  assert.equal(entryHasDraft(m3.routes[102]), false);
  // A route the model does not hold: nothing happens.
  assert.equal(draftReducer(m0, { type: "edit", routeId: 999, mutate: () => emptyConfig() }), m0);
});

test("save: the in-flight config becomes the server draft; an edit during the flight stays dirty", () => {
  const m0 = load(artboard1());
  const m1 = run(m0, addField("א"), { type: "saveStart", routeId: 101 });
  assert.equal(m1.routes[101].saving, true);
  const sent = m1.routes[101].inFlight!;
  assert.equal(draftReducer(m1, { type: "saveStart", routeId: 101 }), m1, "never two writes per route");
  const m2 = run(m1, addField("ב"));
  assert.equal(m2.routes[101].inFlight, sent, "the flight carries the config it started with");
  const m3 = draftReducer(m2, saved(5));
  const e = m3.routes[101];
  assert.equal(e.rev, 5);
  assert.equal(e.serverDraft, sent);
  assert.equal(e.saving, false);
  assert.equal(e.dirty, true, "the second edit is still to be saved");
  assert.equal(e.savedAt, "2026-10-14T09:00:00.000Z");
  const m4 = run(m3, { type: "saveStart", routeId: 101 }, saved(6));
  assert.equal(m4.routes[101].dirty, false);
  assert.equal(m4.routes[101].rev, 6);
});

test("409 DRAFT_CONFLICT: the conflict state, unless the server already holds what was sent", () => {
  const m1 = run(load(artboard1()), addField("א"), { type: "saveStart", routeId: 101 });
  const other = config(step("s_pcelec00", ELEC, "item", [{ target: "item", fields: fields(1, ["pass", "fail"]) }]));
  const m2 = draftReducer(m1, { type: "conflict", routeId: 101, op: "put", conflict: { draft: other, rev: 9, updatedAt: null, updatedBy: "other" } });
  assert.equal(m2.routes[101].saving, false);
  assert.deepEqual(m2.routes[101].conflict, { draft: other, rev: 9, updatedAt: null, updatedBy: "other" });
  assert.equal(m2.routes[101].dirty, true);
  // A lost answer: the server holds exactly what was sent (key order does not matter).
  const sent = m1.routes[101].inFlight!;
  const reorder = (v: unknown): unknown => (Array.isArray(v)
    ? v.map(reorder)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v);
  const reordered = reorder(sent) as RouteFieldsConfig;
  assert.notDeepEqual(Object.keys(reordered), Object.keys(sent));
  const m3 = draftReducer(m1, { type: "conflict", routeId: 101, op: "put", conflict: { draft: reordered, rev: 5, updatedAt: "t", updatedBy: "admin" } });
  assert.equal(m3.routes[101].conflict, null);
  assert.equal(m3.routes[101].rev, 5);
  assert.equal(m3.routes[101].dirty, false);
});

test("a failed write keeps the edits and records why", () => {
  const m = run(load(artboard1()), addField("א"), { type: "saveStart", routeId: 101 },
    { type: "fail", routeId: 101, error: { kind: "network", op: "put" } });
  assert.deepEqual(m.routes[101].error, { kind: "network", op: "put" });
  assert.equal(m.routes[101].dirty, true);
  assert.equal(m.routes[101].saving, false);
  assert.deepEqual(summarize(m).failedRoutes, [101]);
  // The next start clears the error.
  assert.equal(draftReducer(m, { type: "saveStart", routeId: 101 }).routes[101].error, null);
});

test("discard: back to the published version; locally when the server has no draft", () => {
  const m0 = run(load(artboard1()), addField("א"));
  const m1 = run(m0, { type: "discardStart", routeId: 101 }, { type: "discardDone", routeId: 101, rev: 5 });
  const e = m1.routes[101];
  assert.equal(e.serverDraft, null);
  assert.deepEqual(e.current, e.published);
  assert.equal(e.rev, 5);
  assert.equal(e.dirty, false);
  assert.equal(e.savedAt, null);
  const m2 = run(m0, { type: "edit", routeId: 102, mutate: (cfg) => { delete cfg.steps.s_moelec00; } }, { type: "discardLocal", routeId: 102 });
  assert.deepEqual(m2.routes[102].current, m2.routes[102].published);
  assert.equal(m2.routes[102].dirty, false);
  // A DELETE answered 409 with no draft on the server: already discarded.
  const m3 = run(m0, { type: "discardStart", routeId: 101 },
    { type: "conflict", routeId: 101, op: "delete", conflict: { draft: null, rev: 8, updatedAt: null, updatedBy: null } });
  assert.equal(m3.routes[101].conflict, null);
  assert.equal(m3.routes[101].rev, 8);
  assert.equal(m3.routes[101].serverDraft, null);
});

test("routeLoaded ('טען מחדש') replaces the entry, local edits and conflict included", () => {
  const ctx = artboard1();
  const m0 = run(load(ctx), addField("א"), { type: "saveStart", routeId: 101 },
    { type: "conflict", routeId: 101, op: "put", conflict: { draft: null, rev: 9, updatedAt: null, updatedBy: null } });
  const fresh = { ...ctx.lines[0].route!, draft_rev: 9, draft: null, draft_updated_at: null };
  const e = draftReducer(m0, { type: "routeLoaded", route: fresh }).routes[101];
  assert.equal(e.conflict, null);
  assert.equal(e.rev, 9);
  assert.equal(e.dirty, false);
  assert.deepEqual(e.current, fresh.published);
});

test("mergeRoute: a reload adopts the server for clean entries, keeps local work, and spots someone else's write", () => {
  const ctx = artboard1();
  const r = ctx.lines[0].route!;
  const base = load(ctx).routes[101];
  // Clean: the newer answer wins; an older one (read before our last PUT) is ignored.
  assert.equal(mergeRoute(base, { ...r, draft_rev: 6 }).rev, 6);
  const afterSave = { ...base, rev: 7 };
  assert.equal(mergeRoute(afterSave, { ...r, draft_rev: 6 }), afterSave);
  // Dirty, nothing in flight, the server moved on: a conflict, edits kept.
  const dirty = draftReducer(load(ctx), addField("א")).routes[101];
  const moved = mergeRoute(dirty, { ...r, draft_rev: 5, draft: null });
  assert.equal(moved.conflict?.rev, 5);
  assert.equal(moved.conflict?.draft, null);
  assert.equal(moved.current, dirty.current);
  // ... unless the server already holds exactly the working copy.
  const same = mergeRoute(dirty, { ...r, draft_rev: 5, draft: copyConfig(dirty.current) });
  assert.equal(same.conflict, null);
  assert.equal(same.dirty, false);
  assert.equal(same.rev, 5);
  // Same rev, new steps (or a publish meanwhile): the server-owned parts refresh.
  const steps = { ...r.route, route_steps: [OPEN, ELEC], step_uids: ["s_pcopen00", "s_pcelec00"] };
  const refreshed = mergeRoute(dirty, { ...r, route: steps });
  assert.deepEqual(refreshed.route, steps);
  assert.equal(refreshed.conflict, null);
  // In flight: the rev is the write's to settle.
  const flying = { ...dirty, saving: true };
  assert.equal(mergeRoute(flying, { ...r, draft_rev: 5 }).conflict, null);
});

test("load again: a route that left the context stays only while it has a save to make", () => {
  const m0 = run(load(artboard1()), addField("א"));
  const ctx11 = artboard11();
  const m1 = draftReducer(m0, { type: "load", context: ctx11 });
  assert.deepEqual(m1.order, [200, 102, 203, 204]);
  assert.ok(m1.routes[101], "the computer's unsaved edit is kept");
  assert.equal(m1.routes[100], undefined, "a clean route of the old context is dropped");
  assert.deepEqual(m1.routes[102].current, ctx11.lines[0].route!.published, "a clean shared route takes the newer answer");
  // A shared route with unsaved edits keeps its working copy when the other kit's map opens.
  const edited = draftReducer(m0, { type: "edit", routeId: 102, mutate: (cfg) => { delete cfg.steps.s_movisu00; } });
  const switched = draftReducer(edited, { type: "load", context: artboard11() });
  assert.equal(switched.routes[102].current, edited.routes[102].current);
  assert.equal(switched.routes[102].dirty, true);
  assert.equal(summarize(m1).changeCount, 0, "counts cover the context on screen only");
  assert.deepEqual(summarize(m1).failedRoutes, []);
  assert.equal(summarize(m1).unsaved, true);
  const m2 = run(m1, { type: "saveStart", routeId: 101 }, saved(5), { type: "evict", routeId: 101 });
  assert.equal(m2.routes[101], undefined);
  assert.ok(draftReducer(m1, { type: "evict", routeId: 101 }).routes[101], "never evicted with a save to make");
  assert.ok(draftReducer(m1, { type: "evict", routeId: 102 }).routes[102], "never evicted while in the context");
});

test("summarize: changes, issues, errors that block publish, drafts and the last save", () => {
  const ctx = artboard1();
  const s = summarize(load(ctx));
  // Route 101's draft adds one field; the other routes have no draft.
  assert.equal(s.changeCount, 1);
  assert.deepEqual(routeChanges(load(ctx), 101).map((c) => c.kind), ["field_added"]);
  assert.equal(s.changesByRoute[101].length, 1);
  assert.equal(s.hasDraft, true);
  assert.deepEqual(s.draftRouteIds, [101]);
  assert.equal(s.isNoopDraft, false);
  // The screen's empty option is an error on route 102 — which has no draft, so publish is not blocked by it.
  assert.equal(s.errorCount, 1);
  assert.equal(s.blockingErrorCount, 0);
  assert.equal(s.issuesByRoute[102].find((i) => i.level === "error")?.code, "OPTION_LABEL_EMPTY");
  assert.deepEqual(routeIssues(load(ctx), 102), s.issuesByRoute[102]);
  assert.equal(s.lastSavedAt, "2026-10-14T08:00:00.000Z");
  assert.equal(s.saving, false);
  assert.equal(s.unsaved, false);
  // Editing route 102 gives it a draft: now its error blocks publish.
  const m = draftReducer(load(ctx), { type: "edit", routeId: 102, mutate: (cfg) => { cfg.steps.s_moelec00.groups[0].fields.pop(); } });
  const s2 = summarize(m);
  assert.equal(s2.blockingErrorCount, 1);
  assert.deepEqual(s2.draftRouteIds, [101, 102]);
  assert.equal(s2.changeCount, 2);
  assert.equal(s2.unsaved, true);
});

test("summarize: a draft equal to the published version is a no-op draft", () => {
  const ctx = artboard1();
  const pc = ctx.lines[0].route!;
  pc.draft = copyConfig(pc.published!);
  const s = summarize(load(ctx));
  assert.equal(s.hasDraft, true);
  assert.equal(s.changeCount, 0);
  assert.equal(s.isNoopDraft, true);
});

test("summarize: route errors — a step uid the route lost, a step whose level changed", () => {
  const ctx = artboard1();
  const pc = ctx.lines[0].route!;
  pc.draft = config(
    step("s_gone0000", ELEC, "item", [{ target: "item", fields: fields(1, ["pass", "fail"]) }]),
    { ...step("s_pcelec00", ELEC, "package", [{ target: "box", fields: fields(1, ["pass", "fail"]) }]) },
  );
  const s = summarize(load(ctx));
  assert.deepEqual(s.issuesByRoute[101].map((i) => i.code).sort(), ["STEP_SCOPE_MISMATCH", "STEP_UNKNOWN"]);
  assert.equal(s.blockingErrorCount, 2);
});

test("derived values are cached per entry: an untouched route is not recomputed", () => {
  const m0 = load(artboard1());
  const a = summarize(m0).issuesByRoute[102];
  const m1 = draftReducer(m0, addField("א"));
  assert.equal(summarize(m1).issuesByRoute[102], a);
  assert.notEqual(summarize(m1).changesByRoute[101], summarize(m0).changesByRoute[101]);
});

test("setGroupFields: creates the step from the column, replaces a group in place, prunes what empties", () => {
  const meta = { station_type_id: ELEC, station_label: "חשמל", scope: "item" as const };
  const f = fields(2, ["pass", "fail"]);
  const cfg = setGroupFields(emptyConfig(), { step_uid: "s_new00000", target: "item" }, meta, f);
  assert.deepEqual(Object.keys(cfg.steps), ["s_new00000"]);
  assert.deepEqual(cfg.steps.s_new00000, { uid: "s_new00000", station_type_id: ELEC, station_label: "חשמל", scope: "item", groups: [{ target: "item", fields: f }] });
  assert.deepEqual(setGroupFields(cfg, { step_uid: "s_new00000", target: "item" }, meta, []), emptyConfig());

  const kitMeta = { station_type_id: OPEN, station_label: "פתיחת מארז", scope: "package" as const };
  const kit = artboard1().kit!.published!;
  const g = fields(1, ["pass", "fail"]);
  const next = setGroupFields(copyConfig(kit), { step_uid: "s_kitopen1", target: { item_type_id: MON } }, kitMeta, g);
  const order = next.steps.s_kitopen1.groups.map((x) => (typeof x.target === "string" ? x.target : x.target.item_type_id));
  assert.deepEqual(order, ["box", "each_item", PC, MON, 5], "the group keeps its place");
  assert.equal(groupFieldsOf(next, "s_kitopen1", { item_type_id: MON }), g);
  const added = setGroupFields(copyConfig(kit), { step_uid: "s_kitopen1", target: { item_type_id: 6 } }, kitMeta, g);
  assert.deepEqual(added.steps.s_kitopen1.groups.at(-1), { target: { item_type_id: 6 }, fields: g });
  // A step with a layout survives losing its last group.
  const withLayout = setGroupFields(emptyConfig(), { step_uid: "s_new00000", target: "item" }, meta, f);
  withLayout.steps.s_new00000.layout = { density: "compact" };
  assert.ok(setGroupFields(withLayout, { step_uid: "s_new00000", target: "item" }, meta, []).steps.s_new00000);
});

test("jsonEqual ignores key order and undefined members", () => {
  assert.equal(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(jsonEqual({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(jsonEqual([1, 2], [2, 1]), false);
  assert.equal(jsonEqual({ a: null }, {}), false);
});

test("currentConfigs: the working copy of every entry", () => {
  const m = draftReducer(load(artboard1()), addField("א"));
  const c = currentConfigs(m);
  assert.deepEqual(Object.keys(c).map(Number).sort(), [100, 101, 102, 103, 104]);
  assert.equal(c[101], m.routes[101].current);
});
