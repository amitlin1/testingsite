import { isRecord, oneOf } from "@/lib/json-guards";
import type { FieldValue, FieldsSchemaRef } from "@/app/lib/station-fields/schema";

/**
 * test_results.details — what a station's result saves: the keys the popups write
 * (src/app/testing/tests-popups), the station-fields block and its schema ref (route-fields spec
 * §3.4), a popup template's components (docs/popup-templates/PLAN.md §3.5). Written by the testing
 * popups; read by the item report and the package screens. Client-safe.
 */

/** Where an opened item's reference came from (tests-popups/reference.ts decides it). */
export const REF_SOURCES = ["package", "scan", "package_fallback", "none"] as const;
export type RefSource = (typeof REF_SOURCES)[number];

/** One popup template component as saved, in popup order (`components`): its id and a FieldValue
 *  (the route fields' format, label at save time). A list, not an object keyed by id: details is
 *  jsonb, which keeps an array's order but not an object's keys'. */
export type SavedComponent = { id: string } & FieldValue;

/** The `weight` key: the measured weight against the item's reference, or null while either side
 *  is missing. */
export type SavedWeight = { reference: number; measured: number; diffPct: number; pass: boolean } | null;

/** A photo block — the verdict, its note and the stored photo keys — under one of PHOTO_BLOCK_KEYS
 *  (`photo` at a station, `product` for an item and `pkg` for the box at the opening). */
export type SavedPhotoBlock = { ok: string | boolean; note?: string; photos: string[] };
export const PHOTO_BLOCK_KEYS = ["photo", "product", "pkg"] as const;

const SCHEMA_TARGETS: readonly FieldsSchemaRef["target"][] = ["item", "box", "kit_item"];

/** details.schema, each key type-checked: a key that is missing or of the wrong type is left out. */
export function readSchemaRef(details: unknown): Partial<FieldsSchemaRef> {
  const sc = isRecord(details) && isRecord(details.schema) ? details.schema : null;
  if (!sc) return {};
  const ref: Partial<FieldsSchemaRef> = {};
  if (typeof sc.route_id === "number") ref.route_id = sc.route_id;
  if (typeof sc.v === "number") ref.v = sc.v;
  if (typeof sc.step_uid === "string" && sc.step_uid) ref.step_uid = sc.step_uid;
  if (oneOf(SCHEMA_TARGETS, sc.target)) ref.target = sc.target;
  return ref;
}
