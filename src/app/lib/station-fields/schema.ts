/**
 * Station fields — the fields a worker fills at each step of a testing route.
 * Types and constants of the route-fields spec §2.2 (config), §2.5 (result) and
 * §3.3 (worker read).
 *
 * A route (testing_routes = item_type_id + route_number) carries a config keyed by
 * STEP UID — never by array index. At run time a uid resolves through
 * testing_routes.step_uids (parallel to route_steps) to its position, so moving or
 * removing steps can never attach a config to the wrong station.
 *
 * Pure module: imported by the worker popups, the admin screen and the API alike —
 * no prisma, no next, no React, no Node-only APIs.
 */

// ---- primitives -------------------------------------------------------------
export const TONES = ["pass", "warn", "fail", "neutral"] as const;
export type Tone = (typeof TONES)[number];
/** Dot colours — the ONLY non-token colours allowed (decision 10). Always dot + word.
 *  In CSS use the --rf-tone-* tokens (spec §0.3); this map is for the pure module / tests only. */
export const TONE_DOT: Record<Tone, string> = { pass: "#1f8a5b", warn: "#d97706", fail: "#bf3535", neutral: "#9a9aa0" };
/** Words as in StationFieldEditor.dc.html ("סוג האפשרות"). */
export const TONE_WORD: Record<Tone, string> = { pass: "תקין", warn: "אזהרה", fail: "כשל", neutral: "ניטרלי" };

export const NOTES_MODES = ["off", "optional", "required_on_fail", "required"] as const;
export type NotesMode = (typeof NOTES_MODES)[number];
/** Admin labels — StationFieldEditor.dc.html script. Listbox order: optional, required_on_fail, required, off. */
export const NOTES_MODE_LABEL: Record<NotesMode, string> = { optional: "אופציונלי", required_on_fail: "חובה בכשל", required: "חובה", off: "ללא" };

/** "אורך מרבי" choices (NotesField.dc.html / StationFieldEditor.dc.html): 500 / 1000 / 2000, default 1000. */
export const NOTE_MAX_CHOICES = [500, 1000, 2000] as const;
export type NoteMax = (typeof NOTE_MAX_CHOICES)[number];
export const NOTE_MAX_DEFAULT: NoteMax = 1000;

export type StepUid = string;         // /^s_[a-z0-9]{8}$/
export type FieldId = string;         // /^f_[a-z0-9]{8}$/
export type OptionId = string;        // /^o_[a-z0-9]{8}$/
export type ChecklistItemId = string; // /^c_[a-z0-9]{8}$/

/** Every id is a prefix + 8 chars of [a-z0-9], minted once and never changed (step-uids.ts). */
export const ID_PATTERNS = {
  step: /^s_[a-z0-9]{8}$/,
  field: /^f_[a-z0-9]{8}$/,
  option: /^o_[a-z0-9]{8}$/,
  checklistItem: /^c_[a-z0-9]{8}$/,
} as const;

/** A link to a versioned library row: option_lists (list_ref) or field_sets (from_set). */
export interface VersionRef { id: number; ver: number }

export interface ChoiceOption { id: OptionId; label: string; tone: Tone }

// ---- fields -----------------------------------------------------------------
export interface FieldBase {
  id: FieldId;
  label: string;                 // "שם השדה"; ≤ 80 (empty allowed in a draft → lint error)
  help?: string;                 // "טקסט עזרה לעובד"; ≤ 200
  required: boolean;             // "חובה"
  notes: NotesMode;              // "הערות"
  note_max?: NoteMax;            // "אורך מרבי"; absent = 1000
  from_set?: VersionRef;         // linked to a field set (artboards 8/9)
}

export interface ChoiceRowField extends FieldBase {   // DEFAULT type — "שורת בדיקה"
  type: "choice_row";
  options: ChoiceOption[];       // 0..12 in a draft; keys 1–4 hit the first four
  list_ref?: VersionRef;         // "רשימה: <name>"; absent = "רשימה: מותאמת לשדה"
}
export interface PassFailField extends FieldBase { type: "pass_fail" }   // "תקין" / "לא תקין"
export interface NumberField extends FieldBase {
  type: "number";
  unit?: string;                 // "יחידה"; ≤ 12
  min?: number; max?: number;    // "מינימום" / "מקסימום"
  ref?: number;                  // "ערך ייחוס"
  tol_pct?: number;              // "סטייה מותרת ±%" — only with ref
  out_of_range_fail: boolean;    // 'ערך מחוץ לטווח נחשב "לא תקין"'
}
export interface TextField extends FieldBase { type: "text" }         // "טקסט קצר"
export interface TextareaField extends FieldBase { type: "textarea" } // "טקסט ארוך"
export interface ChecklistItem { id: ChecklistItemId; label: string }
export interface ChecklistField extends FieldBase {
  type: "checklist";             // "רשימת סימון"
  items: ChecklistItem[];        // ≤ 20
}
export interface MultiChoiceField extends FieldBase {
  type: "multi_choice";          // "בחירה מרובה"
  options: ChoiceOption[];
  list_ref?: VersionRef;
}
export interface PhotoField extends FieldBase {
  type: "photo";                 // "צילום"
  photo_type: string;            // photo_types.code
  min: number;                   // "מינ׳" — 0..20
}
export interface ScanField extends FieldBase { type: "scan" }         // "סריקה"
export interface SectionField {                                       // "כותרת מקטע"
  id: FieldId; type: "section"; label: string;
}

export type Field =
  | ChoiceRowField | PassFailField | NumberField | TextField | TextareaField
  | ChecklistField | MultiChoiceField | PhotoField | ScanField | SectionField;
export type FieldType = Field["type"];
/** Every field except a section header — what the worker actually fills. */
export type InputField = Exclude<Field, SectionField>;

/** All field types in the artboard-3 picker order ("סוג שדה אחר"). */
export const FIELD_TYPES = [
  "choice_row", "pass_fail", "number", "text", "textarea",
  "checklist", "multi_choice", "photo", "scan", "section",
] as const satisfies readonly FieldType[];

// ---- groups, steps, route ---------------------------------------------------
/** Who the fields are for. "item" only on per-item steps; the others only on package-level steps. */
export type GroupTarget = "item" | "box" | "each_item" | { item_type_id: number };

export interface FieldGroup { target: GroupTarget; fields: Field[] }

export interface StepConfig {
  uid: StepUid;
  /** Informational snapshot — resolution goes uid → step_uids index → route_steps. */
  station_type_id: number;
  station_label: string;
  /** Copied from test_stations_type.package_level when the step is edited. */
  scope: "package" | "item";
  groups: FieldGroup[];
  /** Phase 3 (artboard 7). Stored, not interpreted before phase 3. Reserved key for open decision #2:
   *  layout.fields_placement: "in_step" | "separate_step". */
  layout?: Record<string, unknown>;
}

export interface RouteFieldsConfig {
  schema: 1;
  steps: Record<StepUid, StepConfig>;
}

/** Stable key of a group target — one group per key in a step:
 *  "item" | "box" | "each_item" | "type:<item_type_id>". */
export function targetKey(t: GroupTarget): string {
  return typeof t === "string" ? t : `type:${t.item_type_id}`;
}

/** cfg.steps[uid], own keys only (a uid read from a DB row can never reach Object.prototype). */
export function stepConfigOf(cfg: RouteFieldsConfig, uid: string): StepConfig | undefined {
  return Object.prototype.hasOwnProperty.call(cfg.steps, uid) ? cfg.steps[uid] : undefined;
}

// ---- the saved result (test_results.details) ----------------------------------
/** Added next to the keys every popup already writes, only when the step had a published config. */
export interface FieldsSchemaRef {
  route_id: number;              // testing_routes.test_route_id whose version was used
  v: number;                     // route_field_versions.version
  step_uid: StepUid;
  /** What this row answered. "kit_item" = an item row at a package-level step:
   *  route_id is then the KIT route, and fields = each_item + its item_type group. */
  target: "item" | "box" | "kit_item";
}

/** label = the field label AT SAVE TIME, so a later rename never changes a saved result. */
type Snap = { label: string; note?: string };

export type FieldValue =
  | (Snap & { t: "choice_row"; opt: OptionId | null; opt_label: string | null; tone: Tone | null })
  | (Snap & { t: "multi_choice"; opts: { id: OptionId; label: string; tone: Tone }[] })
  | (Snap & { t: "pass_fail"; ok: "pass" | "fail" | null })
  | (Snap & { t: "number"; value: number | null; unit?: string; in_range: boolean | null })
  | (Snap & { t: "text" | "textarea" | "scan"; value: string })
  | (Snap & { t: "checklist"; items: { id: ChecklistItemId; label: string; ok: boolean }[] })
  | (Snap & { t: "photo"; photo_type: string; photos: string[] /* MinIO object keys, as PhotoStation does */ });

export interface FieldsVerdict {
  /** The worker's own decision when the popup has a verdict question
   *  (VerdictStation / PhotoStation / package-open wizard). Absent in PopUpTestDialog
   *  (decision stays in the numeric Result "תוצאת בדיקה") and on close-wizard item rows. */
  ok?: "pass" | "fail";
  note?: string;                 // VerdictStation keeps its existing note here
  /** Computed by evaluateFields() from tones; null when no value drives it. SERVER recomputes. */
  suggested: "pass" | "fail" | null;
  /** ok !== suggested (both set). Recorded, never blocking. */
  overridden?: boolean;
}

export interface FieldsResultBlock {
  schema: FieldsSchemaRef;
  fields: Record<FieldId, FieldValue>;   // filled fields only (evaluate.ts isBlankFieldValue); never sections
  verdict: FieldsVerdict;
}

// ---- worker read: GET /api/testing/station-fields?itemId= --------------------
/** A kit item's own groups at a package-level step. */
export type KitItemTarget = "each_item" | { item_type_id: number };
export interface KitItemGroup { target: KitItemTarget; fields: Field[] }

export interface KitItemFields {
  item_id: string;
  package_seq: number;
  item_type_id: number;
  item_type_desc: string;
  /** Kept separate so the popup can show "לכל פריט" and "שדות {type}" (artboard 16).
   *  Order: each_item first, then {item_type_id}. Empty groups omitted. */
  groups: KitItemGroup[];
}

export type StationFieldsResponse =
  | { mode: "legacy" }                                   // no config → today's popup, unchanged
  | { mode: "item";
      schema: FieldsSchemaRef;                           // target "item"
      fields: Field[];
      gate: boolean }                                    // = GATE_FINISH_ON_REQUIRED
  | { mode: "package";                                   // itemId is a KIT row at a package-level step
      schema: Omit<FieldsSchemaRef, "target">;           // kit route / kit version / kit step uid
      box: Field[];
      items: KitItemFields[];                            // every item of the kit, by package_seq
      gate: boolean };

// Issue lives in validate.ts (its one home); re-exported for type-only consumers.
export type { Issue, IssueCode, IssueLevel } from "./validate";
