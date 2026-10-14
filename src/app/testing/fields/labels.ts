import { numberInRange, parseNumberText } from "@/app/lib/station-fields/evaluate";
import type { NumberField } from "@/app/lib/station-fields/schema";

/**
 * Strings only the worker popups use (route-fields spec §4). Strings shared with the server or the
 * admin screen — status lines, gate messages, the suggestion prefixes, PASS_FAIL_WORD — live in
 * src/app/lib/station-fields/labels.ts: import them from there, never re-type them here.
 *
 * Copied character for character from the artboards ("·" is U+00B7, "–" is U+2013). Text that no
 * artboard draws lives in WORKER_UNDRAWN_TEXT (spec "העיצוב סגור" rule 2; approved on 2026-10-14).
 */

// ---- not drawn in any worker artboard ---------------------------------------------------
/** Text the worker artboards never draw, worded here and approved on 2026-10-14. */
export const WORKER_UNDRAWN_TEXT = {
  // the station fields failed to load (useStationFields "error", spec §4.2, §10.4) —
  // the heading of the admin screen's load-failure state (artboard 11).
  loadFailed: "טעינת הגדרות השדות נכשלה",
  // the retry button of that state (artboard 11 `retryLabel`).
  retry: "נסה שוב",
  // a number field ranged by a reference value ± a tolerance (ref + tol_pct) — no
  // artboard draws it (spec §4.7, §10.4). Worded after the package-open wizard's weight strip
  // ("ייחוס … גר׳", "סטייה תקנית ±5%"): "ייחוס 0.05 Ω · סטייה תקנית ±10%".
  rangeRef: "ייחוס",
  rangeTolerance: "סטייה תקנית",
  // the list footer's count for a choice field with a single option (lint only
  // warns below two, so one can be published). Every artboard writes "{N} אפשרויות" with N ≥ 2;
  // "1 אפשרויות" is not Hebrew.
  optionCountOne: "אפשרות אחת",
} as const;

// ---- choice field: the list footer's count (spec §4.6) --------------------------------
/** Artboards 12/14/17 (`countLabel`): "{N} אפשרויות", or "{k} מתוך {N}" while a search filters;
 *  a single option: WORKER_UNDRAWN_TEXT.optionCountOne. */
export function choiceCountText(shown: number, total: number, searching: boolean): string {
  if (searching) return shown + " מתוך " + total;
  return total === 1 ? WORKER_UNDRAWN_TEXT.optionCountOne : total + " אפשרויות";
}

// ---- number field: the range line (spec §4.7) ---------------------------------------
/** Artboards 14 and 6 (`rangeWord`); each is followed by " · " and the range. */
export const RANGE_WORD = {
  /** Nothing typed yet (muted). */
  idle: "טווח מותר",
  /** A required field still empty after a save attempt (artboard 14 `tried`). */
  required: "יש להזין ערך",
  /** Text that does not read as a number. */
  nan: "יש להזין מספר",
  in: "בטווח",
  out: "מחוץ לטווח",
} as const;

/** Artboard 3 (`rangeLabel`): "עד {max} Ω" / "מעל {min} Ω" / "{min}–{max} Ω". */
const UP_TO = "עד ";
const ABOVE = "מעל ";
const DASH = "–";
const SEP = " · ";

export type RangeLineState = keyof typeof RANGE_WORD;

/** A run of the range text. `ltr` runs — a number with its unit — are isolated left-to-right. */
export type RangeSegment = { text: string; ltr?: true };

export type NumberRangeLine = {
  state: RangeLineState;
  /** RANGE_WORD[state]. */
  word: string;
  /** The field's range, or null when it defines none (a ref without tol_pct is not a range). */
  range: RangeSegment[] | null;
  /** The whole line to draw: word + " · " + range (the word alone when there is no range). */
  segments: RangeSegment[];
  /** The same line as plain text. */
  text: string;
  /** muted → --color-ink-muted-48, danger → --color-destructive, success → --color-success-ink. */
  tone: "muted" | "danger" | "success";
  /** "ok" = CircleCheck (in range); "alert" = CircleAlert (anything wrong). */
  icon: "ok" | "alert" | null;
  /** The input shows it too: a red edge and aria-invalid (artboard 14 `bad`). */
  invalid: boolean;
  /** False only when there is nothing to say: the field has no range and nothing is wrong. */
  visible: boolean;
};

/** "{value} {unit}" — the way failValueText writes a number (evaluate.ts). */
function withUnit(n: number, unit: string): string {
  return `${n}${unit ? " " + unit : ""}`;
}

/** The field's range as artboard 3 writes it, then — when the field has one — its reference ±
 *  tolerance (undrawn), joined " · ". null when the field defines no range at all. */
export function numberRangeForm(def: Pick<NumberField, "unit" | "min" | "max" | "ref" | "tol_pct">): RangeSegment[] | null {
  const unit = def.unit?.trim() ?? "";
  const { min, max, ref, tol_pct } = def;
  const parts: RangeSegment[][] = [];
  if (min != null && max != null) parts.push([{ text: `${min}${DASH}${withUnit(max, unit)}`, ltr: true }]);
  else if (max != null) parts.push([{ text: UP_TO }, { text: withUnit(max, unit), ltr: true }]);
  else if (min != null) parts.push([{ text: ABOVE }, { text: withUnit(min, unit), ltr: true }]);
  if (ref != null && tol_pct != null) {
    parts.push([
      { text: WORKER_UNDRAWN_TEXT.rangeRef + " " }, { text: withUnit(ref, unit), ltr: true },
      { text: SEP + WORKER_UNDRAWN_TEXT.rangeTolerance + " " }, { text: `±${tol_pct}%`, ltr: true },
    ]);
  }
  if (parts.length === 0) return null;
  return parts.flatMap((p, i) => (i === 0 ? p : [{ text: SEP }, ...p]));
}

/**
 * What the range line under a number field says (artboards 14 and 6), for the raw text as typed:
 *
 * | state    | when                                                    | tone    |
 * |----------|---------------------------------------------------------|---------|
 * | idle     | empty (or a number, when the field has no range)        | muted   |
 * | required | empty, required, and the worker already tried to save   | danger  |
 * | nan      | text that does not read as a number ("," reads as ".")  | danger  |
 * | in       | inside the range (numberInRange, inclusive)             | success |
 * | out      | outside it                                              | danger  |
 *
 * "out" is red whether or not the field counts it as a fail (out_of_range_fail): the line says
 * the value left the allowed range; only the suggestion and the row's fail look depend on the
 * switch (evaluate.ts isFieldFail).
 */
export function numberRangeLine(def: NumberField, raw: string | null | undefined, showRequiredError: boolean): NumberRangeLine {
  const range = numberRangeForm(def);
  let state: RangeLineState;
  if ((raw ?? "").trim() === "") {
    state = showRequiredError && def.required ? "required" : "idle";
  } else {
    const value = parseNumberText(raw);
    const inRange = value === null ? null : numberInRange(def, value);
    state = value === null ? "nan" : inRange === true ? "in" : inRange === false ? "out" : "idle";
  }
  const invalid = state === "required" || state === "nan" || state === "out";
  const word = RANGE_WORD[state];
  const segments: RangeSegment[] = range ? [{ text: word + SEP }, ...range] : [{ text: word }];
  return {
    state,
    word,
    range,
    segments,
    text: segments.map((s) => s.text).join(""),
    tone: state === "in" ? "success" : invalid ? "danger" : "muted",
    icon: state === "in" ? "ok" : invalid ? "alert" : null,
    invalid,
    visible: range !== null || invalid,
  };
}
