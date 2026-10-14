import { NOTE_MAX_DEFAULT } from "./schema";
import type {
  ChecklistItemId, ChoiceOption, Field, FieldId, FieldValue, FieldsResultBlock, FieldsSchemaRef,
  FieldsVerdict, InputField, NumberField, OptionId,
} from "./schema";
import { PASS_FAIL_WORD, fieldsGateText } from "./labels";

/**
 * "מוצע" and the finish gate (route-fields spec §2.6, decision D3). Pure — the popups run it
 * while the worker types, and the server runs it again on submit and keeps ITS answer.
 *
 * - Has a value: choice_row = a known option; multi_choice = ≥ 1 known option; pass_fail = chosen;
 *   number = a finite number; text / textarea / scan = non-blank; checklist = every item ticked;
 *   photo = at least max(min, 1) photos.
 * - Fails: an option with tone "fail" (choice_row, any of multi_choice); pass_fail "fail"; a number
 *   outside its range when out_of_range_fail is on.
 * - suggested: "fail" on any fail; "pass" when every verdict-driving field (choice_row,
 *   multi_choice, pass_fail, number with out_of_range_fail and a range) has a value; else null.
 *   The UI never draws a "מוצע: תקין" line.
 * - Section headers never count.
 * - A blank value and no value at all evaluate the same, so the popup (every field, blank or not)
 *   and the server (only the fields that were filled — isBlankFieldValue) reach the same answer.
 */

/** Open decision #1 (spec §10.1): finishing is blocked while a required field or a required note is
 *  missing. The client and the server read this one constant; "העבר לחקר" is never gated. */
export const GATE_FINISH_ON_REQUIRED = true;

export type FailItem = { field_id: FieldId; label: string; valueText: string };

export type FieldsEvaluation = {
  suggested: "pass" | "fail" | null;
  /** ALL failing fields, in field order. Every artboard joins them with " · ". */
  fails: FailItem[];
  /** = fails[0] ?? null (kept for convenience). */
  firstFail: FailItem | null;
  /** Required fields without a value (and photos below their minimum) → "נותר שדה חובה אחד" / "נותרו N שדות חובה". */
  missingRequired: FieldId[];
  /** Notes the field demands but the worker left blank → "חסרה הערה לחריגה" / "יש לפרט את החריגה".
   *  Never a field already in missingRequired: like every artboard, a field counts once, so the
   *  sum of the two lengths is the number of fields left (the gate and status texts add them). */
  missingNotes: FieldId[];
  /** Notes over note_max (default 1000), in UTF-16 code units like the textarea's maxlength. */
  noteTooLong: FieldId[];
};

// ---- helpers ------------------------------------------------------------------------
function own<T>(o: Readonly<Record<string, T>> | undefined, k: string): T | undefined {
  return o != null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}
const optionById = (options: readonly ChoiceOption[], id: unknown): ChoiceOption | undefined =>
  options.find((o) => o.id === id);
/** The field's options (in their configured order) that the stored value picked. */
function pickedOptions(options: readonly ChoiceOption[], picked: unknown): ChoiceOption[] {
  if (!Array.isArray(picked)) return [];
  const ids = new Set<unknown>(picked.map((p: unknown) => (typeof p === "object" && p !== null ? (p as { id?: unknown }).id : undefined)));
  return options.filter((o) => ids.has(o.id));
}
function photoCount(value: Extract<FieldValue, { t: "photo" }>): number {
  return Array.isArray(value.photos) ? value.photos.filter((k) => typeof k === "string" && k !== "").length : 0;
}
/** The stored value for this field, only when it is of the field's own type. */
function valueOf(def: InputField, values: Readonly<Record<FieldId, FieldValue | undefined>>): FieldValue | undefined {
  const v = own(values, def.id);
  return v != null && typeof v === "object" && v.t === def.type ? v : undefined;
}

/** Float noise allowance for the inclusive ref ± tol% bounds (0.1 ± 10% must accept 0.09). */
const RANGE_EPSILON = 1e-9;

// ---- per field --------------------------------------------------------------------------
/** null when there is no value or the field defines no range (a ref without tol_pct is not a range). */
export function numberInRange(def: NumberField, value: number | null | undefined): boolean | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const { min, max, ref, tol_pct } = def;
  const tolerance = ref != null && tol_pct != null ? { ref, tol: tol_pct } : null;
  if (min == null && max == null && tolerance == null) return null;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  if (tolerance) {
    const allowed = (Math.abs(tolerance.ref) * tolerance.tol) / 100;
    if (Math.abs(value - tolerance.ref) > allowed + RANGE_EPSILON * Math.max(1, Math.abs(tolerance.ref))) return false;
  }
  return true;
}

export function fieldHasValue(def: Field, value: FieldValue | undefined): boolean {
  // Every item of a checklist without items is ticked, stored value or not (a blank one is never
  // stored). Lint keeps such a field from being published (CHECKLIST_EMPTY).
  if (def.type === "checklist" && def.items.length === 0) return true;
  if (!value || def.type === "section" || value.t !== def.type) return false;
  switch (value.t) {
    case "choice_row":
      return def.type === "choice_row" && value.opt != null && optionById(def.options, value.opt) !== undefined;
    case "multi_choice":
      return def.type === "multi_choice" && pickedOptions(def.options, value.opts).length > 0;
    case "pass_fail":
      return value.ok === "pass" || value.ok === "fail";
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "text":
    case "textarea":
    case "scan":
      return typeof value.value === "string" && value.value.trim() !== "";
    case "checklist": {
      const ticked = Array.isArray(value.items) ? value.items : [];
      return def.type === "checklist" && def.items.every((it) => ticked.some((x) => x != null && x.id === it.id && x.ok === true));
    }
    case "photo":
      return def.type === "photo" && photoCount(value) >= Math.max(def.min, 1);
  }
}

export function isFieldFail(def: Field, value: FieldValue | undefined): boolean {
  if (!value || def.type === "section" || value.t !== def.type) return false;
  switch (value.t) {
    case "choice_row":
      return def.type === "choice_row" && optionById(def.options, value.opt)?.tone === "fail";
    case "multi_choice":
      return def.type === "multi_choice" && pickedOptions(def.options, value.opts).some((o) => o.tone === "fail");
    case "pass_fail":
      return value.ok === "fail";
    case "number":
      return def.type === "number" && def.out_of_range_fail && numberInRange(def, value.value) === false;
    default:
      return false;
  }
}

/** notes "required" always; "required_on_fail" only while the field fails. */
export function noteRequired(def: Field, isFail: boolean): boolean {
  if (def.type === "section") return false;
  return def.notes === "required" || (def.notes === "required_on_fail" && isFail);
}

/** The value as the suggestion line shows it: choice_row → the option label; multi_choice → the
 *  fail-tone labels joined ", "; number → "0.2 Ω"; pass_fail → "לא תקין". */
export function failValueText(def: Field, value: FieldValue | undefined): string {
  if (!value || def.type === "section" || value.t !== def.type) return "";
  switch (value.t) {
    case "choice_row":
      return def.type === "choice_row" ? optionById(def.options, value.opt)?.label ?? value.opt_label ?? "" : "";
    case "multi_choice":
      return def.type === "multi_choice"
        ? pickedOptions(def.options, value.opts).filter((o) => o.tone === "fail").map((o) => o.label).join(", ")
        : "";
    case "number":
      if (value.value == null) return "";
      return `${value.value}${def.type === "number" && def.unit ? " " + def.unit : ""}`;
    case "pass_fail":
      return value.ok === "fail" ? PASS_FAIL_WORD.fail : value.ok === "pass" ? PASS_FAIL_WORD.pass : "";
    default:
      return "";
  }
}

/** prefix + every fail as "'<label>' = <value>", joined " · " — e.g. SUGGEST_PREFIX (labels.ts). */
export function suggestionText(prefix: string, fails: readonly FailItem[]): string {
  return prefix + fails.map((f) => "'" + f.label + "' = " + f.valueText).join(" · ");
}

function drivesVerdict(def: InputField): boolean {
  switch (def.type) {
    case "choice_row":
    case "multi_choice":
    case "pass_fail":
      return true;
    case "number":
      return def.out_of_range_fail && (def.min != null || def.max != null || (def.ref != null && def.tol_pct != null));
    default:
      return false;
  }
}

function isMissing(def: InputField, value: FieldValue | undefined, has: boolean): boolean {
  if (def.required && !has) return true;
  // A photo minimum binds even on a field that is not required.
  return def.type === "photo" && def.min > 0 && (value?.t === "photo" ? photoCount(value) : 0) < def.min;
}

// ---- the whole block --------------------------------------------------------------------
export function evaluateFields(
  defs: readonly Field[],
  values: Readonly<Record<FieldId, FieldValue | undefined>>,
): FieldsEvaluation {
  const fails: FailItem[] = [];
  const missingRequired: FieldId[] = [];
  const missingNotes: FieldId[] = [];
  const noteTooLong: FieldId[] = [];
  let driving = 0;
  let drivingFilled = 0;
  for (const def of defs) {
    if (def.type === "section") continue;
    const value = valueOf(def, values);
    const has = fieldHasValue(def, value);
    const fail = isFieldFail(def, value);
    if (fail) fails.push({ field_id: def.id, label: def.label, valueText: failValueText(def, value) });
    if (drivesVerdict(def)) {
      driving += 1;
      if (has) drivingFilled += 1;
    }
    const missing = isMissing(def, value, has);
    if (missing) missingRequired.push(def.id);
    if (def.notes !== "off") {   // "off": any note is ignored (the server drops it)
      const note = typeof value?.note === "string" ? value.note : "";
      // A field still missing its value is already counted once, above.
      if (!missing && noteRequired(def, fail) && note.trim() === "") missingNotes.push(def.id);
      if (note.length > (def.note_max ?? NOTE_MAX_DEFAULT)) noteTooLong.push(def.id);
    }
  }
  const suggested = fails.length > 0 ? "fail" : driving > 0 && drivingFilled === driving ? "pass" : null;
  return { suggested, fails, firstFail: fails[0] ?? null, missingRequired, missingNotes, noteTooLong };
}

/** The finish-gate message (spec §3.4 step 6) — the 422 FIELDS_INCOMPLETE text — or null. */
export function fieldsGateMessage(ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes">): string | null {
  return fieldsGateText(ev.missingRequired.length, ev.missingNotes.length);
}

/** Spec §4.3: the gate (when on) waits for required fields and notes. Two things block whatever
 *  the gate says: a note over its maximum (the server enforces the length regardless), and a photo
 *  still uploading or whose upload failed (§4.8; `photosPending` = pendingPhotos(defs, drafts)),
 *  which finishing would silently drop. */
export function fieldsBlocking(
  ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes" | "noteTooLong">,
  gate: boolean,
  photosPending: readonly FieldId[],
): boolean {
  const gateOpen = !gate || (ev.missingRequired.length === 0 && ev.missingNotes.length === 0);
  return !gateOpen || ev.noteTooLong.length > 0 || photosPending.length > 0;
}

/** The counts behind status ב / ג ("{done} / {total} שדות חובה", "חובה: {done} מתוך {total}"):
 *  every field that can block finishing — required ones, and photos with a minimum. */
export function requiredProgress(
  defs: readonly Field[],
  ev: Pick<FieldsEvaluation, "missingRequired">,
): { done: number; total: number } {
  const total = defs.filter((d) => d.type !== "section" && (d.required || (d.type === "photo" && d.min > 0))).length;
  return { done: Math.max(0, total - ev.missingRequired.length), total };
}

// ---- the popup's draft → the saved block (spec §4.3) ------------------------------------
/** stationKit's Shot, structurally (a pure module cannot import the React kit). */
export type DraftShot = { previewUrl: string; objectKey?: string; uploading?: boolean; failed?: boolean };

/** What a popup keeps per field while the worker types. */
export type FieldDraft = {
  opt?: OptionId | null;                       // choice_row
  opts?: OptionId[];                           // multi_choice
  ok?: "pass" | "fail" | null;                 // pass_fail
  num?: string;                                // number — raw text as typed ("," → ".")
  text?: string;                               // text / textarea / scan
  checked?: Record<ChecklistItemId, boolean>;  // checklist
  photos?: DraftShot[];                        // photo
  note?: string;
};
export type Drafts = Record<FieldId, FieldDraft>;

/** Number text as typed → a number: trimmed, "," read as ".", anything non-finite → null. */
export function parseNumberText(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim().replace(/,/g, ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The object key a shot is saved under — the same keys PhotoStation saves — or null while it is
 *  still uploading, after its upload failed, or when it never got a key. */
function savedKey(s: DraftShot): string | null {
  return !s.uploading && !s.failed && typeof s.objectKey === "string" && s.objectKey !== "" ? s.objectKey : null;
}

function shotKeys(shots: readonly DraftShot[] | undefined): string[] {
  const keys: string[] = [];
  for (const s of shots ?? []) {
    const key = s ? savedKey(s) : null;
    if (key !== null) keys.push(key);
  }
  return keys;
}

/** Photo fields holding a shot that would not be saved — still uploading, or its upload failed.
 *  toFieldValue keeps finished shots only, so finishing now would silently lose that photo: this
 *  blocks like PhotoStation's own check (fieldsBlocking), until the upload ends or the worker
 *  removes the failed shot. */
export function pendingPhotos(defs: readonly Field[], drafts: Readonly<Drafts>): FieldId[] {
  const out: FieldId[] = [];
  for (const def of defs) {
    if (def.type !== "photo") continue;
    const shots = own(drafts, def.id)?.photos;
    if (Array.isArray(shots) && shots.some((s) => s != null && savedKey(s) === null)) out.push(def.id);
  }
  return out;
}

/** One field's draft → its FieldValue (undefined for a section header, which is never stored).
 *  Labels, option labels and tones are copied from the definition; an unknown option reads as none;
 *  a note is kept only when non-blank and the field takes notes. An untouched field still gets a
 *  (blank) value to evaluate; toResultBlock leaves it out of the saved block. */
export function toFieldValue(def: Field, draft: FieldDraft | undefined): FieldValue | undefined {
  if (def.type === "section") return undefined;
  const label = def.label;
  const note = def.notes !== "off" && typeof draft?.note === "string" && draft.note.trim() !== "" ? { note: draft.note } : {};
  switch (def.type) {
    case "choice_row": {
      const o = draft?.opt != null ? optionById(def.options, draft.opt) : undefined;
      return { t: "choice_row", label, opt: o ? o.id : null, opt_label: o ? o.label : null, tone: o ? o.tone : null, ...note };
    }
    case "multi_choice": {
      const picked = new Set<unknown>(Array.isArray(draft?.opts) ? draft.opts : []);
      const opts = def.options.filter((o) => picked.has(o.id)).map((o) => ({ id: o.id, label: o.label, tone: o.tone }));
      return { t: "multi_choice", label, opts, ...note };
    }
    case "pass_fail":
      return { t: "pass_fail", label, ok: draft?.ok === "pass" || draft?.ok === "fail" ? draft.ok : null, ...note };
    case "number": {
      const value = parseNumberText(draft?.num);
      return { t: "number", label, value, ...(def.unit ? { unit: def.unit } : {}), in_range: numberInRange(def, value), ...note };
    }
    case "text":
    case "textarea":
    case "scan":
      return { t: def.type, label, value: typeof draft?.text === "string" ? draft.text : "", ...note };
    case "checklist":
      return {
        t: "checklist", label,
        items: def.items.map((it) => ({ id: it.id, label: it.label, ok: own(draft?.checked, it.id) === true })),
        ...note,
      };
    case "photo":
      return { t: "photo", label, photo_type: def.photo_type, photos: shotKeys(draft?.photos), ...note };
  }
}

/**
 * True when a value holds nothing the worker entered: no option, verdict, number, text, ticked
 * item or saved photo — not even a partial one — and no note. A blank value is never stored (here,
 * and the same way by the server's normaliser): publish-preview counts "מולא ב-N בדיקות" for a
 * removed field by the key alone (`details -> 'fields' ? id`, spec §3.4.2), and saved results are
 * never edited afterwards. evaluateFields reads a missing key exactly as a blank value.
 */
export function isBlankFieldValue(value: FieldValue): boolean {
  if (typeof value.note === "string" && value.note.trim() !== "") return false;
  switch (value.t) {
    case "choice_row":
      return value.opt == null;
    case "multi_choice":
      return !Array.isArray(value.opts) || value.opts.length === 0;
    case "pass_fail":
      return value.ok !== "pass" && value.ok !== "fail";
    case "number":
      return typeof value.value !== "number" || !Number.isFinite(value.value);
    case "text":
    case "textarea":
    case "scan":
      return typeof value.value !== "string" || value.value.trim() === "";
    case "checklist":
      return !Array.isArray(value.items) || !value.items.some((it) => it != null && it.ok === true);
    case "photo":
      return photoCount(value) === 0;
  }
}

/**
 * The block a popup spreads into Details: { schema, fields, verdict }. Only the fields the worker
 * filled are stored (see isBlankFieldValue; sections never are); verdict.suggested comes from
 * evaluateFields; ok and note are kept only when given; overridden only when ok and suggested are
 * both set and differ.
 */
export function toResultBlock(
  defs: readonly Field[],
  drafts: Readonly<Drafts>,
  schema: FieldsSchemaRef,
  verdictInput: { ok?: "pass" | "fail"; note?: string } = {},
): FieldsResultBlock {
  const fields: Record<FieldId, FieldValue> = {};
  for (const def of defs) {
    const value = toFieldValue(def, own(drafts, def.id));
    if (value && !isBlankFieldValue(value)) fields[def.id] = value;
  }
  const { suggested } = evaluateFields(defs, fields);
  const ok = verdictInput.ok === "pass" || verdictInput.ok === "fail" ? verdictInput.ok : undefined;
  const verdict: FieldsVerdict = {
    ...(ok ? { ok } : {}),
    ...(verdictInput.note !== undefined ? { note: verdictInput.note } : {}),
    suggested,
    ...(ok && suggested && ok !== suggested ? { overridden: true } : {}),
  };
  return { schema: { ...schema }, fields, verdict };
}
