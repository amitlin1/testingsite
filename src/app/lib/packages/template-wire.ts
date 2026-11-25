/**
 * The package template (package_contents: which item types a box of a
 * package type holds, how many, on which route — docs/packages/PLAN.md §3) as
 * the settings screens receive it. Client-safe: no prisma, no server import.
 */

/** A route number left blank is route 1 — on a template line and as a type's default route. */
export const DEFAULT_ROUTE_NUMBER = 1;

/** A box's route: the one asked for, else its package type's default route, else route 1. */
export const boxRouteNumber = (asked: number | null | undefined, typeDefault: number | null | undefined): number =>
  asked ?? typeDefault ?? DEFAULT_ROUTE_NUMBER;

/** An item's route inside its box: the one asked for, else its template line's, else route 1. */
export const itemRouteNumber = (asked: number | null | undefined, line: { route_number: number } | null | undefined): number =>
  asked ?? line?.route_number ?? DEFAULT_ROUTE_NUMBER;

/** An item type without the route a template line asks for (the route rules, the steps tab). */
export const itemRouteMissingText = (routeNumber: number): string => `לסוג הפריט אין מסלול מספר ${routeNumber}`;

/** The warning for a package type with no route at all (the template editor, the route fork). */
export const KIT_HAS_NO_ROUTE = "לסוג המארז עדיין אין מסלול";

/** A row of GET /api/settings/package-types. */
export type PackageTypeSummary = {
  item_type_id: number;
  item_type_desc: string;
  default_route_number: number | null;
  /** Distinct item types in the template. */
  kinds: number;
  /** Sum of quantities in the template. */
  total_items: number;
  /** ok = every route fits; warn = at least one problem; none = no template. */
  health: "ok" | "warn" | "none";
  warning: string | null;
  /** Packages created from this type (for the delete guard on the screen). */
  package_count: number;
};

/** One line of a template, with the warning its route earns against the kit's routes. */
export type TemplateLineView = {
  id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  route_number: number;
  sort_order: number;
  route_warning: string | null;
};

/** GET / PUT /api/settings/item-types/[id]/contents. */
export type TemplateDescription = {
  package_type_id: number;
  item_type_desc: string;
  default_route_number: number | null;
  total_items: number;
  package_route_warnings: string[];
  lines: TemplateLineView[];
};

/** How many units a template line puts in the box: at least one. */
export const unitsOfLine = (quantity: number) => Math.max(1, quantity);

/** The package_seq range each line's units take, exactly as the intake
 *  numbers them (lib/packages/boxes.ts intakeBox): the lines in order, each
 *  unitsOfLine rows, the n-th row package_seq n. */
export function templateSeqRanges<T extends { quantity: number }>(lines: T[]): (T & { seq_from: number; seq_to: number })[] {
  let next = 1;
  return lines.map((l) => {
    const seq_from = next;
    next += unitsOfLine(l.quantity);
    return { ...l, seq_from, seq_to: next - 1 };
  });
}

/** A default route number as a form sends it: "" / null → none; otherwise a
 *  whole number ≥ 1, or `message`. */
export function parseDefaultRoute(
  raw: unknown,
  message = "מסלול ברירת מחדל חייב להיות מספר שלם, 1 או יותר",
): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return { value: null };
  const n = typeof raw === "number" ? raw : Number(`${raw}`.trim());
  if (!Number.isInteger(n) || n < 1) return { error: message };
  return { value: n };
}
