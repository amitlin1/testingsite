import { TONES } from "@/app/lib/station-fields/schema";
import type {
  ChoiceOption, ChoiceRowField, Field, InputField, MultiChoiceField, OptionId, RouteFieldsConfig, Tone,
} from "@/app/lib/station-fields/schema";
import { newOptionId } from "@/app/lib/station-fields/step-uids";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { EDITOR_TEXT } from "./labels";

/**
 * Fields by kind, and the options of a choice field: the edits the row chips and the options
 * popover make, and the link of a field to a shared option list (spec §5.7). Pure — every function
 * returns new values and leaves its input alone, except relinkListInConfig (it edits the copy
 * draftStore.edit hands out).
 */

// ---- kinds ----------------------------------------------------------------------------------------
/** Not a section header: a field the worker fills, which counts, takes a name and help. */
export const isInputField = (f: Field): f is InputField => f.type !== "section";

export const inputFields = (fields: readonly Field[]): InputField[] => fields.filter(isInputField);

/** A field with options: a choice row or a multi choice. */
export type OptionField = ChoiceRowField | MultiChoiceField;

export const isOptionField = (f: Field): f is OptionField => f.type === "choice_row" || f.type === "multi_choice";

// ---- an option list --------------------------------------------------------------------------------
/** Keys 1–4 reach the first four options at the station (spec §4.6). */
const QUICK_KEYS = 4;

/** The tone button's cycle (artboard 4): pass → warn → fail → neutral, then back. */
export function nextTone(tone: Tone): Tone {
  return TONES[(TONES.indexOf(tone) + 1) % TONES.length];
}

/** The quick key of the option at `index` (0-based): "1"–"4", then null (no quick key). */
export function optionKey(index: number): string | null {
  return index >= 0 && index < QUICK_KEYS ? String(index + 1) : null;
}

/** Room for another option: a field holds at most LIMITS.options — the shape check refuses more,
 *  so a draft save would fail. */
export function canAddOption(options: readonly ChoiceOption[]): boolean {
  return options.length < LIMITS.options;
}

/** A new neutral option at the end (artboard 4 `addOpt`): the trimmed text. Blank text, or a full
 *  list, changes nothing. */
export function appendOption(options: readonly ChoiceOption[], text: string, newId: () => OptionId): ChoiceOption[] {
  const label = text.trim().slice(0, LIMITS.optionLabel);
  if (!label || !canAddOption(options)) return [...options];
  return [...options, { id: newId(), label, tone: "neutral" }];
}

/** The option at `index` renamed — as typed (trimming would eat the space between two words). */
export function renameOptionAt(options: readonly ChoiceOption[], index: number, label: string): ChoiceOption[] {
  return options.map((o, i) => (i === index ? { ...o, label: label.slice(0, LIMITS.optionLabel) } : o));
}

export function setToneAt(options: readonly ChoiceOption[], index: number, tone: Tone): ChoiceOption[] {
  return options.map((o, i) => (i === index ? { ...o, tone } : o));
}

/** The option at `index` one step further along the tone cycle. */
export function cycleToneAt(options: readonly ChoiceOption[], index: number): ChoiceOption[] {
  const o = options[index];
  return o ? setToneAt(options, index, nextTone(o.tone)) : [...options];
}

export function removeOptionAt(options: readonly ChoiceOption[], index: number): ChoiceOption[] {
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

/** Two option lists alike: the same options (id, label, tone) in the same order. */
export function sameOptions(a: readonly ChoiceOption[], b: readonly ChoiceOption[]): boolean {
  return a.length === b.length && a.every((o, i) => o.id === b[i].id && o.label === b[i].label && o.tone === b[i].tone);
}

// ---- a field's options (artboard 2 rule: any change to an option unlinks the field from its list) --
/** The field with its own copy of these options and no list link. */
export function withOptions<F extends OptionField>(f: F, options: readonly ChoiceOption[]): F {
  const next: F = { ...f, options: options.map((o) => ({ ...o })) };
  delete next.list_ref;
  return next;
}

const indexOfOption = (f: OptionField, optionId: OptionId) => f.options.findIndex((o) => o.id === optionId);

export function renameOption<F extends OptionField>(f: F, optionId: OptionId, label: string): F {
  return withOptions(f, renameOptionAt(f.options, indexOfOption(f, optionId), label));
}

export function setOptionTone<F extends OptionField>(f: F, optionId: OptionId, tone: Tone): F {
  return withOptions(f, setToneAt(f.options, indexOfOption(f, optionId), tone));
}

export function removeOption<F extends OptionField>(f: F, optionId: OptionId): F {
  return withOptions(f, removeOptionAt(f.options, indexOfOption(f, optionId)));
}

/** The row's "+ אפשרות": a new neutral option named EDITOR_TEXT.newOption, at the end. */
export function addOption<F extends OptionField>(f: F, newId: () => OptionId = newOptionId): { field: F; optionId: OptionId } {
  const option: ChoiceOption = { id: newId(), label: EDITOR_TEXT.newOption, tone: "neutral" };
  return { field: withOptions(f, [...f.options, option]), optionId: option.id };
}

// ---- shared option lists ---------------------------------------------------------------------------
type ListVersion = { id: number; version: number; options: readonly ChoiceOption[] };

/** A field linked to a list (spec §5.7 "קישור השדה"): list_ref {id, ver} and a copy of its options. */
export function linkToList<F extends OptionField>(field: F, list: ListVersion): F {
  return { ...field, options: list.options.map((o) => ({ ...o })), list_ref: { id: list.id, ver: list.version } };
}

/**
 * A saved shared list reaching the linked fields of one working copy (spec §5.7: "השדות האחרים
 * המקושרים מתעדכנים בטיוטות שלהם"): every option field linked to the list takes its options and
 * list_ref.ver. Mutates `cfg`; returns how many fields changed.
 */
export function relinkListInConfig(cfg: RouteFieldsConfig, list: ListVersion): number {
  let changed = 0;
  for (const step of Object.values(cfg.steps)) {
    for (const group of step.groups) {
      group.fields = group.fields.map((f) => {
        if (!isOptionField(f) || f.list_ref?.id !== list.id) return f;
        if (f.list_ref.ver === list.version && sameOptions(f.options, list.options)) return f;
        changed += 1;
        return linkToList(f, list);
      });
    }
  }
  return changed;
}

/** The list a new "שורת בדיקה" links to, by its name (artboard 2). */
const DEFAULT_CHECK_LIST_NAME = "תקינות כללית";

export function findDefaultCheckList<L extends { name: string }>(lists: readonly L[] | null | undefined): L | null {
  return lists?.find((l) => l.name.trim() === DEFAULT_CHECK_LIST_NAME) ?? null;
}
