import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import type { RandomSource } from "@/app/lib/station-fields/step-uids";
import { componentsOf } from "@/app/lib/popup-templates/schema";
import type {
  ComponentKind, PopupTemplateConfig, TemplateComponent, TemplateStep,
} from "@/app/lib/popup-templates/schema";
import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import { TEMPLATE_LIMITS } from "@/app/lib/popup-templates/validate";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import { newComponentId, newTemplateStepId, photoStationTemplate, verdictStationTemplate } from "@/app/lib/popup-templates/templates";
import type { CodePopup } from "@/app/lib/popup-templates/codePopups";

/**
 * The template editor's edits (/settings/popup-templates, docs/popup-templates/PLAN.md step 1.6):
 * pure and immutable — every function returns a new config, so the screen keeps the draft in one
 * state and compares it with what was saved.
 */

/** The catalog, in the order the "הוסף רכיב" menu lists it. */
export const CATALOG_ORDER: readonly ComponentKind[] = ["message", "photo", "weight", "route_fields", "sku_scan", "verdict"];

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

// ---- steps ----------------------------------------------------------------------
export function addStep(cfg: PopupTemplateConfig, random?: RandomSource): PopupTemplateConfig {
  const step: TemplateStep = { id: newTemplateStepId(random), title: "שלב חדש", desc: "", components: [] };
  // Before the step that holds the verdict, which stays last.
  const verdictAt = cfg.steps.findIndex((s) => s.components.some((c) => c.kind === "verdict"));
  const at = verdictAt === -1 ? cfg.steps.length : verdictAt;
  return { ...cfg, steps: [...cfg.steps.slice(0, at), step, ...cfg.steps.slice(at)] };
}

export function updateStep(cfg: PopupTemplateConfig, stepId: string, patch: Partial<Pick<TemplateStep, "title" | "desc">>): PopupTemplateConfig {
  return { ...cfg, steps: cfg.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
}

export function removeStep(cfg: PopupTemplateConfig, stepId: string): PopupTemplateConfig {
  return { ...cfg, steps: cfg.steps.filter((s) => s.id !== stepId) };
}

export function moveStep(cfg: PopupTemplateConfig, stepId: string, by: -1 | 1): PopupTemplateConfig {
  const i = cfg.steps.findIndex((s) => s.id === stepId);
  const j = i + by;
  if (i === -1 || j < 0 || j >= cfg.steps.length) return cfg;
  const steps = [...cfg.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return { ...cfg, steps };
}

// ---- components -----------------------------------------------------------------
/** Whether the catalog may add a kind: one SKU scan, one verdict, one place for the route's
 *  fields, up to 8 photos. */
export function canAddKind(cfg: PopupTemplateConfig, kind: ComponentKind): boolean {
  const all = componentsOf(cfg);
  if (kind === "sku_scan" || kind === "verdict" || kind === "route_fields") return !all.some((c) => c.kind === kind);
  if (kind === "photo") return all.filter((c) => c.kind === "photo").length < TEMPLATE_LIMITS.maxPhotos;
  return true;
}

/** Adds a component to a step: before the verdict when the step ends with it, else at the end. */
export function addComponent(cfg: PopupTemplateConfig, stepId: string, kind: ComponentKind, random?: RandomSource): PopupTemplateConfig {
  const comp = newComponent(kind, random);
  return {
    ...cfg,
    steps: cfg.steps.map((s) => {
      if (s.id !== stepId) return s;
      const last = s.components[s.components.length - 1];
      const at = last?.kind === "verdict" && kind !== "verdict" ? s.components.length - 1 : s.components.length;
      return { ...s, components: [...s.components.slice(0, at), comp, ...s.components.slice(at)] };
    }),
  };
}

/** Changes a component's settings (never its id or kind). */
export function updateComponent<C extends TemplateComponent>(cfg: PopupTemplateConfig, componentId: string, patch: Partial<Omit<C, "id" | "kind">>): PopupTemplateConfig {
  return {
    ...cfg,
    steps: cfg.steps.map((s) => ({
      ...s,
      components: s.components.map((c) => (c.id === componentId ? ({ ...c, ...patch } as TemplateComponent) : c)),
    })),
  };
}

export function removeComponent(cfg: PopupTemplateConfig, componentId: string): PopupTemplateConfig {
  return { ...cfg, steps: cfg.steps.map((s) => ({ ...s, components: s.components.filter((c) => c.id !== componentId) })) };
}

/** Moves a component one place within its step; at the step's edge, to the neighbouring step
 *  (its end going up, its start going down). */
export function moveComponent(cfg: PopupTemplateConfig, componentId: string, by: -1 | 1): PopupTemplateConfig {
  const si = cfg.steps.findIndex((s) => s.components.some((c) => c.id === componentId));
  if (si === -1) return cfg;
  const comps = cfg.steps[si].components;
  const ci = comps.findIndex((c) => c.id === componentId);
  const cj = ci + by;
  const steps = cfg.steps.map((s) => ({ ...s, components: [...s.components] }));
  if (cj >= 0 && cj < comps.length) {
    [steps[si].components[ci], steps[si].components[cj]] = [steps[si].components[cj], steps[si].components[ci]];
    return { ...cfg, steps };
  }
  const sj = si + by;
  if (sj < 0 || sj >= steps.length) return cfg;
  const [comp] = steps[si].components.splice(ci, 1);
  if (by < 0) steps[sj].components.push(comp);
  else steps[sj].components.unshift(comp);
  return { ...cfg, steps };
}

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
