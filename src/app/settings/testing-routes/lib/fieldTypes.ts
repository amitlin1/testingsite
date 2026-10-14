import { FIELD_TYPES } from "@/app/lib/station-fields/schema";
import type { FieldType } from "@/app/lib/station-fields/schema";
import { FIELD_TYPE_GROUP_TEXT, FIELD_TYPE_TEXT } from "./labels";

/**
 * The field type picker's catalogue and search (artboard 3, spec §5.6). Pure: the picker
 * (components/editor/FieldTypePicker.tsx) draws what this returns.
 */

export type FieldTypeGroup = { key: keyof typeof FIELD_TYPE_GROUP_TEXT; name: string; types: FieldType[] };

/** The groups in artboard 3's order; together they hold every type of FIELD_TYPES once, in order. */
export const FIELD_TYPE_GROUPS: readonly FieldTypeGroup[] = [
  { key: "common", name: FIELD_TYPE_GROUP_TEXT.common, types: ["choice_row", "pass_fail"] },
  { key: "measure", name: FIELD_TYPE_GROUP_TEXT.measure, types: ["number", "text", "textarea"] },
  { key: "choice", name: FIELD_TYPE_GROUP_TEXT.choice, types: ["checklist", "multi_choice"] },
  { key: "record", name: FIELD_TYPE_GROUP_TEXT.record, types: ["photo", "scan"] },
  { key: "structure", name: FIELD_TYPE_GROUP_TEXT.structure, types: ["section"] },
];

/** The default type — "שורת בדיקה", the one with the "ברירת מחדל" tag. */
export const DEFAULT_FIELD_TYPE: FieldType = FIELD_TYPES[0];

/** Artboard 3's filter: a type matches when the trimmed query is part of its name or of its
 *  description (Latin letters case-insensitively). Groups left without a type are dropped; an
 *  empty query keeps everything. */
export function filterFieldTypes(query: string): FieldTypeGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return FIELD_TYPE_GROUPS.map((g) => ({ ...g, types: [...g.types] }));
  const out: FieldTypeGroup[] = [];
  for (const g of FIELD_TYPE_GROUPS) {
    const types = g.types.filter((t) => {
      const { name, desc } = FIELD_TYPE_TEXT[t];
      return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
    });
    if (types.length > 0) out.push({ ...g, types });
  }
  return out;
}

/** The visible types, top to bottom — the order the arrow keys walk. */
export function visibleTypes(groups: readonly FieldTypeGroup[]): FieldType[] {
  return groups.flatMap((g) => g.types);
}

/** The active row after an arrow key: `delta` +1 (down) / -1 (up), wrapping at either end. An
 *  active type that is no longer visible counts as "before the first". null when nothing shows. */
export function stepActiveType(list: readonly FieldType[], active: FieldType | null, delta: 1 | -1): FieldType | null {
  if (list.length === 0) return null;
  const at = active == null ? -1 : list.indexOf(active);
  if (at < 0) return delta === 1 ? list[0] : list[list.length - 1];
  return list[(at + delta + list.length) % list.length];
}

/** The active row to show: the current one while it is visible, else the first visible. */
export function activeTypeIn(list: readonly FieldType[], active: FieldType | null): FieldType | null {
  if (active != null && list.includes(active)) return active;
  return list[0] ?? null;
}
