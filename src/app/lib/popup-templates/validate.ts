import { NOTE_MAX_CHOICES, NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import type { NoteMax } from "@/app/lib/station-fields/schema";
import { COMPONENT_KINDS, TEMPLATE_BASES, TEMPLATE_ID_PATTERNS } from "./schema";
import type {
  ComponentId, PopupTemplateConfig, TemplateBase, TemplateComponent, TemplateStep, TemplateStepId,
} from "./schema";
import { TEMPLATE_LINT_TEXT } from "./labels";

/**
 * Validation of a popup template, shared by the editor and the API (the station-fields
 * pattern, station-fields/validate.ts):
 *
 * - parsePopupTemplateConfig — STRUCTURE. Throws TemplateShapeError on anything the editor could
 *   never produce (the API answers 400). Returns a sanitized copy: only known keys survive.
 * - lintPopupTemplate — CONTENT. Every issue blocks a save; the editor shows each where it is.
 */

export type TemplateIssueCode =
  | "STEPS_EMPTY" | "STEPS_TOO_MANY" | "STEP_EMPTY" | "STEP_TITLE_EMPTY" | "FINISH_LABEL_EMPTY"
  | "SKU_DUPLICATE" | "SKU_NOT_FIRST"
  | "VERDICT_MISSING" | "VERDICT_DUPLICATE" | "VERDICT_NOT_LAST" | "VERDICT_QUESTION_EMPTY"
  | "ROUTE_FIELDS_DUPLICATE" | "NEEDS_REFERENCE" | "MESSAGE_EMPTY"
  | "PHOTO_TITLE_EMPTY" | "PHOTO_TOO_MANY" | "PHOTO_CODE_DUPLICATE" | "TOLERANCE";

/** One content issue; step_id / component_id say where. */
export type TemplateIssue = {
  code: TemplateIssueCode;
  step_id?: TemplateStepId;
  component_id?: ComponentId;
  message: string;
};

/** Hard limits of the shape check; the content rules are stricter (6 steps, 8 photo components). */
export const TEMPLATE_LIMITS = {
  configJson: 64_000,
  steps: 12,
  componentsPerStep: 20,
  stepTitle: 60,
  stepDesc: 200,
  message: 500,
  question: 80,
  photoTitle: 60,
  finishLabel: 40,
  photoMin: 20,
  /** Content rules. */
  maxSteps: 6,
  maxPhotos: 8,
} as const;

/** Structural parse failure — HTTP 400. */
export class TemplateShapeError extends Error {
  readonly code = "TEMPLATE_SHAPE_INVALID";
  readonly path: string;
  constructor(path: string, msg: string) {
    super(`${path}: ${msg}`);
    this.name = "TemplateShapeError";
    this.path = path;
  }
}

// ---- helpers --------------------------------------------------------------------
type Obj = Record<string, unknown>;

function isPlainObj(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
/** Own property only — never a value inherited from a (possibly polluted) prototype. */
function own(o: Obj, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string | number>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

function str(o: Obj, k: string, max: number, p: string): string {
  const v = own(o, k);
  if (!isStr(v, max)) throw new TemplateShapeError(`${p}.${k}`, "not a string within its limit");
  return v;
}
function bool(o: Obj, k: string, p: string): boolean {
  const v = own(o, k);
  if (!isBool(v)) throw new TemplateShapeError(`${p}.${k}`, "not a boolean");
  return v;
}

/** The base as stored / sent; anything else → TemplateShapeError. */
export function parseTemplateBase(raw: unknown): TemplateBase {
  if (!oneOf(TEMPLATE_BASES, raw)) throw new TemplateShapeError("base", "unknown base");
  return raw;
}

// ---- structure ------------------------------------------------------------------
function parseComponent(raw: unknown, p: string): TemplateComponent {
  if (!isPlainObj(raw)) throw new TemplateShapeError(p, "not an object");
  const id = own(raw, "id");
  if (typeof id !== "string" || !TEMPLATE_ID_PATTERNS.component.test(id)) throw new TemplateShapeError(`${p}.id`, "bad component id");
  const kind = own(raw, "kind");
  if (!oneOf(COMPONENT_KINDS, kind)) throw new TemplateShapeError(`${p}.kind`, "unknown component kind");
  switch (kind) {
    case "sku_scan":
      return { id, kind, required: bool(raw, "required", p), carry_last: bool(raw, "carry_last", p), lookup_reference: bool(raw, "lookup_reference", p) };
    case "message":
      return { id, kind, text: str(raw, "text", TEMPLATE_LIMITS.message, p) };
    case "photo": {
      const code = own(raw, "photo_code");
      if (typeof code !== "string" || !TEMPLATE_ID_PATTERNS.photoCode.test(code)) throw new TemplateShapeError(`${p}.photo_code`, "bad photo code");
      const min = own(raw, "min");
      if (!isInt(min) || min < 0 || min > TEMPLATE_LIMITS.photoMin) throw new TemplateShapeError(`${p}.min`, "out of range");
      return { id, kind, title: str(raw, "title", TEMPLATE_LIMITS.photoTitle, p), photo_code: code, min, show_reference: bool(raw, "show_reference", p) };
    }
    case "weight": {
      const tol = own(raw, "tolerance_pct");
      if (!isNum(tol)) throw new TemplateShapeError(`${p}.tolerance_pct`, "not a number");
      return { id, kind, required: bool(raw, "required", p), tolerance_pct: tol };
    }
    case "route_fields":
      return { id, kind };
    case "verdict": {
      const noteMax: unknown = own(raw, "note_max") ?? NOTE_MAX_DEFAULT;
      if (!oneOf<NoteMax>(NOTE_MAX_CHOICES, noteMax)) throw new TemplateShapeError(`${p}.note_max`, "not an allowed length");
      return { id, kind, question: str(raw, "question", TEMPLATE_LIMITS.question, p), note_max: noteMax };
    }
  }
}

function parseStep(raw: unknown, p: string): TemplateStep {
  if (!isPlainObj(raw)) throw new TemplateShapeError(p, "not an object");
  const id = own(raw, "id");
  if (typeof id !== "string" || !TEMPLATE_ID_PATTERNS.step.test(id)) throw new TemplateShapeError(`${p}.id`, "bad step id");
  const comps = own(raw, "components");
  if (!Array.isArray(comps) || comps.length > TEMPLATE_LIMITS.componentsPerStep) throw new TemplateShapeError(`${p}.components`, "not a list within its limit");
  const descRaw = own(raw, "desc");
  return {
    id,
    title: str(raw, "title", TEMPLATE_LIMITS.stepTitle, p),
    desc: descRaw === undefined ? "" : str(raw, "desc", TEMPLATE_LIMITS.stepDesc, p),
    components: comps.map((c, i) => parseComponent(c, `${p}.components[${i}]`)),
  };
}

/** A template config from the wire or the DB, as a sanitized copy. Ids must be unique. */
export function parsePopupTemplateConfig(raw: unknown): PopupTemplateConfig {
  let size: number;
  try {
    size = JSON.stringify(raw)?.length ?? 0;
  } catch {
    throw new TemplateShapeError("config", "not JSON");
  }
  if (size > TEMPLATE_LIMITS.configJson) throw new TemplateShapeError("config", "too large");
  if (!isPlainObj(raw)) throw new TemplateShapeError("config", "not an object");
  const steps = own(raw, "steps");
  if (!Array.isArray(steps) || steps.length > TEMPLATE_LIMITS.steps) throw new TemplateShapeError("config.steps", "not a list within its limit");
  const cfg: PopupTemplateConfig = {
    steps: steps.map((s, i) => parseStep(s, `config.steps[${i}]`)),
    finish_label: str(raw, "finish_label", TEMPLATE_LIMITS.finishLabel, "config"),
  };
  const seen = new Set<string>();
  for (const s of cfg.steps) {
    for (const id of [s.id, ...s.components.map((c) => c.id)]) {
      if (seen.has(id)) throw new TemplateShapeError("config", `duplicate id ${id}`);
      seen.add(id);
    }
  }
  return cfg;
}

// ---- content ----------------------------------------------------------------------
/** Every content issue of a template, in popup order. Empty = it can be saved. */
export function lintPopupTemplate(cfg: PopupTemplateConfig): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const T = TEMPLATE_LINT_TEXT;
  const add = (code: TemplateIssueCode, message: string, step_id?: string, component_id?: string) =>
    out.push({ code, message, ...(step_id ? { step_id } : {}), ...(component_id ? { component_id } : {}) });

  if (cfg.steps.length === 0) add("STEPS_EMPTY", T.stepsEmpty);
  if (cfg.steps.length > TEMPLATE_LIMITS.maxSteps) add("STEPS_TOO_MANY", T.stepsTooMany);
  if (!cfg.finish_label.trim()) add("FINISH_LABEL_EMPTY", T.finishLabelEmpty);

  let skuSeen = false;
  let lookupSeen = false;
  let verdicts = 0;
  let routeFields = 0;
  let photos = 0;
  const codes = new Set<string>();
  const lastStep = cfg.steps[cfg.steps.length - 1];

  cfg.steps.forEach((step, si) => {
    if (!step.title.trim()) add("STEP_TITLE_EMPTY", T.stepTitleEmpty, step.id);
    if (step.components.length === 0) add("STEP_EMPTY", T.stepEmpty, step.id);
    step.components.forEach((c, ci) => {
      switch (c.kind) {
        case "sku_scan":
          if (skuSeen) add("SKU_DUPLICATE", T.skuDuplicate, step.id, c.id);
          else if (si !== 0 || step.components.length !== 1) add("SKU_NOT_FIRST", T.skuNotFirst, step.id, c.id);
          skuSeen = true;
          lookupSeen ||= c.lookup_reference;
          break;
        case "message":
          if (!c.text.trim()) add("MESSAGE_EMPTY", T.messageEmpty, step.id, c.id);
          break;
        case "photo":
          photos++;
          if (photos === TEMPLATE_LIMITS.maxPhotos + 1) add("PHOTO_TOO_MANY", T.photoTooMany, step.id, c.id);
          if (!c.title.trim()) add("PHOTO_TITLE_EMPTY", T.photoTitleEmpty, step.id, c.id);
          if (codes.has(c.photo_code)) add("PHOTO_CODE_DUPLICATE", T.photoCodeDuplicate, step.id, c.id);
          codes.add(c.photo_code);
          if (c.show_reference && !lookupSeen) add("NEEDS_REFERENCE", T.needsReference, step.id, c.id);
          break;
        case "weight":
          if (c.tolerance_pct < 0 || c.tolerance_pct > 100) add("TOLERANCE", T.tolerance, step.id, c.id);
          if (!lookupSeen) add("NEEDS_REFERENCE", T.needsReference, step.id, c.id);
          break;
        case "route_fields":
          routeFields++;
          if (routeFields === 2) add("ROUTE_FIELDS_DUPLICATE", T.routeFieldsDuplicate, step.id, c.id);
          break;
        case "verdict":
          verdicts++;
          if (verdicts === 2) add("VERDICT_DUPLICATE", T.verdictDuplicate, step.id, c.id);
          else if (verdicts === 1 && (step !== lastStep || ci !== step.components.length - 1)) add("VERDICT_NOT_LAST", T.verdictNotLast, step.id, c.id);
          if (!c.question.trim()) add("VERDICT_QUESTION_EMPTY", T.verdictQuestionEmpty, step.id, c.id);
          break;
      }
    });
  });
  if (cfg.steps.length > 0 && verdicts === 0) add("VERDICT_MISSING", T.verdictMissing);
  return out;
}
