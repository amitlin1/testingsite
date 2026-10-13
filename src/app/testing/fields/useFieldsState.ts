"use client";
import * as React from "react";
import {
  evaluateFields, fieldsBlocking, pendingPhotos, toFieldValue, toResultBlock,
} from "@/app/lib/station-fields/evaluate";
import type { Drafts, FieldDraft, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import type { Field, FieldId, FieldValue, FieldsResultBlock, FieldsSchemaRef } from "@/app/lib/station-fields/schema";

/**
 * The worker's values while a popup is open (route-fields spec §4.3): one draft per field, kept by
 * FieldId, evaluated with the pure module (evaluate.ts) and turned into the Details block on submit.
 *
 * Drafts are never dropped when the definitions change — a reload after 409 FIELDS_SCHEMA_MISMATCH,
 * or the package wizard reloading after adding an item — so whatever the worker entered for a field
 * that is still there survives; drafts of fields that went away are simply not read. Only reset()
 * clears them.
 *
 * The package wizards keep each item's drafts inside their own state; the pure helpers below
 * (evaluateDrafts, patchDraft, buildFieldsBlock …) are the same logic for them.
 */

export { toFieldValue } from "@/app/lib/station-fields/evaluate";
export type { Drafts, FieldDraft } from "@/app/lib/station-fields/evaluate";

/** The worker's own decision as the popups keep it ("" or null = not chosen yet), plus the note
 *  VerdictStation keeps beside it. */
export type VerdictInput = { ok?: "pass" | "fail" | "" | null; note?: string };

/** What evaluating a set of drafts tells a popup. */
export type DraftsEvaluation = {
  /** evaluateFields: suggested, fails (all of them), missingRequired, missingNotes, noteTooLong. */
  ev: FieldsEvaluation;
  /** Photo fields with a shot still uploading or whose upload failed (evaluate.ts pendingPhotos). */
  photosPending: FieldId[];
  /** True while these fields keep the popup from finishing: with `gate` on (the response's `gate`),
   *  a required field or note is missing; whatever `gate` says, a note is over its maximum or a
   *  photo is not uploaded (evaluate.ts fieldsBlocking). */
  blocking: (gate: boolean) => boolean;
};

const NO_DEFS: readonly Field[] = [];

/** drafts[id], own keys only. */
function draftOf(drafts: Readonly<Drafts>, id: FieldId): FieldDraft | undefined {
  return Object.prototype.hasOwnProperty.call(drafts, id) ? drafts[id] : undefined;
}

/** "N שדות": every field except section headers. */
export function inputFieldCount(defs: readonly Field[]): number {
  return defs.reduce((n, d) => (d.type === "section" ? n : n + 1), 0);
}

/** Every field's value as evaluateFields reads it (blank values included; sections have none). */
export function draftValues(defs: readonly Field[], drafts: Readonly<Drafts>): Record<FieldId, FieldValue> {
  const values: Record<FieldId, FieldValue> = {};
  for (const def of defs) {
    const value = toFieldValue(def, draftOf(drafts, def.id));
    if (value) values[def.id] = value;
  }
  return values;
}

/** Evaluates drafts against their definitions. */
export function evaluateDrafts(defs: readonly Field[], drafts: Readonly<Drafts>): DraftsEvaluation {
  const ev = evaluateFields(defs, draftValues(defs, drafts));
  const photosPending = pendingPhotos(defs, drafts);
  return { ev, photosPending, blocking: (gate: boolean) => fieldsBlocking(ev, gate, photosPending) };
}

/** A change to one field's draft: the keys to merge, or a function of the draft as it is when the
 *  change lands — for changes that finish later or several at once (photo uploads: a gallery pick
 *  adds several shots in one go, and each upload settles its own shot whenever it ends). */
export type DraftPatch = Partial<FieldDraft> | ((draft: FieldDraft | undefined) => Partial<FieldDraft>);

/** One field's draft with `patch` merged in; the other drafts unchanged. */
export function patchDraft(drafts: Readonly<Drafts>, id: FieldId, patch: DraftPatch): Drafts {
  const draft = draftOf(drafts, id);
  return { ...drafts, [id]: { ...draft, ...(typeof patch === "function" ? patch(draft) : patch) } };
}

/** Several fields at once ("הכל תקין", phase 3): each entry merged into that field's draft. */
export function mergeDrafts(drafts: Readonly<Drafts>, patch: Readonly<Drafts>): Drafts {
  let next: Drafts = { ...drafts };
  for (const [id, p] of Object.entries(patch)) next = patchDraft(next, id, p);
  return next;
}

/** The { schema, fields, verdict } block a popup spreads into Details (evaluate.ts toResultBlock),
 *  with the popup's "" (not chosen) read as no decision. */
export function buildFieldsBlock(
  defs: readonly Field[],
  drafts: Readonly<Drafts>,
  schema: FieldsSchemaRef,
  verdict: VerdictInput = {},
): FieldsResultBlock {
  const ok = verdict.ok === "pass" || verdict.ok === "fail" ? verdict.ok : undefined;
  return toResultBlock(defs, drafts, schema, {
    ...(ok ? { ok } : {}),
    ...(verdict.note !== undefined ? { note: verdict.note } : {}),
  });
}

export type FieldsState = {
  drafts: Drafts;
  /** Excludes section headers ("N שדות"). */
  defsCount: number;
  /** A function patch is applied to the draft as it is when the update runs (see DraftPatch). */
  set: (id: FieldId, patch: DraftPatch) => void;
  /** "הכל תקין" (phase 3). */
  setMany: (patch: Drafts) => void;
  reset: () => void;
  ev: FieldsEvaluation;
  photosPending: FieldId[];
  blocking: (gate: boolean) => boolean;
  /** The Details block: item mode → toBlock(sf.schema, …); the package box → toBlock({ ...sf.schema,
   *  target: "box" }, …). VerdictStation passes { ok, note }, PhotoStation { ok }, the dialog {}. */
  toBlock: (schema: FieldsSchemaRef, verdict?: VerdictInput) => FieldsResultBlock;
};

/**
 * Drafts for one list of fields: `defs` is sf.fields (item mode) or sf.box (the package box), []
 * while there is no config. set / setMany / reset never change identity, but the returned object
 * does whenever a draft does — so a host's open-reset effect takes `reset` on its own:
 *
 *   const { reset: resetFields } = fx;
 *   React.useEffect(() => { if (!open) return; …; resetFields(); }, [open, item, resetFields]);
 */
export function useFieldsState(defs: readonly Field[]): FieldsState {
  // A fresh `[]` every render (no config yet) must not count as new definitions.
  const list = defs.length === 0 ? NO_DEFS : defs;
  const [drafts, setDrafts] = React.useState<Drafts>({});

  const set = React.useCallback((id: FieldId, patch: DraftPatch) => setDrafts((d) => patchDraft(d, id, patch)), []);
  const setMany = React.useCallback((patch: Drafts) => setDrafts((d) => mergeDrafts(d, patch)), []);
  const reset = React.useCallback(() => setDrafts({}), []);

  const evaluation = React.useMemo(() => evaluateDrafts(list, drafts), [list, drafts]);
  const defsCount = React.useMemo(() => inputFieldCount(list), [list]);
  const toBlock = React.useCallback(
    (schema: FieldsSchemaRef, verdict?: VerdictInput) => buildFieldsBlock(list, drafts, schema, verdict),
    [list, drafts],
  );

  return React.useMemo(() => ({
    drafts, defsCount, set, setMany, reset,
    ev: evaluation.ev, photosPending: evaluation.photosPending, blocking: evaluation.blocking,
    toBlock,
  }), [drafts, defsCount, set, setMany, reset, evaluation, toBlock]);
}
