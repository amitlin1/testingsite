import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceOption, ChoiceRowField } from "@/app/lib/station-fields/schema";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import {
  BadBody, parseDraftConflict, parseDraftSaved, parseFieldSet, parseFieldSets, parseLibraryUses, parseOptionList,
  parseOptionListSaved, parseOptionLists, parsePropagated, parseRouteRow, parseRouteRows, parseVersion,
} from "../wire";

/** The answers the screen builds on are checked against the contract (admin-types.ts) first. */

const LED: ChoiceOption[] = [
  { id: "o_list0000", label: "תקין", tone: "pass" },
  { id: "o_list0001", label: "לא דולקת", tone: "fail" },
];

const choice = (id: string, label: string): ChoiceRowField => ({
  id, type: "choice_row", label, required: false, notes: "required_on_fail", options: LED.map((o) => ({ ...o })),
});

const listJson: OptionListJson = {
  id: 4, name: "מצב נורית", options: LED, version: 2, updated_at: "2026-10-12T08:00:00.000Z", updated_by: "admin",
  usage: { fields: 9, routes: 4 },
};

const setJson: FieldSetJson = {
  id: 11, name: "ערכה", fields: [choice("f_aaaaaaa1", "מצב חיצוני"), choice("f_aaaaaaa2", "ניקיון")],
  version: 3, created_at: "2026-10-01T08:00:00.000Z", updated_at: "2026-10-12T08:00:00.000Z", updated_by: "admin",
  usage: { cells: 9, outdated: 2 },
};

const use: LibraryUseJson = {
  route_id: 101, step_uid: "s_visual01", target: { item_type_id: 5 }, field_id: "f_aaaaaaa1", ver: 3, in: "draft",
  kit_desc: "מארז", station_label: "עמדה", item_label: "פריט",
};

const viaJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test("an option list and a field set are checked, their options / fields through the shape check", () => {
  assert.deepEqual(parseOptionList(viaJson(listJson)), listJson);
  assert.equal(parseOptionLists([listJson, listJson]).length, 2);
  assert.deepEqual(parseFieldSet(viaJson(setJson)), setJson);
  assert.deepEqual(parseFieldSets([]), []);
  assert.throws(() => parseOptionList({ ...listJson, id: 0 }), BadBody);
  assert.throws(() => parseOptionList({ ...listJson, usage: { fields: 1 } }), BadBody);
  assert.throws(() => parseOptionList({ ...listJson, options: [{ id: "x", label: "a", tone: "pass" }] }), BadBody);
  assert.throws(() => parseFieldSet({ ...setJson, fields: [{ id: "f_bad", type: "choice_row" }] }), BadBody);
  assert.throws(() => parseFieldSets({}), BadBody);
});

test("usage rows and the write answers are checked", () => {
  assert.deepEqual(parseLibraryUses([use]), [use]);
  assert.throws(() => parseLibraryUses([{ ...use, target: "kit" }]), BadBody);
  assert.throws(() => parseLibraryUses([{ ...use, in: "both" }]), BadBody);
  assert.equal(parseVersion({ version: 4 }), 4);
  assert.throws(() => parseVersion({ version: 0 }), BadBody);
  assert.deepEqual(parseOptionListSaved({ version: 3, linked: [{ route_id: 1, step_uid: "s_a", field_id: "f_b" }] }), {
    version: 3, linked: [{ route_id: 1, step_uid: "s_a", field_id: "f_b" }],
  });
  assert.throws(() => parseOptionListSaved({ version: 3 }), BadBody);
  assert.equal(parsePropagated({ updated_drafts: 0 }), 0);
  assert.throws(() => parsePropagated({}), BadBody);
});

test("a route row keeps the members the screen reads; a route without uids reads as none", () => {
  const row = { test_route_id: 1, item_type_id: 2, route_number: 1, route_steps: [3, 4], step_uids: ["s_a", "s_b"], fields_version: 2, has_draft: false };
  assert.deepEqual(parseRouteRow(row), { test_route_id: 1, item_type_id: 2, route_number: 1, route_steps: [3, 4], step_uids: ["s_a", "s_b"] });
  assert.deepEqual(parseRouteRow({ ...row, step_uids: null }).step_uids, []);
  assert.deepEqual(parseRouteRow({ ...row, step_uids: ["s_a", null] }).step_uids, ["s_a", ""]);
  assert.equal(parseRouteRows([row, row]).length, 2);
  assert.throws(() => parseRouteRow({ test_route_id: 1 }), BadBody);
  assert.throws(() => parseRouteRow({ ...row, route_steps: ["3"] }), BadBody);
  assert.throws(() => parseRouteRows({}), BadBody);
});

test("a draft write's answers: saved, or a conflict carrying the server's draft", () => {
  assert.deepEqual(parseDraftSaved({ draft_rev: 3, draft_updated_at: "2026-10-14T08:00:00.000Z", issues: [] }), {
    draft_rev: 3, draft_updated_at: "2026-10-14T08:00:00.000Z", issues: [],
  });
  assert.throws(() => parseDraftSaved({ draft_rev: 3, issues: [] }), BadBody);
  assert.throws(() => parseDraftSaved({ draft_rev: 3, draft_updated_at: "x", issues: [{ level: "fatal" }] }), BadBody);
  const conflict = parseDraftConflict({ code: "DRAFT_CONFLICT", draft: null, draft_rev: 5, draft_updated_at: "t", draft_updated_by: 7 });
  assert.deepEqual(conflict, { draft: null, draft_rev: 5, draft_updated_at: "t", draft_updated_by: null });
  assert.throws(() => parseDraftConflict({ code: "STEP_UNKNOWN", draft_rev: 5 }), BadBody);
  assert.throws(() => parseDraftConflict({ code: "DRAFT_CONFLICT", draft: { schema: 9 }, draft_rev: 5 }), BadBody);
});
