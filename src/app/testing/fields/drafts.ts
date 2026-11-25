import { evaluateFields, fieldsBlocking, pendingPhotos, toFieldValue, toResultBlock } from "@/app/lib/station-fields/evaluate";
import type { Drafts, FieldDraft, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import type { Field, FieldId, FieldValue, FieldsResultBlock, FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { own } from "@/lib/json-guards";

/**
 * The worker's drafts (one per field, kept by FieldId) as the popups read them: evaluated with the
 * pure module (evaluate.ts) and turned into the Details block on submit. Pure — useFieldsState holds
 * one popup's drafts in React state; the package wizards keep each item's drafts in their own state
 * and call these directly, and so does the settings preview.
 */

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

/** "N שדות": every field except section headers. */
export function inputFieldCount(defs: readonly Field[]): number {
  return defs.reduce((n, d) => (d.type === "section" ? n : n + 1), 0);
}

/** Every field's value as evaluateFields reads it (blank values included; sections have none). */
function draftValues(defs: readonly Field[], drafts: Readonly<Drafts>): Record<FieldId, FieldValue> {
  const values: Record<FieldId, FieldValue> = {};
  for (const def of defs) {
    const value = toFieldValue(def, own(drafts, def.id));
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
  const draft = own(drafts, id);
  return { ...drafts, [id]: { ...draft, ...(typeof patch === "function" ? patch(draft) : patch) } };
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

