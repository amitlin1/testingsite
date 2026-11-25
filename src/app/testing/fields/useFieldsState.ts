"use client";
import * as React from "react";
import type { Drafts, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import type { Field, FieldId, FieldsResultBlock, FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { buildFieldsBlock, evaluateDrafts, inputFieldCount, patchDraft, type DraftPatch, type VerdictInput } from "./drafts";

/**
 * The worker's values while a popup is open (route-fields spec §4.3): one draft per field, kept by
 * FieldId, evaluated with the pure module (evaluate.ts) and turned into the Details block on submit.
 *
 * Drafts are never dropped when the definitions change — a reload after 409 FIELDS_SCHEMA_MISMATCH,
 * or the package wizard reloading after adding an item — so whatever the worker entered for a field
 * that is still there survives; drafts of fields that went away are simply not read. The logic is
 * drafts.ts's.
 */

const NO_DEFS: readonly Field[] = [];

export type FieldsState = {
  drafts: Drafts;
  /** Excludes section headers ("N שדות"). */
  defsCount: number;
  /** A function patch is applied to the draft as it is when the update runs (see DraftPatch). */
  set: (id: FieldId, patch: DraftPatch) => void;
  ev: FieldsEvaluation;
  photosPending: FieldId[];
  blocking: (gate: boolean) => boolean;
  /** The Details block: item mode → toBlock(sf.schema, …); the package box → toBlock({ ...sf.schema,
   *  target: "box" }, …). VerdictStation passes { ok, note }, PhotoStation { ok }, the dialog {}. */
  toBlock: (schema: FieldsSchemaRef, verdict?: VerdictInput) => FieldsResultBlock;
};

/**
 * Drafts for one list of fields: `defs` is sf.fields (item mode) or sf.box (the package box), []
 * while there is no config. `set` never changes identity, but the returned object does
 * whenever a draft does.
 */
export function useFieldsState(defs: readonly Field[]): FieldsState {
  // A fresh `[]` every render (no config yet) must not count as new definitions.
  const list = defs.length === 0 ? NO_DEFS : defs;
  const [drafts, setDrafts] = React.useState<Drafts>({});

  const set = React.useCallback((id: FieldId, patch: DraftPatch) => setDrafts((d) => patchDraft(d, id, patch)), []);

  const evaluation = React.useMemo(() => evaluateDrafts(list, drafts), [list, drafts]);
  const defsCount = React.useMemo(() => inputFieldCount(list), [list]);
  const toBlock = React.useCallback(
    (schema: FieldsSchemaRef, verdict?: VerdictInput) => buildFieldsBlock(list, drafts, schema, verdict),
    [list, drafts],
  );

  return React.useMemo(() => ({
    drafts, defsCount, set,
    ev: evaluation.ev, photosPending: evaluation.photosPending, blocking: evaluation.blocking,
    toBlock,
  }), [drafts, defsCount, set, evaluation, toBlock]);
}
