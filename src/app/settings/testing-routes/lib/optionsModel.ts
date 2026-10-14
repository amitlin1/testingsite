import { TONES } from "@/app/lib/station-fields/schema";
import type { ChoiceOption, ChoiceRowField, MultiChoiceField, OptionId, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";

/**
 * The working copy of a choice field's options in the options popover (artboard 4, spec §5.7).
 * Pure: every function returns a new array and leaves its input alone, so the popover can drop
 * the copy on "ביטול" and hand it over on "החל על השדה".
 */

export type ChoiceField = ChoiceRowField | MultiChoiceField;

/** Keys 1–4 reach the first four options at the station (spec §4.6). */
export const QUICK_KEYS = 4;

/** The tone button's cycle (artboard 4): תקין ← אזהרה ← כשל ← ניטרלי, then back to תקין. */
export function nextTone(tone: Tone): Tone {
  return TONES[(TONES.indexOf(tone) + 1) % TONES.length];
}

/** The key box of the option at `index` (0-based): "1"–"4", then null ("–", no quick key). */
export function optionKey(index: number): string | null {
  return index >= 0 && index < QUICK_KEYS ? String(index + 1) : null;
}

/** Room for another option: a field holds at most LIMITS.options (12) — the shape check refuses
 *  more, so a draft save would fail. */
export function canAddOption(options: readonly ChoiceOption[]): boolean {
  return options.length < LIMITS.options;
}

/** A new option at the end (artboard 4 `addOpt`): the trimmed text, neutral. Blank text, or a full
 *  list, changes nothing. `newId` mints the option id (step-uids.ts newOptionId). */
export function addOption(options: readonly ChoiceOption[], text: string, newId: () => OptionId): ChoiceOption[] {
  const label = text.trim().slice(0, LIMITS.optionLabel);
  if (!label || !canAddOption(options)) return [...options];
  return [...options, { id: newId(), label, tone: "neutral" }];
}

/** The option at `index` renamed — as typed (trimming would eat the space between two words). */
export function renameOption(options: readonly ChoiceOption[], index: number, label: string): ChoiceOption[] {
  return options.map((o, i) => (i === index ? { ...o, label: label.slice(0, LIMITS.optionLabel) } : o));
}

/** The option at `index` moved one step along the tone cycle. */
export function cycleOptionTone(options: readonly ChoiceOption[], index: number): ChoiceOption[] {
  return options.map((o, i) => (i === index ? { ...o, tone: nextTone(o.tone) } : o));
}

/** The option at `index` removed. */
export function removeOption(options: readonly ChoiceOption[], index: number): ChoiceOption[] {
  return options.filter((_, i) => i !== index);
}

/** The option at `from` moved to position `to` (both 0-based; `to` is its index afterwards).
 *  Out-of-range indexes change nothing. */
export function moveOption(options: readonly ChoiceOption[], from: number, to: number): ChoiceOption[] {
  const out = [...options];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/** "החל על השדה" in local mode (spec §5.7): the field with these options and no list link — a
 *  local list is the field's own, so list_ref goes. */
export function applyLocalOptions<F extends ChoiceField>(field: F, options: readonly ChoiceOption[]): F {
  const next: F = { ...field, options: options.map((o) => ({ ...o })) };
  delete next.list_ref;
  return next;
}
