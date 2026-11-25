"use client";
import React from "react";
import type { PackageItemView } from "@/app/lib/packages/contract";
import type { Drafts } from "@/app/lib/station-fields/evaluate";
import type { Field, FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { draftsFieldsState, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { buildFieldsBlock, inputFieldCount } from "@/app/testing/fields/drafts";
import type { Decision } from "./closingModel";

/** A kit item's station fields at this step: its definitions, its drafts' state, and whether its
 *  row shows them (artboard 17 `fieldsVisible`: it reached the station, or was packed anyway). */
export type KitItemFieldsState = { defs: Field[]; fx: DraftsFieldsState; shown: boolean };

const NO_DRAFTS: Drafts = {};

/**
 * The kit items' station fields at the closing (artboard 17), for both closing wizards: each item's
 * drafts by item_id, and every item that has fields (`byItem`), shown under its row once it arrived
 * or was packed anyway (`shown`).
 */
export function useClosingItemFields(items: readonly PackageItemView[], defsOf: (itemId: string) => Field[], decisions: Readonly<Record<string, Decision>>) {
  const [itemDrafts, setItemDrafts] = React.useState<Record<string, Drafts>>({});
  const draftsOf = (it: PackageItemView): Drafts => itemDrafts[it.item_id] ?? NO_DRAFTS;
  const byItem = new Map<string, KitItemFieldsState>();
  for (const it of items) {
    const defs = defsOf(it.item_id);
    if (inputFieldCount(defs) === 0) continue;
    const id = it.item_id;
    byItem.set(id, {
      defs,
      fx: draftsFieldsState(defs, draftsOf(it), (next) => setItemDrafts((all) => ({ ...all, [id]: next(all[id] ?? NO_DRAFTS) }))),
      shown: it.arrived_at_closing || decisions[id]?.decision === "packed_anyway",
    });
  }
  /** An item's fields block on `ref`: its verdict is { suggested } only — the worker's own decision
   *  stays in Result / Passed, as today. */
  const blockOf = (it: PackageItemView, ref: FieldsSchemaRef) => buildFieldsBlock(defsOf(it.item_id), draftsOf(it), ref, {});
  /** What an item packed anyway carries in its decision (it has no result row of its own). */
  const decisionFieldsOf = (ref: FieldsSchemaRef) => (it: PackageItemView) => {
    const { fields, verdict } = blockOf(it, ref);
    return { fields, suggested: verdict.suggested };
  };
  return { byItem, shown: Array.from(byItem.values()).filter((f) => f.shown), on: byItem.size > 0, blockOf, decisionFieldsOf };
}

export type ClosingItemFields = ReturnType<typeof useClosingItemFields>;
