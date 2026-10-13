import { noteRequired, requiredProgress } from "@/app/lib/station-fields/evaluate";
import type { DraftShot, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import { statusA, statusB, statusC, type StatusLine } from "@/app/lib/station-fields/labels";
import type { ChecklistItemId, Field, FieldId, InputField, KitItemFields, SectionField } from "@/app/lib/station-fields/schema";
import type { RangeSegment } from "./labels";
import { evaluateDrafts, patchDraft, type DraftPatch, type Drafts, type DraftsEvaluation, type FieldDraft } from "./useFieldsState";

/**
 * The field block's model (route-fields spec §4.4–§4.5): what each popup's block draws, the rows in
 * order with their separators, each row's state, the header status, and the artboards' words.
 * Pure — FieldsBlock.tsx and FieldRow.tsx draw from it; the layout metrics live in fields.css.
 *
 * | variant   | artboard / popup                      | status | typing | note        |
 * |-----------|---------------------------------------|--------|--------|-------------|
 * | station   | 12 VerdictStation                     | א      | yes    | row         |
 * | photo     | 13 PhotoStation                       | ב      | yes    | row         |
 * | dialog    | 14 PopUpTestDialog                    | ג      | yes    | row, legend |
 * | wizard    | 15 PackageOpenWizard, the box         | א      | yes    | row         |
 * | kit-item  | 16 PackageOpenWizard, an item         | א      | yes    | row         |
 * | pack-item | 17 PackageCloseWizard, under each item| —      | no     | row-compact |
 * | pack      | 18 PackageCloseWizard, the packing    | —      | no     | row-compact |
 */

export type FieldsBlockVariant = "station" | "photo" | "dialog" | "wizard" | "kit-item" | "pack";
/** "pack-item" is drawn by PackItemFields (artboard 17), one per kit item inside the kit card. */
export type FieldRowVariant = FieldsBlockVariant | "pack-item";

// ---- the artboards' words (each popup keeps its own artboard's wording, spec §4.4) -----------
/** Unicode isolates (LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE): invisible, they set a run
 *  left to right where no markup can — a placeholder. */
const LRI = "⁦";
const PDI = "⁩";

/** The list's search prompt: artboards 12, 15, 16 / 13, 14. "1–4" is isolated left to right, so the
 *  RTL placeholder never draws it "4–1" (spec §8.11); the visible text is the artboard's. */
export const CHOICE_PROMPT = { filterOrKeys: `הקלד לסינון או ${LRI}1–4${PDI}…`, filter: "הקלד לסינון…" } as const;
/** The list footer's key hint: artboards 12, 15, 16 / 13, 14 / 17, 18. */
export const CHOICE_HINT = { quick: "1–4 בחירה מהירה", enter: "1–4 · Enter בחירה", pick: "1–4 בחירה" } as const;

/** The note column (artboards 12–18 `ph`, `editorTitle`, the visually hidden label). */
export const NOTE_TEXT = {
  required: "פרט את החריגה…",
  failOptional: "פרט את החריגה (אופציונלי)",
  optional: "הערה (אופציונלי)",
} as const;
export const noteEditorTitle = (label: string): string => "הערה · " + label;
export const noteLabelText = (label: string): string => "הערה ל" + label;

/** The block's own words. */
export const BLOCK_TEXT = {
  /** The tag beside the count in every block (artboards 12–18, `markNew`; kept in production, spec §10.2). */
  tag: "מהגדרות המסלול",
  /** Artboard 16: the "each item" group, and the item type's ("שדות מסך"). */
  groupEach: "לכל פריט",
  groupTypePrefix: "שדות ",
  /** Artboard 17: an item that has not arrived and has no decision yet. */
  pending: "השדות יוצגו אחרי ההחלטה",
} as const;

/** Block titles (spec §4.4). VerdictStation / PhotoStation build theirs from the station type's
 *  name in the DB (stationBlockTitle) — never a station name in the code. */
export const BLOCK_TITLE = {
  dialog: "בדיקות העמדה",
  box: "בדיקות הקופסה",
  kitItem: "בדיקות הפריט",
  closing: "בדיקות בסגירה",
  packing: "בדיקות האריזה",
} as const;

/** "בדיקות {kind}" from the station type's name (stationTypeName); "בדיקות העמדה" without one. */
export function stationBlockTitle(kind: string | null | undefined): string {
  const k = kind?.trim();
  return k ? "בדיקות " + k : BLOCK_TITLE.dialog;
}

/** Drafts for text the block's artboards never draw. Listed in the PR under "טקסט לאישור"; do
 *  not treat as approved copy. */
export const BLOCK_COPY_PENDING = {
  // COPY-PENDING: the count of a block with a single field. Every artboard writes "{n} שדות"
  // (n ≥ 2 in all of them); "1 שדות" is not Hebrew.
  fieldCountOne: "שדה אחד",
} as const;

/** "{n} שדות" beside the title (artboards 12–18, `fieldCount`). */
export function fieldCountText(n: number): string {
  return n === 1 ? BLOCK_COPY_PENDING.fieldCountOne : n + " שדות";
}

// ---- per variant -------------------------------------------------------------------------------
export type VariantSpec = {
  /** The header status (spec §4.4): א (12, 15, 16), ב (13), ג (14), none (17, 18 — the next
   *  button says what is missing). */
  status: "A" | "B" | "C" | null;
  /** Typing filters the list; 17/18 are pick-only (a trigger and its list). */
  typeToFilter: boolean;
  placeholderOpen: string;
  footerHint: string;
  /** The note at rest: 44px (12–16) or 38px (17, 18). */
  note: "row" | "row-compact";
  /** "הערה · חובה" as a line above the box, with 20px on the other two columns (12, 13, 15–18),
   *  or as a legend on its border with the message as the placeholder (14). */
  noteLabel: "above" | "legend";
  /** A failing row's optional note asks "פרט את החריגה (אופציונלי)" (12–16); 17/18 never do. */
  failPlaceholder: boolean;
};

const OPEN_WIZARD: VariantSpec = {
  status: "A", typeToFilter: true, placeholderOpen: CHOICE_PROMPT.filterOrKeys, footerHint: CHOICE_HINT.quick,
  note: "row", noteLabel: "above", failPlaceholder: true,
};
const CLOSE_WIZARD: VariantSpec = {
  status: null, typeToFilter: false, placeholderOpen: "", footerHint: CHOICE_HINT.pick,
  note: "row-compact", noteLabel: "above", failPlaceholder: false,
};

export const VARIANT_SPEC: Record<FieldRowVariant, VariantSpec> = {
  station: OPEN_WIZARD,
  photo: { ...OPEN_WIZARD, status: "B", placeholderOpen: CHOICE_PROMPT.filter, footerHint: CHOICE_HINT.enter },
  dialog: { ...OPEN_WIZARD, status: "C", placeholderOpen: CHOICE_PROMPT.filter, footerHint: CHOICE_HINT.enter, noteLabel: "legend" },
  wizard: OPEN_WIZARD,
  "kit-item": OPEN_WIZARD,
  "pack-item": CLOSE_WIZARD,
  pack: CLOSE_WIZARD,
};

/** The note's placeholder (artboards 12–18 `ph`). */
export function notePlaceholder(variant: FieldRowVariant, required: boolean, isFail: boolean): string {
  if (required) return NOTE_TEXT.required;
  return isFail && VARIANT_SPEC[variant].failPlaceholder ? NOTE_TEXT.failOptional : NOTE_TEXT.optional;
}

/** The header status line (statusA / statusB / statusC, src/app/lib/station-fields/labels.ts), or
 *  null where the artboard draws none. */
export function blockStatus(
  variant: FieldRowVariant,
  defs: readonly Field[],
  ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes">,
): StatusLine | null {
  const kind = VARIANT_SPEC[variant].status;
  if (kind === "A") return statusA(ev.missingRequired.length, ev.missingNotes.length);
  if (kind === null) return null;
  const { done, total } = requiredProgress(defs, ev);
  return kind === "B" ? statusB(done, total, ev.missingNotes.length) : statusC(done, total, ev.missingNotes.length);
}

/** "{done} / {total}" inside a status line (status ב, artboard 13). */
const RATIO = /(\d+ \/ \d+)/;

/**
 * A status line in runs, its "{done} / {total}" ratio isolated left to right — as one RTL string,
 * "2 / 3 שדות חובה" was drawn "3 / 2". Spec §0.3 sets numbers left to right, and artboard 13 sets
 * its other ratio, the photo count, that way (`<bdi dir="ltr">{{shotRatio}}</bdi>`). The text is
 * unchanged.
 */
export function statusRuns(text: string): RangeSegment[] {
  return text.split(RATIO).flatMap((part, i): RangeSegment[] => {
    if (part === "") return [];
    return i % 2 === 1 ? [{ text: part, ltr: true }] : [{ text: part }];
  });
}

// ---- the state a block draws from ----------------------------------------------------------------
/** What FieldsBlock needs of the values: useFieldsState() as it is, or draftsFieldsState() over
 *  drafts the host keeps itself. */
export type FieldsBlockState = {
  drafts: Readonly<Drafts>;
  ev: Pick<FieldsEvaluation, "fails" | "missingRequired" | "missingNotes">;
  set: (id: FieldId, patch: DraftPatch) => void;
};

/** draftsFieldsState's answer: the block's state, with the gate. */
export type DraftsFieldsState = FieldsBlockState & DraftsEvaluation;

/**
 * The block's state over drafts a host keeps in its own state — the package wizards keep each kit
 * item's drafts with the item's other work (spec §4.11.3–§4.11.5). `update` receives a function
 * from the drafts as they are to the next ones; run it inside a functional setState, e.g.
 *
 *   draftsFieldsState(defs, work.fields, (next) =>
 *     setWork((all) => ({ ...all, [id]: { ...all[id], fields: next(all[id].fields) } })))
 *
 * Also returns evaluateDrafts' photosPending and blocking(gate) for the host's next button.
 */
export function draftsFieldsState(
  defs: readonly Field[],
  drafts: Readonly<Drafts>,
  update: (next: (drafts: Drafts) => Drafts) => void,
): DraftsFieldsState {
  return { drafts, set: (id, patch) => update((d) => patchDraft(d, id, patch)), ...evaluateDrafts(defs, drafts) };
}

// ---- groups and rows -----------------------------------------------------------------------------
export type FieldsBlockGroup = {
  /** The group label: drawn for every group of a kit item (artboard 16), even a lone one. */
  mini?: string;
  icon?: "each" | "type";
  fields: readonly Field[];
};

/** A kit item's groups as artboard 16 labels them: "לכל פריט", then "שדות {item type}". */
export function kitItemFieldGroups(item: KitItemFields | undefined): FieldsBlockGroup[] {
  if (!item) return [];
  return item.groups.map((g) => (g.target === "each_item"
    ? { mini: BLOCK_TEXT.groupEach, icon: "each" as const, fields: g.fields }
    : { mini: BLOCK_TEXT.groupTypePrefix + item.item_type_desc, icon: "type" as const, fields: g.fields }));
}

/** Every field of the groups, in order. */
export const groupFields = (groups: readonly FieldsBlockGroup[]): Field[] => groups.flatMap((g) => g.fields);

/** One line of the block's card, in order. `rule` = a 1px line above it. */
export type BlockItem =
  | { kind: "mini"; group: number; text: string; icon: "each" | "type" | undefined; rule: boolean }
  | { kind: "section"; group: number; def: SectionField; rule: boolean }
  | { kind: "field"; group: number; def: InputField; rule: boolean; inMini: boolean };

/**
 * The card's lines with their separators, as the artboards draw them: a line between two field
 * rows; none under a group label (15, 16) or a section title (6); a line above every group label
 * and section title but the first.
 */
export function blockItems(groups: readonly FieldsBlockGroup[]): BlockItem[] {
  const out: BlockItem[] = [];
  let prev: BlockItem["kind"] | null = null;
  groups.forEach((g, group) => {
    if (g.mini) {
      out.push({ kind: "mini", group, text: g.mini, icon: g.icon, rule: prev !== null });
      prev = "mini";
    }
    for (const def of g.fields) {
      if (def.type === "section") out.push({ kind: "section", group, def, rule: prev !== null });
      else out.push({ kind: "field", group, def, rule: prev === "field", inMini: !!g.mini });
      prev = def.type === "section" ? "section" : "field";
    }
  });
  return out;
}

/** The ids of a row's control and note (spec §4.4: `${idPrefix}-c-${id}` / `-n-`). */
export function fieldRowIds(idPrefix: string, id: FieldId): { control: string; note: string } {
  return { control: `${idPrefix}-c-${id}`, note: `${idPrefix}-n-${id}` };
}

export type RowState = {
  /** A fail value: the row turns --color-danger-bg (spec §4.5). */
  isFail: boolean;
  /** notes "required", or "required_on_fail" while failing: "הערה · חובה". Never with notes "off". */
  noteRequired: boolean;
  /** The required note is still blank — "יש לפרט את החריגה" at once, in every popup (spec §4.3).
   *  A field still missing its value counts once, as missingRequired (evaluate.ts). */
  noteError: boolean;
  /** A required field still empty after a save attempt (artboard 14 `tried`): "יש לבחור ערך",
   *  "יש להזין ערך · …", or the red pass / fail pair. */
  showRequiredError: boolean;
};

export function rowState(
  def: InputField,
  ev: Pick<FieldsEvaluation, "fails" | "missingRequired" | "missingNotes">,
  showRequiredErrors: boolean,
): RowState {
  const isFail = ev.fails.some((f) => f.field_id === def.id);
  return {
    isFail,
    noteRequired: def.notes !== "off" && noteRequired(def, isFail),
    noteError: ev.missingNotes.includes(def.id),
    showRequiredError: showRequiredErrors && ev.missingRequired.includes(def.id),
  };
}

/** Types whose one control a <label htmlFor> can name; the rest (pass_fail, checklist, photo) are
 *  groups named by the field's label through aria-labelledby (spec §4.5). */
export function hasLabelledControl(type: InputField["type"]): boolean {
  return type !== "pass_fail" && type !== "checklist" && type !== "photo";
}

/** text / textarea / scan values (spec appendix א, FieldValue: value ≤ 2000). */
export const TEXT_VALUE_MAX = 2000;

/** Whether a checklist item is ticked in the draft (own keys only). */
export function isItemChecked(draft: FieldDraft | undefined, itemId: ChecklistItemId): boolean {
  const checked = draft?.checked;
  return checked != null && Object.prototype.hasOwnProperty.call(checked, itemId) && checked[itemId] === true;
}

// ---- draft changes that read the draft as it is when they land (DraftPatch) ----------------------
/** A checklist item ticked or unticked. */
export function toggleChecklistItem(itemId: ChecklistItemId): (draft: FieldDraft | undefined) => Partial<FieldDraft> {
  return (draft) => ({ checked: { ...draft?.checked, [itemId]: !isItemChecked(draft, itemId) } });
}

/** A shot added while it uploads (stationKit PhotoUploader's lifecycle, as PhotoStation runs it). */
export function addShot(previewUrl: string): (draft: FieldDraft | undefined) => Partial<FieldDraft> {
  return (draft) => ({ photos: [...(draft?.photos ?? []), { previewUrl, uploading: true }] });
}

/** The upload of one shot ended: its object key, or failed (null) — a failed shot blocks until the
 *  worker removes it (evaluate.ts pendingPhotos). A shot removed meanwhile stays removed. */
export function settleShot(previewUrl: string, objectKey: string | null): (draft: FieldDraft | undefined) => Partial<FieldDraft> {
  return (draft) => ({
    photos: (draft?.photos ?? []).map((s: DraftShot) => (s.previewUrl === previewUrl
      ? { ...s, objectKey: objectKey ?? undefined, uploading: false, failed: objectKey == null }
      : s)),
  });
}

/** The shot at `index` removed. */
export function removeShot(index: number): (draft: FieldDraft | undefined) => Partial<FieldDraft> {
  return (draft) => ({ photos: (draft?.photos ?? []).filter((_, i) => i !== index) });
}
