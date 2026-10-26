import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import { newPrefixedId } from "@/app/lib/station-fields/step-uids";
import type { RandomSource } from "@/app/lib/station-fields/step-uids";
import { allComponentsOf } from "@/app/lib/popup-templates/schema";
import type {
  ComponentKind, PackageRole, PopupTemplateConfig, TemplateComponent, TemplateStep,
} from "@/app/lib/popup-templates/schema";
import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import { TEMPLATE_LIMITS } from "@/app/lib/popup-templates/validate";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import {
  closingTemplate, newComponentId, newTemplateStepId, openingTemplate, photoStationTemplate, verdictStationTemplate,
} from "@/app/lib/popup-templates/templates";
import { OPENING_PHOTO_CODES } from "@/app/lib/popup-templates/codePopups";
import type { CodePopup } from "@/app/lib/popup-templates/codePopups";

/**
 * The template editor's edits (/settings/popup-templates, docs/popup-templates/PLAN.md steps 1.6
 * and 2.5): pure and immutable — every function returns a new config, so the screen keeps the
 * draft in one state and compares it with what was saved.
 *
 * A package template has two lists of steps: its own (the box's) and, at the opening, the item
 * flow — the phases every item goes through. Step and component ids are unique over both, so every
 * edit finds its target in whichever list holds it.
 */

/** The catalog of the item base, in the order the "הוסף רכיב" menu lists it. */
export const CATALOG_ORDER: readonly ComponentKind[] = ["message", "photo", "weight", "route_fields", "sku_scan", "verdict"];

/** Which list of a template: its steps, or the opening's item flow. */
export type StepList = "steps" | "item_flow";

/** The catalog of a list: the item base's, a package role's steps (the labels may be added back;
 *  the mandatory system parts are always there), or the item flow's. */
export function catalogFor(role: PackageRole | null, where: StepList): readonly ComponentKind[] {
  if (where === "item_flow") return CATALOG_ORDER;
  if (role === "opening") return ["message", "photo", "route_fields", "sku_scan", "verdict", "checklist", "notes", "labels"];
  if (role === "closing") return ["message", "photo", "route_fields", "sku_scan", "verdict", "checklist", "notes"];
  return CATALOG_ORDER;
}

/** The package wizards' own parts: they keep their step, and their settings are the wizards'. */
export const SYSTEM_PART_KINDS: readonly ComponentKind[] = ["contents", "items", "labels", "arrival"];
/** Of those, the ones a template must have: neither they nor their step can be removed. */
const MANDATORY_PART_KINDS: readonly ComponentKind[] = ["contents", "items", "arrival"];

export const isSystemPart = (c: TemplateComponent) => SYSTEM_PART_KINDS.includes(c.kind);
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

/** A new component of a kind, with the defaults today's popups use. A photo component's group is
 *  its own: its code is its id. */
export function newComponent(kind: ComponentKind, random?: RandomSource): TemplateComponent {
  const id = newComponentId(random);
  switch (kind) {
    case "sku_scan": return { id, kind, required: true, carry_last: true, lookup_reference: true };
    case "message": return { id, kind, text: "" };
    case "photo": return { id, kind, title: TEMPLATE_DEFAULTS.photoTitle, photo_code: id, min: 0, show_reference: true };
    case "weight": return { id, kind, required: true, tolerance_pct: 5 };
    case "route_fields": return { id, kind };
    case "verdict": return { id, kind, question: TEMPLATE_DEFAULTS.verdictQuestion, note_max: NOTE_MAX_DEFAULT };
    case "checklist": return { id, kind, title: "רשימת סימון", items: [{ id: newPrefixedId("i_", random), label: "" }] };
    case "notes": return { id, kind, label: "הערות" };
    case "contents":
    case "items":
    case "labels":
    case "arrival":
      return { id, kind };
  }
}

/** A blank template: the SKU, then one step with the route's fields and the verdict. */
export function blankTemplate(random?: RandomSource): PopupTemplateConfig {
  return {
    steps: [
      { id: newTemplateStepId(random), title: TEMPLATE_DEFAULTS.skuStepTitle, desc: TEMPLATE_DEFAULTS.skuStepDesc, components: [newComponent("sku_scan", random)] },
      { id: newTemplateStepId(random), title: "בדיקת {עמדה}", desc: "", components: [newComponent("route_fields", random), newComponent("verdict", random)] },
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
 *  verdict, which stays last. */
export function addStep(cfg: PopupTemplateConfig, random?: RandomSource, where: StepList = "steps"): PopupTemplateConfig {
  const step: TemplateStep = { id: newTemplateStepId(random), title: "שלב חדש", desc: "", components: [] };
  const list = listOf(cfg, where);
  const verdictAt = cfg.role == null ? list.findIndex((s) => s.components.some((c) => c.kind === "verdict")) : -1;
  const at = verdictAt === -1 ? list.length : verdictAt;
  return withList(cfg, where, [...list.slice(0, at), step, ...list.slice(at)]);
}

export function updateStep(cfg: PopupTemplateConfig, stepId: string, patch: Partial<Pick<TemplateStep, "title" | "desc">>): PopupTemplateConfig {
  return mapLists(cfg, (steps) => steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
}

export function removeStep(cfg: PopupTemplateConfig, stepId: string): PopupTemplateConfig {
  return mapLists(cfg, (steps) => steps.filter((s) => s.id !== stepId));
}

export function moveStep(cfg: PopupTemplateConfig, stepId: string, by: -1 | 1): PopupTemplateConfig {
  const where = whereIs(cfg, (s) => s.id === stepId);
  const list = listOf(cfg, where);
  const i = list.findIndex((s) => s.id === stepId);
  const j = i + by;
  if (i === -1 || j < 0 || j >= list.length) return cfg;
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

export function removeComponent(cfg: PopupTemplateConfig, componentId: string): PopupTemplateConfig {
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
export const addChecklistRow = (rows: Rows, random?: RandomSource): Rows => [...rows, { id: newPrefixedId("i_", random), label: "" }];
export const setChecklistRow = (rows: Rows, rowId: string, label: string): Rows => rows.map((r) => (r.id === rowId ? { ...r, label } : r));
export const removeChecklistRow = (rows: Rows, rowId: string): Rows => rows.filter((r) => r.id !== rowId);

export function setFinishLabel(cfg: PopupTemplateConfig, finish_label: string): PopupTemplateConfig {
  return { ...cfg, finish_label };
}

// ---- reading ------------------------------------------------------------------------
/** The same config (the draft has no unsaved change). */
export const sameConfig = (a: PopupTemplateConfig | null, b: PopupTemplateConfig | null) => JSON.stringify(a) === JSON.stringify(b);

/** The issues of one place: a step's own (no component), or one component's. */
export function issuesAt(issues: readonly TemplateIssue[], at: { stepId: string; componentId?: string }): TemplateIssue[] {
  return issues.filter((i) => i.step_id === at.stepId && (at.componentId ? i.component_id === at.componentId : i.component_id == null));
}

/** The issues of the template as a whole (no step). */
export const templateIssues = (issues: readonly TemplateIssue[]) => issues.filter((i) => i.step_id == null);
