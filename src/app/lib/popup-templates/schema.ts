/**
 * Popup templates — the envelope of a station's test popup, one per station type
 * (docs/popup-templates/PLAN.md §3). The admin assembles it from a closed catalog of
 * components; the design (shell, rail, buttons, colours) stays locked. The route's
 * station fields are not defined here: the `route_fields` component only says where
 * they appear.
 *
 * A template never names a station: titles and messages use variables ({עמדה} is the
 * station type's name from the DB at run time), so seeds and code stay name-free.
 *
 * Pure module: imported by the popup, the settings screen and the API alike —
 * no prisma, no next, no React, no Node-only APIs.
 */
import type { NoteMax } from "@/app/lib/station-fields/schema";

// ---- bases --------------------------------------------------------------------
/** "item": a station that tests one item. "package": a package-level station that tests the box
 *  and its items in one popup (PLAN.md §5). */
export const TEMPLATE_BASES = ["item", "package"] as const;
export type TemplateBase = (typeof TEMPLATE_BASES)[number];

/** A package template's role: the box's opening (its first step) or its closing (its last). */
export const PACKAGE_ROLES = ["opening", "closing"] as const;
export type PackageRole = (typeof PACKAGE_ROLES)[number];

// ---- ids ----------------------------------------------------------------------
export type TemplateStepId = string; // /^p_[a-z0-9]{8}$/
export type ComponentId = string;    // /^k_[a-z0-9]{8}$/

export const TEMPLATE_ID_PATTERNS = {
  step: /^p_[a-z0-9]{8}$/,
  component: /^k_[a-z0-9]{8}$/,
  /** photo_types.code: a new photo component's own id, or an existing group's code (seeded). */
  photoCode: /^[A-Za-z0-9_-]{1,50}$/,
  /** A checklist row. */
  checkItem: /^i_[a-z0-9]{8}$/,
} as const;

// ---- components ---------------------------------------------------------------
export const COMPONENT_KINDS = [
  "sku_scan", "message", "photo", "weight", "route_fields", "verdict",
  "checklist", "notes", "contents", "items", "labels", "arrival",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** What each place of a template may hold (PLAN.md §3.2, §5.2). The package base's system parts
 *  (contents / items / labels in an opening, arrival in a closing) are the wizards' own steps. */
export const KINDS_ALLOWED = {
  item: ["sku_scan", "message", "photo", "weight", "route_fields", "verdict"],
  opening: ["sku_scan", "message", "photo", "route_fields", "verdict", "checklist", "notes", "contents", "items", "labels"],
  closing: ["sku_scan", "message", "photo", "route_fields", "verdict", "checklist", "notes", "arrival"],
  item_flow: ["sku_scan", "message", "photo", "weight", "route_fields", "verdict"],
} as const satisfies Record<string, readonly ComponentKind[]>;

/** The package base's system parts: each alone in its step, in this order. */
export const SYSTEM_KINDS = ["contents", "items", "labels", "arrival"] as const satisfies readonly ComponentKind[];

interface ComponentBase { id: ComponentId }

/** "סריקת מק״ט יצרן": always alone, in the first step. */
export interface SkuScanComponent extends ComponentBase {
  kind: "sku_scan";
  required: boolean;
  /** Start from the SKU the previous station saved (ItemRow.last_sku). */
  carry_last: boolean;
  /** Look the SKU up among the item type's reference items (images, weight). */
  lookup_reference: boolean;
}

/** "הודעת מערכת": an info band; the text may use the variables. */
export interface MessageComponent extends ComponentBase {
  kind: "message";
  text: string;
}

/** "צילום": the photo group itself. Its shots, and the reference images shown over them, are
 *  tagged with `photo_code` (photo_types.code) — the server keeps a photo_types row per photo
 *  component, so the reference-items page lists the component, not a group. */
export interface PhotoComponent extends ComponentBase {
  kind: "photo";
  title: string;
  photo_code: string;
  /** Shots needed before the step can go on; 0 = optional. */
  min: number;
  show_reference: boolean;
}

/** "שקילה מול ייחוס": the measured weight against the reference item's, in grams. */
export interface WeightComponent extends ComponentBase {
  kind: "weight";
  required: boolean;
  /** Allowed deviation, ± percent of the reference weight. */
  tolerance_pct: number;
}

/** "שדות המסלול": where the route's station fields of this step appear. Without one, they appear
 *  right before the verdict. */
export interface RouteFieldsComponent extends ComponentBase { kind: "route_fields" }

/** "פסק דין": pass / fail + note. Exactly one, the last component of the last step. */
export interface VerdictComponent extends ComponentBase {
  kind: "verdict";
  question: string;
  note_max: NoteMax;
}

/** "רשימת סימון": rows the worker ticks (the closing's packing checks today). Every row must be
 *  ticked before the step goes on. */
export interface ChecklistComponent extends ComponentBase {
  kind: "checklist";
  title: string;
  items: { id: string; label: string }[];
}

/** "הערות": a free-text note (the closing's packing note today). */
export interface NotesComponent extends ComponentBase {
  kind: "notes";
  label: string;
}

/** The package base's system parts (PLAN.md §5.2) — no settings: they are the wizards' own steps.
 *  contents  "תכולה וסריאליים" (opening): what is in the box, a serial for every item
 *  items     "פריטים במארז" (opening): every item through the template's item_flow
 *  labels    "מדבקות" (opening): a label for every item
 *  arrival   "פריטים ואריזה" (closing): arrived → packed, not arrived → a decision with a note */
export interface SystemComponent extends ComponentBase { kind: "contents" | "items" | "labels" | "arrival" }

export type TemplateComponent =
  | SkuScanComponent | MessageComponent | PhotoComponent | WeightComponent | RouteFieldsComponent | VerdictComponent
  | ChecklistComponent | NotesComponent | SystemComponent;

// ---- template -----------------------------------------------------------------
export interface TemplateStep {
  id: TemplateStepId;
  /** The rail's title; may use the variables. */
  title: string;
  desc: string;
  components: TemplateComponent[];
}

/** test_station_popup_templates.config. */
export interface PopupTemplateConfig {
  steps: TemplateStep[];
  /** The finish button's label; may use the variables. */
  finish_label: string;
  /** Package base only: opening or closing. */
  role?: PackageRole;
  /** Package base, opening only: what every item goes through — its phases, in order (the "items"
   *  step; today: scan → photo + "הפריט תקין?" → weigh). */
  item_flow?: TemplateStep[];
}

/** A template as the API answers it. */
export interface PopupTemplateJson {
  station_type_id: number;
  base: TemplateBase;
  version: number;
  config: PopupTemplateConfig;
  updated_at: string;
  updated_by: string | null;
}

// ---- variables ----------------------------------------------------------------
/** The variables a title, message or finish label may use, as the admin types them. */
export const TEMPLATE_VARIABLES = {
  station: "{עמדה}",
  sku: "{מק״ט}",
  model: "{דגם}",
  serial: "{סריאלי}",
} as const;

export type TemplateVariableValues = {
  /** test_stations_type's name; empty → "העמדה". */
  station?: string | null;
  sku?: string | null;
  model?: string | null;
  serial?: string | null;
};

/** The text with its variables filled. An unknown value reads "—" (the SKU before the scan), the
 *  station type's name "העמדה" when the DB has none. */
export function fillVariables(text: string, values: TemplateVariableValues): string {
  const pick = (v: string | null | undefined, empty: string) => (v != null && v.trim() !== "" ? v.trim() : empty);
  return text
    .split(TEMPLATE_VARIABLES.station).join(pick(values.station, "העמדה"))
    .split(TEMPLATE_VARIABLES.sku).join(pick(values.sku, "—"))
    .split(TEMPLATE_VARIABLES.model).join(pick(values.model, "—"))
    .split(TEMPLATE_VARIABLES.serial).join(pick(values.serial, "—"));
}

// ---- reading a template -------------------------------------------------------
/** Every component of the template's steps, in popup order (not the item flow). */
export function componentsOf(cfg: PopupTemplateConfig): TemplateComponent[] {
  return cfg.steps.flatMap((s) => s.components);
}

/** Every component, the item flow's included — what owns a photo group, what an id may not repeat. */
export function allComponentsOf(cfg: PopupTemplateConfig): TemplateComponent[] {
  return [...componentsOf(cfg), ...(cfg.item_flow ?? []).flatMap((s) => s.components)];
}

/** The template's SKU scan, if it has one. */
export function skuScanOf(cfg: PopupTemplateConfig): SkuScanComponent | null {
  return (componentsOf(cfg).find((c) => c.kind === "sku_scan") as SkuScanComponent | undefined) ?? null;
}

/** The photo codes the template's photo components write — one photo_types row each. */
export function photoCodesOf(cfg: PopupTemplateConfig): string[] {
  return allComponentsOf(cfg).flatMap((c) => (c.kind === "photo" ? [c.photo_code] : []));
}
