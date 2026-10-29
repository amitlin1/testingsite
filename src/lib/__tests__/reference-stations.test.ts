import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";
import type { PopupTemplateConfig } from "@/app/lib/popup-templates/schema";
import { referenceStationsOf } from "../reference-stations";

// Station types: 1 opening (package-level), 2 per-item code photo popup, 3 per-item with a template
// whose photo shows reference images, 4 per-item verdict, 5 per-item template without reference,
// 6 closing (package-level), 7 package-level with a template whose item flow shows them.
const stationTypes = [
  { id: 1, name: "פתיחה", packageLevel: true },
  { id: 2, name: "צילום", packageLevel: false },
  { id: 3, name: "תבנית", packageLevel: false },
  { id: 4, name: "פסק דין", packageLevel: false },
  { id: 5, name: "תבנית בלי ייחוס", packageLevel: false },
  { id: 6, name: "סגירה", packageLevel: true },
  { id: 7, name: "פתיחה בתבנית", packageLevel: true },
];
const photo = (show_reference: boolean) => ({ id: "k_aaaaaaaa", kind: "photo", title: "צילום", photo_code: "k_aaaaaaaa", min: 0, show_reference });
const cfg = (show: boolean, flow = false) =>
  ({ steps: flow ? [] : [{ id: "p_aaaaaaaa", components: [photo(show)] }], item_flow: flow ? [{ id: "p_bbbbbbbb", components: [photo(show)] }] : undefined }) as unknown as PopupTemplateConfig;
const templates = new Map<number, PopupTemplateConfig>([[3, cfg(true)], [5, cfg(false)], [7, cfg(true, true)]]);
const codePopups = { 2: { kind: "photo", photoTypeId: 3 }, 4: { kind: "verdict" } } as const;

test("referenceStationsOf: each item type's stations that show reference images, in route order", () => {
  const out = referenceStationsOf({
    stationTypes,
    routes: [
      { item_type_id: 50, route_number: 1, route_steps: [1, 6] },            // a kit: opens at 1, closes at 6
      { item_type_id: 51, route_number: 2, route_steps: [3, 2] },            // route 2 listed first on purpose
      { item_type_id: 51, route_number: 1, route_steps: [1, 4, 5, 2, 3, 6] },
      { item_type_id: 52, route_number: 1, route_steps: [7, 6] },            // a kit opening at a templated station
    ],
    packageItemTypeIds: new Set([50, 52]),
    templates,
    codePopups,
  });
  assert.deepEqual(out.byItemType, { 50: [1], 51: [1, 2, 3], 52: [7] });
  assert.deepEqual(out.stations.map((s) => s.id), [1, 2, 3, 4, 5, 6, 7]);
});

test("referenceStationsOf: a package-level type that only closes shows none; one that both opens and closes shows them", () => {
  const out = referenceStationsOf({
    stationTypes,
    routes: [{ item_type_id: 50, route_number: 1, route_steps: [6, 1] }, { item_type_id: 60, route_number: 1, route_steps: [6, 6] }],
    packageItemTypeIds: new Set([50, 60]),
    templates,
    codePopups,
  });
  assert.deepEqual(out.byItemType, { 50: [6], 60: [6] });
});

test("the migration's code popups are CODE_POPUPS' photo popups", () => {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261029130000_reference_images_by_station/migration.sql"), "utf8");
  const values = sql.match(/FROM \(VALUES ([^)]*\)(?:, \([^)]*\))*)\) AS c\(station, photo_type_id\)/);
  assert.ok(values, "the VALUES list of the code popups");
  const pairs = [...values[1].matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const expected = Object.entries(CODE_POPUPS).flatMap(([id, p]) => (p.kind === "photo" ? [[Number(id), p.photoTypeId]] : []));
  assert.deepEqual(pairs, expected);
});
