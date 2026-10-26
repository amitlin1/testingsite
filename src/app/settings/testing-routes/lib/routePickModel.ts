/**
 * The context card's two pickers (2026-10-26, Amit): a route is chosen by its PACKAGE type first,
 * then by one of that type's route numbers. Item types are never offered — an item's route is
 * reached from its kit, in "שלבי המסלול". Pure, so the page and the tests share it.
 */

/** A row of GET /api/settings/testing-routes (the members this screen reads). */
export type RouteRow = {
  item_type_id: number;
  route_number: number;
  route_steps: number[];
};

/** An item type as the page loads it (GET /api/settings/item-types). */
export type ItemTypeRow = {
  id: number;
  label: string;
  isPackage: boolean;
  /** item_types.default_route_number — package types only; null = 1. */
  defaultRoute: number | null;
};

/** One package type of the "סוג מארז" list. */
export type KitTypeOption = {
  id: number;
  label: string;
  /** How many routes it has (the option's subtitle). */
  routeCount: number;
};

/** One number of the "מספר מסלול" list. */
export type RouteNumberOption = {
  route: number;
  /** Steps of the route; 0 for a number that has no route yet. */
  stations: number;
  /** The package type's default_route_number (null = 1). */
  isDefault: boolean;
  /** No route has this number yet: saving its steps creates it. */
  isNew: boolean;
};

/** Every package type, by name. */
export function kitTypeOptions(types: readonly ItemTypeRow[], routes: readonly RouteRow[]): KitTypeOption[] {
  const counts = new Map<number, number>();
  for (const r of routes) counts.set(r.item_type_id, (counts.get(r.item_type_id) ?? 0) + 1);
  return types
    .filter((t) => t.isPackage)
    .map((t) => ({ id: t.id, label: t.label.trim(), routeCount: counts.get(t.id) ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, "he") || a.id - b.id);
}

/**
 * The route numbers of a package type, in order, then ONE number without a route: the one open now
 * when it has none yet, else the next free number — so a new route is always one pick away.
 */
export function routeNumberOptions(
  typeId: number,
  routes: readonly RouteRow[],
  defaultRoute: number | null,
  current: number | null,
): RouteNumberOption[] {
  const def = defaultRoute ?? 1;
  const existing = routes
    .filter((r) => r.item_type_id === typeId)
    .sort((a, b) => a.route_number - b.route_number)
    .map((r) => ({ route: r.route_number, stations: (r.route_steps ?? []).length, isDefault: r.route_number === def, isNew: false }));
  const taken = new Set(existing.map((o) => o.route));
  let fresh: number;
  if (current != null && !taken.has(current)) fresh = current;
  else if (existing.length === 0) fresh = def;
  else fresh = Math.max(...taken) + 1;
  const out: RouteNumberOption[] = [...existing, { route: fresh, stations: 0, isDefault: fresh === def, isNew: true }];
  return out.sort((a, b) => a.route - b.route);
}

/** The route a package type opens on when it is picked: its default when that route exists, else
 *  its lowest route, else the default number (a new route). */
export function routeForKitType(typeId: number, routes: readonly RouteRow[], defaultRoute: number | null): number {
  const def = defaultRoute ?? 1;
  const numbers = routes.filter((r) => r.item_type_id === typeId).map((r) => r.route_number);
  if (numbers.includes(def)) return def;
  return numbers.length > 0 ? Math.min(...numbers) : def;
}
