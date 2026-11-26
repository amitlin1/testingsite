import type { RandomSource } from "@/lib/random-id";
import { jsonEqual } from "@/lib/json-guards";
import { KINDS_ALLOWED, MANDATORY_SYSTEM_KINDS, SYSTEM_KINDS, TEMPLATE_LIMITS, allComponentsOf } from "@/app/lib/popup-templates/schema";
import type {
  ComponentKind, PackageRole, PopupTemplateConfig, TemplateComponent, TemplateStep,
} from "@/app/lib/popup-templates/schema";
import { COMPONENT_NAME, TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import {
  closingTemplate, newChecklistRowId, newComponent, newTemplateStepId, openingTemplate, photoStationTemplate, verdictStationTemplate,
} from "@/app/lib/popup-templates/templates";
import { OPENING_PHOTO_CODES } from "@/app/lib/popup-templates/codePopups";
import type { CodePopup } from "@/app/lib/popup-templates/codePopups";

/**
 * The template editor's edits (/settings/popup-templates, docs/features/popup-templates/PLAN.md steps 1.6
 * and 2.5): pure and immutable — every function returns a new config, so the screen keeps the
 * draft in one state and compares it with what was saved.
 *
 * A package template has two lists of steps: its own (the box's) and, at the opening, the item
 * flow — the phases every item goes through. Step and component ids are unique over both, so every
 * edit finds its target in whichever list holds it.
 */

/** Which list of a template: its steps, or the opening's item flow. */
export type StepList = "steps" | "item_flow";

/** The package wizards' own parts: they keep their step, and their settings are the wizards'. */
const SYSTEM_PART_KINDS: readonly ComponentKind[] = SYSTEM_KINDS;
/** Of those, the ones a template must have: neither they nor their step can be removed. */
const MANDATORY_PART_KINDS: readonly ComponentKind[] = [...MANDATORY_SYSTEM_KINDS.opening, ...MANDATORY_SYSTEM_KINDS.closing];

/** The "הוסף רכיב" catalog of a list: what the place may hold, in menu order, minus the mandatory
 *  system parts (always there) and the report signing (added as a step of its own,
 *  addReportSignStep). */
export function catalogFor(role: PackageRole | null, where: StepList): readonly ComponentKind[] {
  const allowed: readonly ComponentKind[] = where === "item_flow" ? KINDS_ALLOWED.item_flow : KINDS_ALLOWED[role ?? "item"];
  return allowed.filter((k) => !MANDATORY_PART_KINDS.includes(k) && k !== "report_sign");
}

export const isSystemPart = (c: TemplateComponent) => SYSTEM_PART_KINDS.includes(c.kind);
/** A system part the admin may remove (and add back): the labels, the report signing. */
export const isOptionalPart = (c: TemplateComponent) => isSystemPart(c) && !MANDATORY_PART_KINDS.includes(c.kind);
/** The closing's report-signing step: added and removed whole (addReportSignStep), and always last. */
export const holdsReportSign = (step: TemplateStep) => step.components.some((c) => c.kind === "report_sign");
/** Whether the closing can take the report signing (it has none yet). */
export const canAddReportSign = (cfg: PopupTemplateConfig) =>
  cfg.role === "closing" && !cfg.steps.some(holdsReportSign) && cfg.steps.length < TEMPLATE_LIMITS.maxSteps;
/** A step holding a mandatory system part stays (it can still move). */
export const isLockedStep = (step: TemplateStep) => step.components.some((c) => MANDATORY_PART_KINDS.includes(c.kind));

const listOf = (cfg: PopupTemplateConfig, where: StepList): TemplateStep[] => (where === "steps" ? cfg.steps : cfg.item_flow ?? []);
/** The same edit over both lists; a template with no item flow keeps none. */
const mapLists = (cfg: PopupTemplateConfig, fn: (steps: TemplateStep[]) => TemplateStep[]): PopupTemplateConfig =>
  ({ ...cfg, steps: fn(cfg.steps), ...(cfg.item_flow ? { item_flow: fn(cfg.item_flow) } : {}) });
/** The list that holds a step or a component. */
function whereIs(cfg: PopupTemplateConfig, test: (step: TemplateStep) => boolean): StepList {
  return cfg.steps.some(test) ? "steps" : "item_flow";
}
const withList = (cfg: PopupTemplateConfig, where: StepList, steps: TemplateStep[]): PopupTemplateConfig =>
  (where === "steps" ? { ...cfg, steps } : { ...cfg, item_flow: steps });

/** A blank template: the SKU, then one step with the route's fields and the verdict. */
export function blankTemplate(random?: RandomSource): PopupTemplateConfig {
  return {
    steps: [
      { id: newTemplateStepId(random), title: TEMPLATE_DEFAULTS.skuStepTitle, desc: TEMPLATE_DEFAULTS.skuStepDesc, components: [newComponent("sku_scan", random)] },
      { id: newTemplateStepId(random), title: TEMPLATE_DEFAULTS.checkStepTitle, desc: "", components: [newComponent("route_fields", random), newComponent("verdict", random)] },
    ],
    finish_label: TEMPLATE_DEFAULTS.finishLabel,
  };
}

/** The template that reproduces the popup the code gives a type today, or null when the type opens
 *  the plain report dialog. `photoCodeOf` resolves a photo group's id to its code. */
export function codeTemplateFor(popup: CodePopup | undefined, photoCodeOf: (id: number) => string | null, random?: RandomSource): PopupTemplateConfig | null {
  if (!popup) return null;
  if (popup.kind === "verdict") return verdictStationTemplate(random);
  const code = photoCodeOf(popup.photoTypeId);
  return code ? photoStationTemplate(code, random) : null;
}

/** Today's opening or closing wizard as a package template (PLAN.md §5, step 2.4); the opening keeps
 *  the wizard's photo groups. */
export const packageCodeTemplate = (role: PackageRole, random?: RandomSource): PopupTemplateConfig =>
  (role === "opening" ? openingTemplate(OPENING_PHOTO_CODES.box, OPENING_PHOTO_CODES.item, random) : closingTemplate(random));

// ---- steps ----------------------------------------------------------------------
/** A new, empty step at the end of a list — in the item base, before the step that holds the
 *  verdict, which stays last; in a closing, before the report signing, which stays last too. */
export function addStep(cfg: PopupTemplateConfig, random?: RandomSource, where: StepList = "steps"): PopupTemplateConfig {
  const step: TemplateStep = { id: newTemplateStepId(random), title: "שלב חדש", desc: "", components: [] };
  const list = listOf(cfg, where);
  const lastAt = cfg.role == null
    ? list.findIndex((s) => s.components.some((c) => c.kind === "verdict"))
    : list.findIndex(holdsReportSign);
  const at = lastAt === -1 ? list.length : lastAt;
  return withList(cfg, where, [...list.slice(0, at), step, ...list.slice(at)]);
}

export function updateStep(cfg: PopupTemplateConfig, stepId: string, patch: Partial<Pick<TemplateStep, "title" | "desc">>): PopupTemplateConfig {
  return mapLists(cfg, (steps) => steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
}

export function removeStep(cfg: PopupTemplateConfig, stepId: string): PopupTemplateConfig {
  return mapLists(cfg, (steps) => steps.filter((s) => s.id !== stepId));
}

/** Whether a step may move one place: never the report signing, nor anything past it. */
export function canMoveStep(cfg: PopupTemplateConfig, stepId: string, by: -1 | 1): boolean {
  const list = listOf(cfg, whereIs(cfg, (s) => s.id === stepId));
  const i = list.findIndex((s) => s.id === stepId);
  const j = i + by;
  return i !== -1 && j >= 0 && j < list.length && !holdsReportSign(list[i]) && !holdsReportSign(list[j]);
}

export function moveStep(cfg: PopupTemplateConfig, stepId: string, by: -1 | 1): PopupTemplateConfig {
  const where = whereIs(cfg, (s) => s.id === stepId);
  const list = listOf(cfg, where);
  const i = list.findIndex((s) => s.id === stepId);
  const j = i + by;
  if (!canMoveStep(cfg, stepId, by)) return cfg;
  const steps = [...list];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return withList(cfg, where, steps);
}

// ---- components -----------------------------------------------------------------
/** Whether the catalog may add a kind to a step: one SKU scan, one verdict and one place for the
 *  route's fields per list (the box's steps, the item flow); up to 8 photos over the template; the
 *  labels once, into an empty step of their own. A system part's step takes nothing more. */
export function canAddKind(cfg: PopupTemplateConfig, kind: ComponentKind, where: StepList = "steps", step?: TemplateStep): boolean {
  if (step?.components.some(isSystemPart)) return false;
  const inList = listOf(cfg, where).flatMap((s) => s.components);
  if (kind === "sku_scan" || kind === "verdict" || kind === "route_fields") return !inList.some((c) => c.kind === kind);
  if (kind === "photo") return allComponentsOf(cfg).filter((c) => c.kind === "photo").length < TEMPLATE_LIMITS.maxPhotos;
  if (SYSTEM_PART_KINDS.includes(kind)) return !allComponentsOf(cfg).some((c) => c.kind === kind) && step != null && step.components.length === 0;
  return true;
}

/** Adds the report signing to a closing: a step of its own at the end, named after it. */
export function addReportSignStep(cfg: PopupTemplateConfig, random?: RandomSource): PopupTemplateConfig {
  if (!canAddReportSign(cfg)) return cfg;
  const step: TemplateStep = {
    id: newTemplateStepId(random), title: COMPONENT_NAME.report_sign, desc: "הדוחות של הפריטים + חתימה",
    components: [newComponent("report_sign", random)],
  };
  return { ...cfg, steps: [...cfg.steps, step] };
}

/** Adds a component to a step: before the verdict when the step ends with it, else at the end. */
export function addComponent(cfg: PopupTemplateConfig, stepId: string, kind: ComponentKind, random?: RandomSource): PopupTemplateConfig {
  const comp = newComponent(kind, random);
  return mapLists(cfg, (steps) => steps.map((s) => {
    if (s.id !== stepId) return s;
    const last = s.components[s.components.length - 1];
    const at = last?.kind === "verdict" && kind !== "verdict" ? s.components.length - 1 : s.components.length;
    return { ...s, components: [...s.components.slice(0, at), comp, ...s.components.slice(at)] };
  }));
}

/** Changes a component's settings (never its id or kind). */
export function updateComponent<C extends TemplateComponent>(cfg: PopupTemplateConfig, componentId: string, patch: Partial<Omit<C, "id" | "kind">>): PopupTemplateConfig {
  return mapLists(cfg, (steps) => steps.map((s) => ({
    ...s,
    components: s.components.map((c) => (c.id === componentId ? ({ ...c, ...patch } as TemplateComponent) : c)),
  })));
}

/** Removes a component; the report signing goes with its step, which holds nothing else. */
export function removeComponent(cfg: PopupTemplateConfig, componentId: string): PopupTemplateConfig {
  const sign = cfg.steps.find((s) => holdsReportSign(s) && s.components.some((c) => c.id === componentId));
  if (sign) return removeStep(cfg, sign.id);
  return mapLists(cfg, (steps) => steps.map((s) => ({ ...s, components: s.components.filter((c) => c.id !== componentId) })));
}

/** Moves a component one place within its step; at the step's edge, to the neighbouring step of
 *  its list (its end going up, its start going down). */
export function moveComponent(cfg: PopupTemplateConfig, componentId: string, by: -1 | 1): PopupTemplateConfig {
  const where = whereIs(cfg, (s) => s.components.some((c) => c.id === componentId));
  const list = listOf(cfg, where);
  const si = list.findIndex((s) => s.components.some((c) => c.id === componentId));
  if (si === -1) return cfg;
  const comps = list[si].components;
  const ci = comps.findIndex((c) => c.id === componentId);
  const cj = ci + by;
  const steps = list.map((s) => ({ ...s, components: [...s.components] }));
  if (cj >= 0 && cj < comps.length) {
    [steps[si].components[ci], steps[si].components[cj]] = [steps[si].components[cj], steps[si].components[ci]];
    return withList(cfg, where, steps);
  }
  const sj = si + by;
  if (sj < 0 || sj >= steps.length) return cfg;
  const [comp] = steps[si].components.splice(ci, 1);
  if (by < 0) steps[sj].components.push(comp);
  else steps[sj].components.unshift(comp);
  return withList(cfg, where, steps);
}

// ---- a checklist's rows ---------------------------------------------------------------
type Rows = { id: string; label: string }[];
export const addChecklistRow = (rows: Rows, random?: RandomSource): Rows => [...rows, { id: newChecklistRowId(random), label: "" }];
export const setChecklistRow = (rows: Rows, rowId: string, label: string): Rows => rows.map((r) => (r.id === rowId ? { ...r, label } : r));
export const removeChecklistRow = (rows: Rows, rowId: string): Rows => rows.filter((r) => r.id !== rowId);

export function setFinishLabel(cfg: PopupTemplateConfig, finish_label: string): PopupTemplateConfig {
  return { ...cfg, finish_label };
}

// ---- reading ------------------------------------------------------------------------
/** The same config (the draft has no unsaved change). */
export const sameConfig = (a: PopupTemplateConfig | null, b: PopupTemplateConfig | null) => jsonEqual(a, b);

/** The issues of one place: a step's own (no component), or one component's. */
export function issuesAt(issues: readonly TemplateIssue[], at: { stepId: string; componentId?: string }): TemplateIssue[] {
  return issues.filter((i) => i.step_id === at.stepId && (at.componentId ? i.component_id === at.componentId : i.component_id == null));
}

/** The issues of the template as a whole (no step). */
export const templateIssues = (issues: readonly TemplateIssue[]) => issues.filter((i) => i.step_id == null);
