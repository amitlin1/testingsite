import { NOTE_MAX_CHOICES, NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import type { NoteMax } from "@/app/lib/station-fields/schema";
import { COMPONENT_KINDS, KINDS_ALLOWED, PACKAGE_ROLES, SYSTEM_KINDS, TEMPLATE_BASES, TEMPLATE_ID_PATTERNS, allComponentsOf } from "./schema";
import type {
  ComponentId, ComponentKind, PackageRole, PopupTemplateConfig, TemplateBase, TemplateComponent, TemplateStep, TemplateStepId,
} from "./schema";
import { COMPONENT_NAME, TEMPLATE_LINT_TEXT } from "./labels";

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
  | "PHOTO_TITLE_EMPTY" | "PHOTO_TOO_MANY" | "PHOTO_CODE_DUPLICATE" | "TOLERANCE"
  // the package base (PLAN.md §5.2)
  | "ROLE_MISSING" | "ROLE_ON_ITEM" | "KIND_NOT_ALLOWED" | "SYSTEM_MISSING" | "SYSTEM_NOT_ALONE" | "SYSTEM_DUPLICATE"
  | "SYSTEM_ORDER" | "ITEM_FLOW_EMPTY" | "ITEM_FLOW_NOT_HERE" | "VERDICT_NOT_LAST_IN_STEP"
  | "CHECKLIST_TITLE_EMPTY" | "CHECKLIST_EMPTY" | "CHECKLIST_ITEM_EMPTY" | "NOTES_LABEL_EMPTY";

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
  checklistItems: 20,
  checklistTitle: 60,
  checklistLabel: 120,
  notesLabel: 60,
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
    case "checklist": {
      const items = own(raw, "items");
      if (!Array.isArray(items) || items.length > TEMPLATE_LIMITS.checklistItems) throw new TemplateShapeError(`${p}.items`, "not a list within its limit");
      return {
        id, kind, title: str(raw, "title", TEMPLATE_LIMITS.checklistTitle, p),
        items: items.map((it, i) => {
          const q = `${p}.items[${i}]`;
          if (!isPlainObj(it)) throw new TemplateShapeError(q, "not an object");
          const itemId = own(it, "id");
          if (typeof itemId !== "string" || !TEMPLATE_ID_PATTERNS.checkItem.test(itemId)) throw new TemplateShapeError(`${q}.id`, "bad checklist row id");
          return { id: itemId, label: str(it, "label", TEMPLATE_LIMITS.checklistLabel, q) };
        }),
      };
    }
    case "notes":
      return { id, kind, label: str(raw, "label", TEMPLATE_LIMITS.notesLabel, p) };
    case "contents":
    case "items":
    case "labels":
    case "arrival":
      return { id, kind };
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

/** A template config from the wire or the DB, as a sanitized copy. Ids must be unique — steps,
 *  components (the item flow's too) and checklist rows alike. */
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
  const role = own(raw, "role");
  if (role !== undefined && role !== null) {
    if (!oneOf<PackageRole>(PACKAGE_ROLES, role)) throw new TemplateShapeError("config.role", "unknown role");
    cfg.role = role;
  }
  const flow = own(raw, "item_flow");
  if (flow !== undefined && flow !== null) {
    if (!Array.isArray(flow) || flow.length > TEMPLATE_LIMITS.steps) throw new TemplateShapeError("config.item_flow", "not a list within its limit");
    cfg.item_flow = flow.map((s, i) => parseStep(s, `config.item_flow[${i}]`));
  }
  const seen = new Set<string>();
  const ids = [
    ...cfg.steps.flatMap((s) => [s.id, ...s.components.map((c) => c.id)]),
    ...(cfg.item_flow ?? []).flatMap((s) => [s.id, ...s.components.map((c) => c.id)]),
    ...allComponentsOf(cfg).flatMap((c) => (c.kind === "checklist" ? c.items.map((it) => it.id) : [])),
  ];
  for (const id of ids) {
    if (seen.has(id)) throw new TemplateShapeError("config", `duplicate id ${id}`);
    seen.add(id);
  }
  return cfg;
}

// ---- content ----------------------------------------------------------------------
type Add = (code: TemplateIssueCode, message: string, step_id?: string, component_id?: string) => void;

/** Rules every list of components shares (the steps', or the item flow's): content of each
 *  component, one SKU scan, one place for the route's fields, what leans on a reference lookup. */
type ListState = { skuSeen: boolean; lookupSeen: boolean; verdicts: number; routeFields: number };

function lintComponent(c: TemplateComponent, at: { stepId?: string; allowed: readonly ComponentKind[] }, st: ListState, add: Add): void {
  const T = TEMPLATE_LINT_TEXT;
  const where = [at.stepId, c.id] as const;
  if (!at.allowed.includes(c.kind)) add("KIND_NOT_ALLOWED", T.kindNotAllowed(COMPONENT_NAME[c.kind]), ...where);
  switch (c.kind) {
    case "message":
      if (!c.text.trim()) add("MESSAGE_EMPTY", T.messageEmpty, ...where);
      break;
    case "photo":
      if (!c.title.trim()) add("PHOTO_TITLE_EMPTY", T.photoTitleEmpty, ...where);
      if (c.show_reference && !st.lookupSeen) add("NEEDS_REFERENCE", T.needsReference, ...where);
      break;
    case "weight":
      if (c.tolerance_pct < 0 || c.tolerance_pct > 100) add("TOLERANCE", T.tolerance, ...where);
      if (!st.lookupSeen) add("NEEDS_REFERENCE", T.needsReference, ...where);
      break;
    case "route_fields":
      st.routeFields++;
      if (st.routeFields === 2) add("ROUTE_FIELDS_DUPLICATE", T.routeFieldsDuplicate, ...where);
      break;
    case "verdict":
      if (!c.question.trim()) add("VERDICT_QUESTION_EMPTY", T.verdictQuestionEmpty, ...where);
      break;
    case "checklist":
      if (!c.title.trim()) add("CHECKLIST_TITLE_EMPTY", T.checklistTitleEmpty, ...where);
      if (c.items.length === 0) add("CHECKLIST_EMPTY", T.checklistEmpty, ...where);
      else if (c.items.some((it) => !it.label.trim())) add("CHECKLIST_ITEM_EMPTY", T.checklistItemEmpty, ...where);
      break;
    case "notes":
      if (!c.label.trim()) add("NOTES_LABEL_EMPTY", T.notesLabelEmpty, ...where);
      break;
    default:
      break;
  }
}

/**
 * Every content issue of a template, in popup order. Empty = it can be saved.
 *
 * base "item" (PLAN.md §3.2): one SKU scan alone in the first step; one verdict, the last component
 * of the last step; no role, no item flow, none of the package base's parts.
 * base "package" (PLAN.md §5.2): a role; its system parts each alone in a step and in order
 * (contents → items → labels; arrival); a verdict is optional and closes its own step; an opening's
 * item flow has at least one component, its SKU scan first and its verdict last; a closing has none.
 */
export function lintPopupTemplate(cfg: PopupTemplateConfig, base: TemplateBase = "item"): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const T = TEMPLATE_LINT_TEXT;
  const add: Add = (code, message, step_id, component_id) =>
    out.push({ code, message, ...(step_id ? { step_id } : {}), ...(component_id ? { component_id } : {}) });

  if (cfg.steps.length === 0) add("STEPS_EMPTY", T.stepsEmpty);
  if (cfg.steps.length > TEMPLATE_LIMITS.maxSteps) add("STEPS_TOO_MANY", T.stepsTooMany);
  if (!cfg.finish_label.trim()) add("FINISH_LABEL_EMPTY", T.finishLabelEmpty);

  const role = base === "package" ? cfg.role ?? null : null;
  if (base === "item" && (cfg.role != null || (cfg.item_flow?.length ?? 0) > 0)) add("ROLE_ON_ITEM", T.roleOnItem);
  if (base === "package" && role == null) add("ROLE_MISSING", T.roleMissing);
  const allowed: readonly ComponentKind[] = base === "item" ? KINDS_ALLOWED.item : role ? KINDS_ALLOWED[role] : COMPONENT_KINDS;

  // ---- the steps ----
  const st: ListState = { skuSeen: false, lookupSeen: false, verdicts: 0, routeFields: 0 };
  const lastStep = cfg.steps[cfg.steps.length - 1];
  const systemAt: Partial<Record<(typeof SYSTEM_KINDS)[number], { si: number; stepId: string; id: string }>> = {};

  cfg.steps.forEach((step, si) => {
    if (!step.title.trim()) add("STEP_TITLE_EMPTY", T.stepTitleEmpty, step.id);
    if (step.components.length === 0) add("STEP_EMPTY", T.stepEmpty, step.id);
    step.components.forEach((c, ci) => {
      if (c.kind === "sku_scan") {
        if (st.skuSeen) add("SKU_DUPLICATE", T.skuDuplicate, step.id, c.id);
        else if (si !== 0 || step.components.length !== 1) add("SKU_NOT_FIRST", T.skuNotFirst, step.id, c.id);
        st.skuSeen = true;
        st.lookupSeen ||= c.lookup_reference;
      }
      if (c.kind === "verdict") {
        st.verdicts++;
        if (st.verdicts === 2) add("VERDICT_DUPLICATE", T.verdictDuplicate, step.id, c.id);
        else if (st.verdicts === 1) {
          const lastInStep = ci === step.components.length - 1;
          if (base === "item" && (step !== lastStep || !lastInStep)) add("VERDICT_NOT_LAST", T.verdictNotLast, step.id, c.id);
          if (base === "package" && !lastInStep) add("VERDICT_NOT_LAST_IN_STEP", T.verdictNotLastInStep, step.id, c.id);
        }
      }
      if ((SYSTEM_KINDS as readonly string[]).includes(c.kind)) {
        const kind = c.kind as (typeof SYSTEM_KINDS)[number];
        if (step.components.length !== 1) add("SYSTEM_NOT_ALONE", T.systemNotAlone(COMPONENT_NAME[kind]), step.id, c.id);
        if (systemAt[kind]) add("SYSTEM_DUPLICATE", T.systemNotAlone(COMPONENT_NAME[kind]), step.id, c.id);
        else systemAt[kind] = { si, stepId: step.id, id: c.id };
      }
      lintComponent(c, { stepId: step.id, allowed }, st, add);
    });
  });
  if (base === "item" && cfg.steps.length > 0 && st.verdicts === 0) add("VERDICT_MISSING", T.verdictMissing);

  // ---- the package base: its system parts and the item flow ----
  if (role === "opening") {
    if (!systemAt.contents) add("SYSTEM_MISSING", T.systemMissing(COMPONENT_NAME.contents));
    if (!systemAt.items) add("SYSTEM_MISSING", T.systemMissing(COMPONENT_NAME.items));
    const order = [systemAt.contents, systemAt.items, systemAt.labels].filter((x) => x != null);
    if (order.some((x, i) => i > 0 && x.si < order[i - 1].si)) add("SYSTEM_ORDER", T.systemOrder);

    // The item flow: its phases, like steps — the item's SKU scan alone in the first, one verdict
    // closing its own phase. Issues point at the phase.
    const flow = cfg.item_flow ?? [];
    if (flow.length === 0 || flow.every((s) => s.components.length === 0)) add("ITEM_FLOW_EMPTY", T.itemFlowEmpty, systemAt.items?.stepId);
    if (flow.length > TEMPLATE_LIMITS.maxSteps) add("STEPS_TOO_MANY", T.stepsTooMany, systemAt.items?.stepId);
    const fst: ListState = { skuSeen: false, lookupSeen: false, verdicts: 0, routeFields: 0 };
    flow.forEach((phase, pi) => {
      if (!phase.title.trim()) add("STEP_TITLE_EMPTY", T.stepTitleEmpty, phase.id);
      if (phase.components.length === 0) add("STEP_EMPTY", T.stepEmpty, phase.id);
      phase.components.forEach((c, ci) => {
        if (c.kind === "sku_scan") {
          if (fst.skuSeen) add("SKU_DUPLICATE", T.skuDuplicate, phase.id, c.id);
          else if (pi !== 0 || phase.components.length !== 1) add("SKU_NOT_FIRST", T.skuNotFirstInFlow, phase.id, c.id);
          fst.skuSeen = true;
          fst.lookupSeen ||= c.lookup_reference;
        }
        if (c.kind === "verdict") {
          fst.verdicts++;
          if (fst.verdicts === 2) add("VERDICT_DUPLICATE", T.verdictDuplicate, phase.id, c.id);
          else if (ci !== phase.components.length - 1) add("VERDICT_NOT_LAST_IN_STEP", T.verdictNotLastInStep, phase.id, c.id);
        }
        lintComponent(c, { stepId: phase.id, allowed: KINDS_ALLOWED.item_flow }, fst, add);
      });
    });
  } else if (role === "closing") {
    if (!systemAt.arrival) add("SYSTEM_MISSING", T.systemMissing(COMPONENT_NAME.arrival));
    if ((cfg.item_flow?.length ?? 0) > 0) add("ITEM_FLOW_NOT_HERE", T.roleOnItem);
  }

  // ---- photos, over the whole template ----
  const codes = new Set<string>();
  let photos = 0;
  for (const c of allComponentsOf(cfg)) {
    if (c.kind !== "photo") continue;
    photos++;
    const stepId = [...cfg.steps, ...(cfg.item_flow ?? [])].find((s) => s.components.includes(c))?.id;
    if (photos === TEMPLATE_LIMITS.maxPhotos + 1) add("PHOTO_TOO_MANY", T.photoTooMany, stepId, c.id);
    if (codes.has(c.photo_code)) add("PHOTO_CODE_DUPLICATE", T.photoCodeDuplicate, stepId, c.id);
    codes.add(c.photo_code);
  }
  return out;
}
