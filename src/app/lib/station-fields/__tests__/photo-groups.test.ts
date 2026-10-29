import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldPhotoGroupDesc, fieldPhotoGroupsOf } from "../photo-groups";
import { fieldPhotoCode } from "../schema";
import type { Field, RouteFieldsConfig } from "../schema";
import { LIMITS } from "../validate";

const shot = (id: string, label: string, photo_type = ""): Field =>
  ({ id, type: "photo", label, required: false, notes: "off", photo_type, min: 1 }) as Field;
const text: Field = { id: "f_txt00001", type: "text", label: "הערה", required: false, notes: "off" };

test("fieldPhotoCode: route, step and field — within photo_types.code", () => {
  assert.equal(fieldPhotoCode(13, "s_abcd1234", "f_wxyz9876"), "r13.s_abcd1234.f_wxyz9876");
  assert.ok(fieldPhotoCode(2_147_483_647, "s_abcd1234", "f_wxyz9876").length <= LIMITS.photoType);
});

test("fieldPhotoGroupsOf: every photo field of every step and group, nothing else", () => {
  const cfg: RouteFieldsConfig = {
    schema: 1,
    steps: {
      s_open0001: { uid: "s_open0001", station_type_id: 5, station_label: "פתיחה", scope: "package", groups: [
        { target: "box", fields: [shot("f_box00001", "הקופסה", "package"), text] },
        { target: "each_item", fields: [shot("f_eac00001", "הפריט")] },
      ] },
      s_clos0001: { uid: "s_clos0001", station_type_id: 8, station_label: "סגירה", scope: "package", groups: [{ target: "box", fields: [text] }] },
    },
  };
  assert.deepEqual(fieldPhotoGroupsOf(cfg, 13), [
    { code: "r13.s_open0001.f_box00001", step_uid: "s_open0001", field_id: "f_box00001", label: "הקופסה", station_type_id: 5, station_label: "פתיחה" },
    { code: "r13.s_open0001.f_eac00001", step_uid: "s_open0001", field_id: "f_eac00001", label: "הפריט", station_type_id: 5, station_label: "פתיחה" },
  ]);
  // A fork's copy of the same step and field has a group of its own.
  assert.deepEqual(fieldPhotoGroupsOf(cfg, 14).map((g) => g.code), ["r14.s_open0001.f_box00001", "r14.s_open0001.f_eac00001"]);
});

test("fieldPhotoGroupDesc: '{station} · {label}', 'צילום' for an unnamed field, at most 255", () => {
  assert.equal(fieldPhotoGroupDesc(" פתיחה ", " הקופסה "), "פתיחה · הקופסה");
  assert.equal(fieldPhotoGroupDesc("פתיחה", "  "), "פתיחה · צילום");
  assert.equal(fieldPhotoGroupDesc("א".repeat(200), "ב".repeat(200)).length, 255);
});
