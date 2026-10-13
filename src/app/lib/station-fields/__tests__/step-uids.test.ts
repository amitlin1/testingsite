import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StepUidError,
  assignStepUids,
  inferUidsByOccurrence,
  newChecklistItemId,
  newFieldId,
  newOptionId,
  newStepUid,
  pruneDraft,
  renameStationTypeInConfig,
} from "../step-uids";
import type { RandomSource, StationTypeInfo } from "../step-uids";
import { ID_PATTERNS } from "../schema";
import type { RouteFieldsConfig, StepConfig } from "../schema";

// Station types as the demo seed names them: 21 פתיחת מארז, 22 חשמל, 23 מכניקה, 24 בדיקה ויזואלית, 26 סגירת מארז.
const TYPES = new Map<number, StationTypeInfo>([
  [21, { label: "פתיחת מארז", package_level: true }],
  [22, { label: "חשמל", package_level: false }],
  [23, { label: "מכניקה", package_level: false }],
  [24, { label: "בדיקה ויזואלית", package_level: false }],
  [26, { label: "סגירת מארז", package_level: true }],
]);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** A random source that spells the given suffixes, one per call (the last one repeats). */
function spelling(...suffixes: string[]): RandomSource & { calls: () => number } {
  let n = 0;
  const source = (bytes: Uint8Array<ArrayBuffer>) => {
    const word = suffixes[Math.min(n, suffixes.length - 1)];
    n += 1;
    bytes.fill(255);   // rejected bytes: only the spelled ones count
    [...word].forEach((ch, i) => { bytes[i] = ALPHABET.indexOf(ch); });
    return bytes;
  };
  return Object.assign(source, { calls: () => n });
}

// ---- ids ---------------------------------------------------------------------------------
test("new ids: prefix + 8 chars of [a-z0-9], from crypto.getRandomValues", () => {
  assert.match(newStepUid(new Set()), ID_PATTERNS.step);
  assert.match(newFieldId(), ID_PATTERNS.field);
  assert.match(newOptionId(), ID_PATTERNS.option);
  assert.match(newChecklistItemId(), ID_PATTERNS.checklistItem);
  const many = new Set(Array.from({ length: 500 }, () => newFieldId()));
  assert.equal(many.size, 500);
});

test("new ids: bytes 252..255 are skipped, so every character is equally likely", () => {
  const source: RandomSource = (bytes) => {
    bytes.set([252, 253, 254, 255, 0, 35, 36, 71, 251, 1, 2, 3, 4, 5]);
    return bytes;
  };
  // 252..255 skipped; then byte % 36: 0 → a, 35 → 9, 36 → a, 71 → 9, 251 → 9, 1 → b, 2 → c, 3 → d.
  assert.equal(newFieldId(source), "f_a9a99bcd");
  assert.throws(() => newOptionId((bytes) => bytes.fill(255)), /no usable bytes/);
});

test("newStepUid never returns a taken uid", () => {
  const source = spelling("aaaaaaaa", "bbbbbbbb", "cccccccc");
  assert.equal(newStepUid(new Set(["s_aaaaaaaa", "s_bbbbbbbb"]), source), "s_cccccccc");
  assert.equal(source.calls(), 3);
  assert.throws(() => newStepUid(new Set(["s_zzzzzzzz"]), spelling("zzzzzzzz")), /free step uid/);
});

// ---- assignStepUids ------------------------------------------------------------------------
const A = "s_aaaaaaaa", B = "s_bbbbbbbb", C = "s_cccccccc", D = "s_dddddddd", E = "s_eeeeeeee";

test("assignStepUids: a move keeps every uid with its step", () => {
  assert.deepEqual(assignStepUids([A, B, C], [C, A, B], new Set()), [C, A, B]);
});

test("assignStepUids: a removal drops the uid; a new step gets a fresh one", () => {
  assert.deepEqual(assignStepUids([A, B, C], [A, C], new Set()), [A, C]);
  const out = assignStepUids([A, B, C], [A, null, C, null], new Set([A, B, C]));
  assert.equal(out.length, 4);
  assert.deepEqual([out[0], out[2]], [A, C]);
  for (const fresh of [out[1], out[3]]) {
    assert.match(fresh, ID_PATTERNS.step);
    assert.equal([A, B, C].includes(fresh), false);
  }
  assert.notEqual(out[1], out[3]);
});

test("assignStepUids: an unknown or a repeated uid is refused", () => {
  assert.throws(() => assignStepUids([A, B], [A, D], new Set()), (e: unknown) => {
    assert.ok(e instanceof StepUidError);
    assert.deepEqual([e.code, e.uid], ["STEP_UID_UNKNOWN", D]);
    return true;
  });
  // A uid of a published version that is no longer on the route cannot be re-attached either.
  assert.throws(() => assignStepUids([A], [A, B], new Set([A, B])), { code: "STEP_UID_UNKNOWN" });
  assert.throws(() => assignStepUids([A, B], [A, B, A], new Set()), (e: unknown) => {
    assert.ok(e instanceof StepUidError);
    assert.deepEqual([e.code, e.uid], ["STEP_UID_DUPLICATE", A]);
    return true;
  });
});

test("assignStepUids: a removed uid is never minted again", () => {
  // Version 1 was published with A, B, C; then B was removed from the route.
  const published = new Set([A, B, C]);
  const afterRemove = assignStepUids([A, B, C], [A, C], published);
  assert.deepEqual(afterRemove, [A, C]);
  // Adding a step later: the random source first spells B (published), then A (current), then D.
  const source = spelling("bbbbbbbb", "aaaaaaaa", "dddddddd");
  assert.deepEqual(assignStepUids(afterRemove, [A, null, C], published, source), [A, D, C]);
  // Two new steps in one save never share a uid, even when the source repeats itself.
  assert.deepEqual(assignStepUids([A], [null, A, null], new Set(), spelling("dddddddd", "dddddddd", "eeeeeeee")), [D, A, E]);
});

// ---- inferUidsByOccurrence -------------------------------------------------------------------
test("inferUidsByOccurrence: a repeated PUT keeps every uid, with a station type that appears twice", () => {
  const cur = [21, 22, 23, 22, 26];
  const uids = [A, B, C, D, E];
  assert.deepEqual(inferUidsByOccurrence(cur, uids, cur), uids);
  // The 2nd חשמל keeps the 2nd חשמל's uid, the 3rd is new.
  assert.deepEqual(inferUidsByOccurrence(cur, uids, [21, 22, 22, 22, 26]), [A, B, D, null, E]);
  // Dropping the 2nd occurrence: the 1st keeps its uid, the other's leaves the route.
  assert.deepEqual(inferUidsByOccurrence(cur, uids, [21, 22, 26]), [A, B, E]);
  // Reordering by type: occurrences of the same type keep their order.
  assert.deepEqual(inferUidsByOccurrence(cur, uids, [21, 23, 22, 22, 26]), [A, C, B, D, E]);
  // A type the route never had is new.
  assert.deepEqual(inferUidsByOccurrence(cur, uids, [21, 24, 26]), [A, null, E]);
  // And the result goes through assignStepUids like any client's step_uids.
  const assigned = assignStepUids(uids, inferUidsByOccurrence(cur, uids, [21, 22, 22, 22, 26]), new Set(uids), spelling("ffffffff"));
  assert.deepEqual(assigned, [A, B, D, "s_ffffffff", E]);
});

test("inferUidsByOccurrence: no usable pairing → all new", () => {
  assert.deepEqual(inferUidsByOccurrence([21, 22], [A], [21, 22]), [null, null]);
  assert.deepEqual(inferUidsByOccurrence([], [], [21, 22]), [null, null]);
  assert.deepEqual(inferUidsByOccurrence([21, 22], ["", B], [21, 22]), [null, B]);
});

// ---- pruneDraft --------------------------------------------------------------------------------
function step(uid: string, typeId: number, label: string, scope: "package" | "item"): StepConfig {
  return {
    uid, station_type_id: typeId, station_label: label, scope,
    groups: [{ target: scope === "item" ? "item" : "box", fields: [{ id: "f_led00001", type: "section", label: "הפעלה" }] }],
  };
}
const draft = (): RouteFieldsConfig => ({
  schema: 1,
  steps: {
    [A]: step(A, 21, "פתיחת מארז", "package"),
    [B]: step(B, 22, "חשמל", "item"),
    [C]: step(C, 22, "חשמל", "item"),
    [E]: step(E, 26, "סגירת מארז", "package"),
  },
});

test("pruneDraft: a removed step's config is dropped; the rest is untouched", () => {
  const before = draft();
  const snapshot = JSON.stringify(before);
  const out = pruneDraft(before, [A, C, E], [21, 22, 26], TYPES);
  assert.deepEqual(out.removed, [B]);
  assert.equal(out.changed, true);
  assert.deepEqual(out.scopeChanged, []);
  assert.deepEqual(Object.keys(out.config!.steps), [A, C, E]);
  assert.deepEqual(out.config!.steps[C], before.steps[C]);
  assert.equal(JSON.stringify(before), snapshot);   // the input is never mutated
});

test("pruneDraft: nothing to do → the same object, changed false; no draft → null", () => {
  const same = draft();
  const out = pruneDraft(same, [A, B, C, E], [21, 22, 22, 26], TYPES);
  assert.deepEqual(out, { config: same, removed: [], changed: false, scopeChanged: [] });
  assert.equal(out.config, same);
  assert.deepEqual(pruneDraft(null, [A], [21], TYPES), { config: null, removed: [], changed: false, scopeChanged: [] });
});

test("pruneDraft: station type and label follow the uid's new position", () => {
  // The 2nd חשמל step was swapped for מכניקה in place — impossible from the screen (a type change is a
  // remove + add), but a renamed station type id lands exactly here.
  const padded = new Map(TYPES).set(23, { label: "מכניקה" + " ".repeat(44), package_level: false });
  const out = pruneDraft(draft(), [A, B, C, E], [21, 22, 23, 26], padded);
  assert.equal(out.changed, true);
  assert.deepEqual(out.removed, []);
  assert.deepEqual([out.config!.steps[C].station_type_id, out.config!.steps[C].station_label], [23, "מכניקה"]);
  assert.deepEqual(out.config!.steps[B], draft().steps[B]);
  // A type missing from the map keeps the old label.
  const unknownType = pruneDraft(draft(), [A, B, C, E], [21, 22, 99, 26], TYPES);
  assert.deepEqual([unknownType.config!.steps[C].station_type_id, unknownType.config!.steps[C].station_label], [99, "חשמל"]);
});

test("pruneDraft: a scope change is reported and the step is KEPT with its old scope", () => {
  const types = new Map(TYPES).set(22, { label: "חשמל", package_level: true });
  const out = pruneDraft(draft(), [A, B, C, E], [21, 22, 22, 26], types);
  assert.deepEqual(out.scopeChanged, [B, C]);
  assert.equal(out.changed, false);
  assert.equal(out.config!.steps[B].scope, "item");
  assert.deepEqual(Object.keys(out.config!.steps), [A, B, C, E]);
});

// ---- renameStationTypeInConfig ---------------------------------------------------------------
test("renameStationTypeInConfig: every step of the old type, nothing else; null when unchanged", () => {
  const before = draft();
  const snapshot = JSON.stringify(before);
  const out = renameStationTypeInConfig(before, 22, 40);
  assert.ok(out);
  assert.deepEqual(Object.values(out.steps).map((s) => s.station_type_id), [21, 40, 40, 26]);
  assert.deepEqual(out.steps[B].groups, before.steps[B].groups);
  assert.equal(out.steps[A], before.steps[A]);   // untouched steps are not even copied
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(renameStationTypeInConfig(before, 23, 40), null);
  assert.equal(renameStationTypeInConfig(before, 22, 22), null);
  assert.equal(renameStationTypeInConfig(null, 22, 40), null);
  assert.equal(renameStationTypeInConfig({ schema: 1, steps: [] }, 22, 40), null);
  assert.equal(renameStationTypeInConfig("garbage", 22, 40), null);
  // Raw JSON with a hostile key stays a plain object.
  const raw = JSON.parse(`{"schema":1,"steps":{"__proto__":{"station_type_id":22},"${A}":{"station_type_id":22}}}`);
  const renamed = renameStationTypeInConfig(raw, 22, 40) as unknown as { steps: Record<string, { station_type_id: number }> };
  assert.equal(Object.getPrototypeOf(renamed.steps), Object.prototype);
  assert.equal(renamed.steps[A].station_type_id, 40);
  assert.equal(({} as Record<string, unknown>).station_type_id, undefined);
});
