import { FIELD_TYPES, ID_PATTERNS, NOTES_MODES, NOTE_MAX_CHOICES, TONES, targetKey } from "./schema";
import type {
  ChecklistItem, ChecklistItemId, ChoiceOption, Field, FieldGroup, FieldId, FieldType, GroupTarget, OptionId,
  RouteFieldsConfig, StepConfig, StepUid, VersionRef,
} from "./schema";
import { COPY_PENDING, LINT_TEXT, optionsOkText } from "./labels";

/**
 * Validation without zod (route-fields spec §2.3), shared by the editor and the API.
 *
 * - parseRouteFieldsConfig — STRUCTURE. Throws ShapeError on anything the editor could never
 *   produce (every endpoint that accepts a config answers 400). Returns a sanitized deep copy:
 *   only known keys survive, so nothing a client smuggles in reaches the database.
 * - lintRouteFieldsConfig — CONTENT, at the levels the artboards draw: an error blocks publish
 *   (never a draft save), a warning never blocks.
 * - checkConfigAgainstRoute — the config against the live route_steps / step_uids.
 */

export type IssueLevel = "error" | "warning";
export type IssueCode =
  | "FIELD_LABEL_EMPTY"
  | "OPTION_LABEL_EMPTY"
  | "OPTIONS_EMPTY"
  | "OPTIONS_TOO_MANY"
  | "OPTIONS_TOO_FEW"
  | "OPTIONS_NO_FAIL"
  | "DUPLICATE_LABEL_IN_CELL"
  | "NUMBER_RANGE"
  | "CHECKLIST_EMPTY"
  | "CHECKLIST_ITEM_LABEL_EMPTY"
  | "PHOTO_TYPE_EMPTY"
  | "STEP_SCOPE_MISMATCH"
  | "STEP_UNKNOWN";

/** One lint finding. step_uid / target / field_id / option_id / item_id say where, so the map and
 *  the editor can point at the exact cell, row, option and checklist item. */
export type Issue = {
  level: IssueLevel;
  code: IssueCode;
  step_uid?: StepUid;
  target?: GroupTarget;
  field_id?: FieldId;
  option_id?: OptionId;
  item_id?: ChecklistItemId;
  message: string;               // Hebrew — labels.ts (artboard text, or COPY_PENDING)
};

/** Hard limits of the shape check. The editor stays inside them; anything beyond is a ShapeError. */
export const LIMITS = {
  configJson: 512_000,           // JSON.stringify(config).length
  fieldsPerList: 60,             // fields in one group / one field set
  options: 12,                   // a draft may hold 0..12 (lint warns above 6)
  checklistItems: 20,
  fieldLabel: 80,
  optionLabel: 60,
  checklistLabel: 80,
  help: 200,
  unit: 12,
  stationLabel: 50,              // test_stations_type.test_type_desc is CHAR(50)
  photoType: 50,                 // photo_types.code is VARCHAR(50)
  photoMin: 20,
  layoutDepth: 32,
} as const;

/** Structural parse failure — mapped to HTTP 400 by every endpoint that accepts a config. */
export class ShapeError extends Error {
  readonly code = "SHAPE_INVALID";
  readonly path: string;
  constructor(path: string, msg: string) {
    super(`${path}: ${msg}`);
    this.name = "ShapeError";
    this.path = path;
  }
}

// ---- helpers ------------------------------------------------------------------
type Obj = Record<string, unknown>;

/** A JSON object: not null, not an array, no exotic prototype. */
function isPlainObj(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
/** Own property only — never a value inherited from a (possibly polluted) prototype. */
function own(o: Obj, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}
/** An optional key: absent and null both mean "not set". */
function optional(o: Obj, k: string): unknown {
  const v = own(o, k);
  return v === null ? undefined : v;
}
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string | number>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const describe = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v.slice(0, 32)) : typeof v);

function assertJsonSize(raw: unknown, p: string): void {
  let size: number;
  try {
    size = JSON.stringify(raw)?.length ?? 0;
  } catch {
    throw new ShapeError(p, "not JSON");
  }
  if (size > LIMITS.configJson) throw new ShapeError(p, "config too large");
}

/** Keys that could reach an object's prototype when copied with plain assignment. */
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep copy of free-form JSON (step.layout): verbatim, minus prototype keys. */
function copyJson(v: unknown, p: string, depth: number): unknown {
  if (depth > LIMITS.layoutDepth) throw new ShapeError(p, "too deep");
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ShapeError(p, "not JSON");
    return v;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) out.push(v[i] === undefined ? null : copyJson(v[i], `${p}[${i}]`, depth + 1));
    return out;
  }
  if (isPlainObj(v)) {
    const out: Obj = {};
    for (const k of Object.keys(v)) {
      if (BLOCKED_KEYS.has(k) || v[k] === undefined) continue;
      out[k] = copyJson(v[k], `${p}.${k}`, depth + 1);
    }
    return out;
  }
  throw new ShapeError(p, "not JSON");
}

// ---- structure ----------------------------------------------------------------
/** Structural parse: throws ShapeError on anything the editor could never produce, and returns a
 *  sanitized deep copy (known keys only; step.layout kept as is, minus prototype keys). */
export function parseRouteFieldsConfig(raw: unknown): RouteFieldsConfig {
  if (!isPlainObj(raw) || own(raw, "schema") !== 1 || !isPlainObj(own(raw, "steps"))) {
    throw new ShapeError("$", "expected {schema:1, steps:{}}");
  }
  assertJsonSize(raw, "$");
  const rawSteps = own(raw, "steps") as Obj;
  const steps: Record<StepUid, StepConfig> = {};
  for (const uid of Object.keys(rawSteps)) {
    const step = parseStep(uid, rawSteps[uid], `$.steps.${uid}`);
    steps[uid] = step;
  }
  return { schema: 1, steps };
}

/** field_sets.fields — the same per-field checks as a config group (ids unique in the list). */
export function parseFieldList(raw: unknown, path = "$"): Field[] {
  if (!Array.isArray(raw)) throw new ShapeError(path, "expected an array of fields");
  if (raw.length > LIMITS.fieldsPerList) throw new ShapeError(path, "too many fields");
  assertJsonSize(raw, path);
  const seen = new Set<string>();
  const out: Field[] = [];
  for (let i = 0; i < raw.length; i++) out.push(parseField(raw[i], `${path}[${i}]`, seen));
  return out;
}

/** option_lists.options — the same checks as a field's options (0..12, unique o_ ids). */
export function parseOptionList(raw: unknown, path = "$"): ChoiceOption[] {
  return parseOptions(raw, path);
}

function parseStep(uid: string, s: unknown, p: string): StepConfig {
  if (!ID_PATTERNS.step.test(uid)) throw new ShapeError(p, "bad step uid");
  if (!isPlainObj(s) || own(s, "uid") !== uid) throw new ShapeError(p, "uid mismatch");
  const stationTypeId = own(s, "station_type_id");
  const stationLabel = own(s, "station_label");
  if (!isInt(stationTypeId) || !isStr(stationLabel, LIMITS.stationLabel)) throw new ShapeError(p, "station");
  const scope = own(s, "scope");
  if (scope !== "package" && scope !== "item") throw new ShapeError(p, "scope");
  const rawGroups = own(s, "groups");
  if (!Array.isArray(rawGroups)) throw new ShapeError(p, "groups");
  const fieldIds = new Set<string>();   // field ids are unique per step, across its groups
  const targets = new Set<string>();    // one group per target
  const groups: FieldGroup[] = [];
  for (let i = 0; i < rawGroups.length; i++) {
    groups.push(parseGroup(rawGroups[i], scope, `${p}.groups[${i}]`, fieldIds, targets));
  }
  const step: StepConfig = { uid, station_type_id: stationTypeId, station_label: stationLabel, scope, groups };
  const layout = optional(s, "layout");
  if (layout !== undefined) {
    if (!isPlainObj(layout)) throw new ShapeError(p, "layout");
    step.layout = copyJson(layout, `${p}.layout`, 0) as Record<string, unknown>;
  }
  return step;
}

function parseTarget(t: unknown, scope: "package" | "item", p: string): GroupTarget {
  if (scope === "item") {
    if (t !== "item") throw new ShapeError(p, "per-item step accepts target 'item' only");
    return "item";
  }
  if (t === "box" || t === "each_item") return t;
  if (isPlainObj(t)) {
    const itemTypeId = own(t, "item_type_id");
    if (isInt(itemTypeId)) return { item_type_id: itemTypeId };
  }
  throw new ShapeError(p, "package step target");
}

function parseGroup(g: unknown, scope: "package" | "item", p: string, fieldIds: Set<string>, targets: Set<string>): FieldGroup {
  if (!isPlainObj(g)) throw new ShapeError(p, "group");
  const rawFields = own(g, "fields");
  if (!Array.isArray(rawFields)) throw new ShapeError(p, "group");
  const target = parseTarget(own(g, "target"), scope, `${p}.target`);
  const key = targetKey(target);
  // Package step: at most one box, one each_item and one group per item type; item step: one "item".
  if (targets.has(key)) throw new ShapeError(`${p}.target`, `duplicate target ${key}`);
  targets.add(key);
  if (rawFields.length > LIMITS.fieldsPerList) throw new ShapeError(p, "too many fields");
  const fields: Field[] = [];
  for (let i = 0; i < rawFields.length; i++) fields.push(parseField(rawFields[i], `${p}.fields[${i}]`, fieldIds));
  return { target, fields };
}

function parseRef(v: unknown, p: string): VersionRef {
  if (!isPlainObj(v)) throw new ShapeError(p, "ref");
  const id = own(v, "id");
  const ver = own(v, "ver");
  if (!isPosInt(id) || !isPosInt(ver)) throw new ShapeError(p, "ref");
  return { id, ver };
}

function parseOptions(opts: unknown, p: string): ChoiceOption[] {
  // 0..12: a draft may be mid-edit; <2 is a lint WARNING (artboard 4), 0 is a publish error.
  if (!Array.isArray(opts) || opts.length > LIMITS.options) throw new ShapeError(p, "0..12 options");
  const ids = new Set<string>();
  const out: ChoiceOption[] = [];
  for (let i = 0; i < opts.length; i++) {
    const o: unknown = opts[i];
    const at = `${p}[${i}]`;
    if (!isPlainObj(o)) throw new ShapeError(at, "option");
    const id = own(o, "id");
    if (typeof id !== "string" || !ID_PATTERNS.option.test(id) || ids.has(id)) throw new ShapeError(at, "option id");
    const label = own(o, "label");
    const tone = own(o, "tone");
    if (!isStr(label, LIMITS.optionLabel) || !oneOf(TONES, tone)) throw new ShapeError(at, "option");
    ids.add(id);
    out.push({ id, label, tone });
  }
  return out;
}

function parseChecklistItems(items: unknown, p: string): ChecklistItem[] {
  if (!Array.isArray(items) || items.length > LIMITS.checklistItems) throw new ShapeError(p, "items");
  const ids = new Set<string>();
  const out: ChecklistItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it: unknown = items[i];
    const at = `${p}[${i}]`;
    if (!isPlainObj(it)) throw new ShapeError(at, "item");
    const id = own(it, "id");
    if (typeof id !== "string" || !ID_PATTERNS.checklistItem.test(id) || ids.has(id)) throw new ShapeError(at, "item id");
    const label = own(it, "label");
    if (!isStr(label, LIMITS.checklistLabel)) throw new ShapeError(at, "item label");
    ids.add(id);
    out.push({ id, label });
  }
  return out;
}

function parseField(f: unknown, p: string, seen: Set<string>): Field {
  if (!isPlainObj(f)) throw new ShapeError(p, "field");
  const id = own(f, "id");
  if (typeof id !== "string" || !ID_PATTERNS.field.test(id) || seen.has(id)) throw new ShapeError(p, "field id (unique per step)");
  seen.add(id);
  const type = own(f, "type");
  if (!oneOf<FieldType>(FIELD_TYPES, type)) throw new ShapeError(p, `unknown type ${describe(type)}`);
  const label = own(f, "label");
  if (!isStr(label, LIMITS.fieldLabel)) throw new ShapeError(p, "label");
  if (type === "section") return { id, type, label };

  const required = own(f, "required");
  if (typeof required !== "boolean") throw new ShapeError(p, "required");
  const notes = own(f, "notes");
  if (!oneOf(NOTES_MODES, notes)) throw new ShapeError(p, "notes");
  const noteMax = optional(f, "note_max");
  if (noteMax !== undefined && !oneOf(NOTE_MAX_CHOICES, noteMax)) throw new ShapeError(p, "note_max");
  const help = optional(f, "help");
  if (help !== undefined && !isStr(help, LIMITS.help)) throw new ShapeError(p, "help");
  const fromSetRaw = optional(f, "from_set");
  const fromSet = fromSetRaw === undefined ? undefined : parseRef(fromSetRaw, `${p}.from_set`);
  // Keys in FieldBase order; the type's own keys follow.
  const head = <T extends FieldType>(t: T) => ({
    id, type: t, label,
    ...(help !== undefined ? { help } : {}),
    required, notes,
    ...(noteMax !== undefined ? { note_max: noteMax } : {}),
    ...(fromSet !== undefined ? { from_set: fromSet } : {}),
  });

  switch (type) {
    case "choice_row":
    case "multi_choice": {
      const options = parseOptions(own(f, "options"), `${p}.options`);
      const listRefRaw = optional(f, "list_ref");
      const listRef = listRefRaw === undefined ? {} : { list_ref: parseRef(listRefRaw, `${p}.list_ref`) };
      return type === "choice_row"
        ? { ...head(type), options, ...listRef }
        : { ...head(type), options, ...listRef };
    }
    case "number": {
      const unit = optional(f, "unit");
      if (unit !== undefined && !isStr(unit, LIMITS.unit)) throw new ShapeError(p, "unit");
      const num = (k: "min" | "max" | "ref" | "tol_pct"): number | undefined => {
        const v = optional(f, k);
        if (v !== undefined && !isNum(v)) throw new ShapeError(p, k);
        return v;
      };
      const min = num("min");
      const max = num("max");
      const ref = num("ref");
      const tol = num("tol_pct");
      if (tol !== undefined && ref === undefined) throw new ShapeError(p, "tol_pct needs ref");
      const oor = own(f, "out_of_range_fail");
      if (typeof oor !== "boolean") throw new ShapeError(p, "out_of_range_fail");
      return {
        ...head(type),
        ...(unit !== undefined ? { unit } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(ref !== undefined ? { ref } : {}),
        ...(tol !== undefined ? { tol_pct: tol } : {}),
        out_of_range_fail: oor,
      };
    }
    case "checklist":
      return { ...head(type), items: parseChecklistItems(own(f, "items"), `${p}.items`) };
    case "photo": {
      const photoType = own(f, "photo_type");
      const min = own(f, "min");
      if (!isStr(photoType, LIMITS.photoType) || !isInt(min) || min < 0 || min > LIMITS.photoMin) throw new ShapeError(p, "photo");
      return { ...head(type), photo_type: photoType, min };
    }
    case "pass_fail":
    case "text":
    case "textarea":
    case "scan":
      return { ...head(type) };
  }
}

// ---- content --------------------------------------------------------------------
/** Publish-time checks (errors block publish, warnings don't). Pure; runs in the editor too. */
export function lintRouteFieldsConfig(cfg: RouteFieldsConfig): Issue[] {
  const out: Issue[] = [];
  for (const step of Object.values(cfg.steps)) {
    // A kit item's card shows the each_item group next to its own item-type group (spec §4.11.3),
    // so an item-type group must not repeat an each_item name either (§5.10). The box is a card
    // of its own.
    const eachItem = step.scope === "package" ? step.groups.find((g) => g.target === "each_item")?.fields ?? [] : [];
    for (const g of step.groups) {
      const alongside = typeof g.target === "object" ? eachItem : [];
      out.push(...lintFields(g.fields, { step_uid: step.uid, target: g.target }, alongside));
    }
  }
  return out;
}

/** The names a new field must not repeat: the trimmed, non-blank labels of a list's input fields
 *  (section headers aside). DUPLICATE_LABEL_IN_CELL compares against these; so do the apply-set
 *  and paste skips (spec §5.10, §5.14) — for an item-type cell, its own fields plus each_item's. */
export function takenLabels(fields: readonly Field[]): Set<string> {
  const names = new Set<string>();
  for (const f of fields) {
    const name = f.label.trim();
    if (f.type !== "section" && name) names.add(name);
  }
  return names;
}

/** The per-cell checks of lintRouteFieldsConfig on one field list (a group, or a field set).
 *  `alongside`: fields the worker sees on the same card ahead of this list (each_item ahead of an
 *  item-type group); repeating one of their names is a duplicate as well. */
export function lintFields(
  fields: readonly Field[],
  at: { step_uid?: StepUid; target?: GroupTarget } = {},
  alongside: readonly Field[] = [],
): Issue[] {
  const out: Issue[] = [];
  const names = takenLabels(alongside);
  for (const f of fields) {
    // A section header only divides the rows: artboard 2 neither counts it (`isField`) nor shows
    // an error under it, whatever its name.
    if (f.type === "section") continue;
    const loc = { ...at, field_id: f.id };
    const name = f.label.trim();
    if (!name) {
      out.push({ level: "error", code: "FIELD_LABEL_EMPTY", ...loc, message: LINT_TEXT.fieldLabelEmpty });
    } else {
      if (names.has(name)) out.push({ level: "warning", code: "DUPLICATE_LABEL_IN_CELL", ...loc, message: COPY_PENDING.duplicateLabel });
      names.add(name);
    }
    if (f.type === "choice_row" || f.type === "multi_choice") {
      for (const o of f.options) {
        if (!o.label.trim()) {
          out.push({ level: "error", code: "OPTION_LABEL_EMPTY", ...loc, option_id: o.id, message: LINT_TEXT.optionLabelEmpty });
        }
      }
      // The count checks in exactly the order of artboard 4's validation line.
      const n = f.options.length;
      const fails = f.options.filter((o) => o.tone === "fail").length;
      if (n === 0) out.push({ level: "error", code: "OPTIONS_EMPTY", ...loc, message: COPY_PENDING.optionsEmpty });
      else if (n > 6) out.push({ level: "warning", code: "OPTIONS_TOO_MANY", ...loc, message: LINT_TEXT.optionsTooMany });
      else if (n < 2) out.push({ level: "warning", code: "OPTIONS_TOO_FEW", ...loc, message: LINT_TEXT.optionsTooFew });
      else if (fails === 0) out.push({ level: "warning", code: "OPTIONS_NO_FAIL", ...loc, message: LINT_TEXT.optionsNoFail });
    }
    // A checklist with nothing to tick, or with an unnamed box, and a photo field without a photo
    // type cannot be filled in as meant; the shape check lets them through as draft states.
    if (f.type === "checklist") {
      for (const it of f.items) {
        if (!it.label.trim()) {
          out.push({ level: "error", code: "CHECKLIST_ITEM_LABEL_EMPTY", ...loc, item_id: it.id, message: COPY_PENDING.checklistItemLabelEmpty });
        }
      }
      if (f.items.length === 0) out.push({ level: "error", code: "CHECKLIST_EMPTY", ...loc, message: COPY_PENDING.checklistEmpty });
    }
    if (f.type === "photo" && !f.photo_type.trim()) {
      out.push({ level: "error", code: "PHOTO_TYPE_EMPTY", ...loc, message: COPY_PENDING.photoTypeEmpty });
    }
    if (f.type === "number") {
      const inverted = f.min != null && f.max != null && f.min > f.max;
      const negativeTolerance = f.tol_pct != null && f.tol_pct < 0;
      if (inverted || negativeTolerance) out.push({ level: "error", code: "NUMBER_RANGE", ...loc, message: COPY_PENDING.numberRange });
    }
  }
  return out;
}

/** Artboard 4's single validation line under an option list — first match wins, in the
 *  artboard's order (an empty option outranks the count checks). */
export function optionListLine(options: readonly ChoiceOption[]): { level: "ok" | IssueLevel; text: string } {
  const n = options.length;
  const fails = options.filter((o) => o.tone === "fail").length;
  if (options.some((o) => !o.label.trim())) return { level: "error", text: LINT_TEXT.optionLabelEmpty };
  if (n > 6) return { level: "warning", text: LINT_TEXT.optionsTooMany };
  if (n < 2) return { level: "warning", text: LINT_TEXT.optionsTooFew };
  if (fails === 0) return { level: "warning", text: LINT_TEXT.optionsNoFail };
  return { level: "ok", text: optionsOkText(n, fails) };
}

// ---- against the live route ---------------------------------------------------------
/**
 * Every step uid of the config must be in step_uids (unknownUids otherwise — PUT draft answers
 * 409 STEP_UNKNOWN; publish and its preview list them as unknownStepIssues), and its scope must
 * match package_level of route_steps at that position (STEP_SCOPE_MISMATCH, an error, so publish
 * is blocked instead of the step being dropped).
 * route_steps / step_uids of different lengths have no usable positions: every uid is unknown.
 */
export function checkConfigAgainstRoute(
  cfg: RouteFieldsConfig,
  routeSteps: readonly number[],
  stepUids: readonly string[],
  packageLevelTypeIds: ReadonlySet<number>,
): { unknownUids: StepUid[]; issues: Issue[] } {
  const aligned = routeSteps.length === stepUids.length;
  const unknownUids: StepUid[] = [];
  const issues: Issue[] = [];
  for (const [uid, step] of Object.entries(cfg.steps)) {
    const i = aligned ? stepUids.indexOf(uid) : -1;
    if (i < 0) {
      unknownUids.push(uid);
      continue;
    }
    const scope = packageLevelTypeIds.has(routeSteps[i]) ? "package" : "item";
    if (step.scope !== scope) {
      issues.push({ level: "error", code: "STEP_SCOPE_MISMATCH", step_uid: uid, message: COPY_PENDING.stepScopeMismatch });
    }
  }
  return { unknownUids, issues };
}

/** checkConfigAgainstRoute's unknownUids as publish-blocking errors: the issues publish and its
 *  preview answer 422 with (spec §3.4.3 step 3), and the ones the editor lists next to them. */
export function unknownStepIssues(unknownUids: readonly StepUid[]): Issue[] {
  return unknownUids.map((uid) => ({ level: "error", code: "STEP_UNKNOWN", step_uid: uid, message: COPY_PENDING.stepUnknown }));
}
