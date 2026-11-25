import type { NumberField } from "@/app/lib/station-fields/schema";
import { UNDRAWN_TEXT, FIELD_TYPE_TEXT, NUMBER_SUMMARY_TEXT } from "./labels";

/**
 * A number field's settings as the admin types and reads them (artboard 3, spec §5.6): parsing what
 * is typed into the settings, and the summary on the row's button. Pure.
 */

const DASH = "–";   // U+2013, artboard 3 `rangeShort`
const SEP = " · ";

export type NumberSettingKey = "min" | "max" | "ref" | "tol_pct";

// ---- typed text ----------------------------------------------------------------------------
/** A plain decimal, optionally signed: "5", "-0.5", ".5", "5." — no exponent, no hex, no spaces. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** The value of a number setting as typed: "" (or blanks) → undefined, the setting is not used;
 *  a decimal → its number (a "," reads as "." — spec §5.6); anything else → null, not a number. */
export function parseDecimalText(raw: string): number | undefined | null {
  const t = raw.trim().replace(/,/g, ".");
  if (t === "") return undefined;
  if (!DECIMAL.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A stored setting as the input shows it: "" when not set. */
export function formatDecimal(n: number | undefined): string {
  return n == null ? "" : String(n);
}

// ---- edits -----------------------------------------------------------------------------------
/** The field with one numeric setting set (a number) or removed (undefined). Removing the
 *  reference value removes the tolerance with it: tol_pct only exists next to ref (spec §2.2 — the
 *  shape check refuses a draft that has one without the other). */
export function withNumberSetting(field: NumberField, key: NumberSettingKey, value: number | undefined): NumberField {
  const next: NumberField = { ...field };
  if (value === undefined) delete next[key];
  else next[key] = value;
  if (key === "ref" && value === undefined) delete next.tol_pct;
  return next;
}

/** The field with its unit set; "" removes it. */
export function withUnit(field: NumberField, unit: string): NumberField {
  const next: NumberField = { ...field };
  if (unit === "") delete next.unit;
  else next.unit = unit;
  return next;
}

/** Minimum above maximum — one half of the lint's NUMBER_RANGE error (validate.ts). */
export function numberRangeInverted(field: Pick<NumberField, "min" | "max">): boolean {
  return field.min != null && field.max != null && field.min > field.max;
}

/** A negative tolerance — the other half of NUMBER_RANGE. */
export function toleranceNegative(field: Pick<NumberField, "tol_pct">): boolean {
  return field.tol_pct != null && field.tol_pct < 0;
}

// ---- the row's summary button ------------------------------------------------------------------
/** Artboard 3 `rangeShort`: "{min}–{max}" / "מקס׳ {max}" / "מינ׳ {min}" / "ללא טווח". A field limited
 *  only by a reference ± tolerance reads "ייחוס {ref} ±{tol}%" (undrawn) rather than "ללא טווח". */
export function numberRangeShort(field: Pick<NumberField, "min" | "max" | "ref" | "tol_pct">): string {
  const { min, max, ref, tol_pct } = field;
  if (min != null && max != null) return `${min}${DASH}${max}`;
  if (max != null) return NUMBER_SUMMARY_TEXT.maxShort + max;
  if (min != null) return NUMBER_SUMMARY_TEXT.minShort + min;
  if (ref != null && tol_pct != null) return `${UNDRAWN_TEXT.numberRefShort} ${ref} ±${tol_pct}%`;
  return NUMBER_SUMMARY_TEXT.noRange;
}

/** The summary button's parts (artboard 3): the unit (null without one), the short range, and the
 *  type's name. */
export function numberSummaryParts(field: NumberField): { unit: string | null; range: string; type: string } {
  const unit = field.unit?.trim() ? field.unit.trim() : null;
  return { unit, range: numberRangeShort(field), type: FIELD_TYPE_TEXT.number.name };
}

/** The summary as one line (artboard 3): "יחידה {unit} · {rangeShort} · מספר". A field without a
 *  unit leaves the first part out — "{rangeShort} · מספר" (no artboard draws a field without one). */
export function numberSummaryText(field: NumberField): string {
  const p = numberSummaryParts(field);
  return [...(p.unit != null ? [NUMBER_SUMMARY_TEXT.unitLead + p.unit] : []), p.range, p.type].join(SEP);
}
