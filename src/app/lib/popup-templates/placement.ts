import type { PackageRole } from "./schema";

/**
 * Where a package-level station type stands on the package routes, and so which role its template
 * plays there (docs/popup-templates/PLAN.md §5.1, decision 1). The testing page decides the same way
 * (testing/page.tsx packageKindOf): the last step of a package route of more than one step closes
 * the box; every other step opens it. One rule for the seed, the template editor and the routes
 * page's warning.
 *
 * Pure module: no prisma, no React.
 */

/** The role of a package route's step, by its index (0-based) among `total` steps. */
export function roleAtStep(stepIndex: number, total: number): PackageRole {
  return total > 1 && stepIndex >= total - 1 ? "closing" : "opening";
}

export type RouteSteps = { item_type_id: number; route_steps: readonly number[] };

/**
 * The roles each station type plays on the routes of the package types (`isPackageType`): a type
 * may play both when routes place it differently. Types on no package route are absent.
 */
export function packageRolesByType(routes: readonly RouteSteps[], isPackageType: (itemTypeId: number) => boolean): Map<number, Set<PackageRole>> {
  const out = new Map<number, Set<PackageRole>>();
  for (const r of routes) {
    if (!isPackageType(r.item_type_id)) continue;
    r.route_steps.forEach((typeId, i) => {
      const roles = out.get(typeId) ?? new Set<PackageRole>();
      roles.add(roleAtStep(i, r.route_steps.length));
      out.set(typeId, roles);
    });
  }
  return out;
}

/** The one role a type plays on the package routes, or null when it plays none or both. */
export function soleRole(roles: ReadonlySet<PackageRole> | undefined): PackageRole | null {
  return roles && roles.size === 1 ? [...roles][0] : null;
}
