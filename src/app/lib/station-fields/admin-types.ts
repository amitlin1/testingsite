/**
 * The JSON wire contract of the admin station-fields API, for the settings screen.
 * Pure (no prisma / next / React): the client imports these types; the server
 * (admin.ts, context.ts) produces exactly these shapes. Dates travel as ISO strings.
 */
import type { Change } from "./diff";
import type { ChoiceOption, Field, GroupTarget, RouteFieldsConfig } from "./schema";
import type { Issue } from "./validate";

/** A kit whose template (package_contents) runs an item type on this route. */
export type SharedKitJson = { package_type_id: number; desc: string };

/** A lint / route-check issue of one route in a multi-route preview or publish. */
export type RouteIssueJson = Issue & { route_id: number };

/** GET /api/settings/testing-routes/[id]/fields — and one route inside fields-context. */
export type RouteFieldsJson = {
  route: { test_route_id: number; item_type_id: number; route_number: number; route_steps: number[]; step_uids: string[] };
  /** Pending changes; null = none (the editor starts from `published`). */
  draft: RouteFieldsConfig | null;
  draft_rev: number;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  /** testing_routes.fields_version: 0 = never published. */
  published_version: number;
  /** The config of `published_version`; null when never published. */
  published: RouteFieldsConfig | null;
  /** Lint + route check of the config the editor shows (draft ?? published). */
  issues: Issue[];
  /** Kits whose template line runs this route — "משותף ל: …". */
  shared_with: SharedKitJson[];
};

/** PUT …/[id]/fields/draft → 200. */
export type DraftSavedJson = { draft_rev: number; draft_updated_at: string; issues: Issue[] };

export const APPLY_MODES = ["new_only", "not_reached"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

/** "הערת גרסה" (artboard 10): at most 2000 characters (spec §3.2). */
export const VERSION_NOTE_MAX = 2000;

/** One route of a publish (artboard 10, "מה השתנה"). */
export type PublishImpactRouteJson = {
  route_id: number;
  /** "מסלול 1 של מחשב" / "מסלול המארז". */
  label: string;
  item_type_id: number;
  item_type_desc: string;
  route_number: number;
  from_version: number;
  to_version: number;
  /** diffConfigs(published, draft); every field_removed row carries filled_count. */
  changes: Change[];
};

/** POST …/fields/publish-preview → 200 (spec §3.4.2). */
export type PublishImpactJson = {
  routes: PublishImpactRouteJson[];
  totals: { changes: number; stations: number; routes: number };
  shared_outside: { route_id: number; item_type_desc: string; route_number: number; kits: SharedKitJson[] }[];
  items_on_routes: number;
  by_version: { route_id: number; version: number | null; count: number }[];
  not_reached: number;
  /** Warnings (errors answer 422 instead). */
  issues: RouteIssueJson[];
  /** draft_rev of every requested route: the base_revs that publish exactly what was previewed. */
  base_revs: Record<number, number>;
};

/** POST …/fields/publish → 200. */
export type PublishResultJson = { publish_batch: string; versions: Record<number, number>; bumped_items: number };

/** GET …/[id]/fields/versions → rows, newest first ("היסטוריית גרסאות"). */
export type FieldVersionSummaryJson = {
  version: number;
  published_at: string;
  published_by_name: string | null;
  note: string | null;
  apply_mode: string;
  publish_batch: string;
  changes: Change[] | null;
};

/** GET …/[id]/fields/versions/[v] → 200. */
export type FieldVersionRowJson = FieldVersionSummaryJson & {
  id: number;
  test_route_id: number;
  config: RouteFieldsConfig;
  published_by: string | null;
};

// ---- libraries (session 2d; spec §3.2 option-lists / field-sets rows, artboards 4 and 8) ---------

/** Where a library item is used: counted over every route's fields_draft AND its latest published
 *  version (a route counts once per place, draft preferred when both have it). */
export type LibraryUseJson = {
  route_id: number;
  step_uid: string;
  /** The group of the cell ("item" | "box" | "each_item" | {item_type_id}). */
  target: GroupTarget;
  /** option lists: the linked field; field sets: the first field of the cell taken from the set. */
  field_id: string;
  /** The version the place holds (list_ref.ver / from_set.ver). */
  ver: number;
  in: "draft" | "published";
  /** Labels for chips like "מארז עמדת עבודה › בדיקה ויזואלית › מחשב" (kit null for an item route). */
  kit_desc: string | null;
  station_label: string;
  item_label: string;
};

/** GET /api/settings/option-lists → OptionListJson[] (archived lists omitted); POST → OptionListJson. */
export type OptionListJson = {
  id: number;
  name: string;
  options: ChoiceOption[];
  version: number;
  updated_at: string;
  updated_by: string | null;
  /** "בשימוש ב-{fields} שדות[ ב-{routes} מסלולים]". */
  usage: { fields: number; routes: number };
};

/** GET /api/settings/field-sets → FieldSetJson[] (archived omitted); POST → FieldSetJson. */
export type FieldSetJson = {
  id: number;
  name: string;
  fields: Field[];
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  /** "בשימוש ב-{cells} תאים"; outdated = cells holding an older version ("{n} תאים משתמשים בגרסה קודמת"). */
  usage: { cells: number; outdated: number };
};

/** PUT /api/settings/option-lists/[id] → 200 (409 VERSION_CONFLICT when base_version is stale). */
export type OptionListSavedJson = { version: number; linked: { route_id: number; step_uid: string; field_id: string }[] };
/** PUT /api/settings/field-sets/[id] → 200 (409 VERSION_CONFLICT). */
export type FieldSetSavedJson = { version: number };
/** POST …/[id]/propagate → 200: how many route drafts were written (drafts only; nothing is published). */
export type PropagateResultJson = { updated_drafts: number };

/** The reason a context route is null: no testing_routes row for (item_type_id, route_number). */
export const ROUTE_MISSING = "ROUTE_MISSING";

/** A station type as the map labels it (test_stations_type). */
export type StationTypeJson = { label: string; package_level: boolean };

/** One package_contents line of the kit, in sort_order, with the item route it runs. */
export type ContextLineJson = {
  line_id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  sort_order: number;
  /** The package_seq range this line's units take inside a kit ("01", "02–03"). */
  seq_from: number;
  seq_to: number;
  route_number: number;
  /** The item route (item_type_id, route_number); null when it does not exist. */
  route: RouteFieldsJson | null;
  /** Why `route` is null (e.g. "ROUTE_MISSING"). */
  missing?: string;
};

/**
 * GET /api/settings/testing-routes/fields-context
 *   ?packageTypeId=&routeNumber=  → kind "package": kit route + one entry per package_contents line
 *   ?itemTypeId=&routeNumber=     → kind "item": one item route, no lines
 * Any failure is a real 5xx — never an empty context (artboard 11: "המסלול לא מוצג כריק").
 */
export type FieldsContextJson = {
  kind: "package" | "item";
  subject: { item_type_id: number; desc: string; is_package: boolean; route_number: number };
  /** Every station type, by test_station_type_id — column labels and package_level. */
  stations: Record<number, StationTypeJson>;
  /** kind "package": the kit's own route (null + kit_missing when it does not exist). */
  kit: RouteFieldsJson | null;
  kit_missing?: string;
  /** kind "item": the item route (null + item_missing when it does not exist). */
  item: RouteFieldsJson | null;
  item_missing?: string;
  /** kind "package": the template lines; kind "item": []. */
  lines: ContextLineJson[];
};
