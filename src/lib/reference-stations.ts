import { CODE_POPUPS } from '@/app/lib/popup-templates/codePopups';
import type { CodePopup } from '@/app/lib/popup-templates/codePopups';
import { packageRolesByType } from '@/app/lib/popup-templates/placement';
import type { RouteSteps } from '@/app/lib/popup-templates/placement';
import { allComponentsOf } from '@/app/lib/popup-templates/schema';
import type { PopupTemplateConfig } from '@/app/lib/popup-templates/schema';

/**
 * Which stations take reference images, per item type (docs/popup-templates/PLAN.md §5ג): the
 * reference-items page lists them, in the order of the item's route, and uploads to each one. The
 * station type is the reference set — a station shows the images uploaded to its own type.
 *
 * A station type shows reference images when its popup does:
 *   - with a popup template: a photo component with "show reference images" (the box's or an item
 *     flow's photo in a package template included);
 *   - without one: a per-item type whose code popup is the photo popup (CODE_POPUPS), or a
 *     package-level type that opens a package route (the opening wizard shows the box's and the
 *     items' reference images; placement.ts — the closing wizard shows none).
 *
 * Pure module: no prisma, no React. The API route loads what it needs.
 */

export type ReferenceStation = { id: number; name: string };

export type ReferenceStations = {
  /** Every station type — the name of a station an image is on even when it left the route. */
  stations: ReferenceStation[];
  /** Item type id → the station types of its routes that show reference images, in route order
   *  (route 1's steps, then each further route's new ones). */
  byItemType: Record<string, number[]>;
};

export type ReferenceStationsInput = {
  stationTypes: readonly { id: number; name: string; packageLevel: boolean }[];
  /** Every route, with its route_number. */
  routes: readonly (RouteSteps & { route_number: number })[];
  packageItemTypeIds: ReadonlySet<number>;
  /** Station type id → its popup template's config. */
  templates: ReadonlyMap<number, PopupTemplateConfig>;
  codePopups?: Readonly<Record<number, CodePopup>>;
};

export function showsReferenceImages(
  typeId: number,
  input: Pick<ReferenceStationsInput, 'templates' | 'codePopups'> & { packageLevel: boolean; opens: boolean },
): boolean {
  const template = input.templates.get(typeId);
  if (template) return allComponentsOf(template).some((c) => c.kind === 'photo' && c.show_reference);
  if (input.packageLevel) return input.opens;
  return (input.codePopups ?? CODE_POPUPS)[typeId]?.kind === 'photo';
}

export function referenceStationsOf(input: ReferenceStationsInput): ReferenceStations {
  const roles = packageRolesByType(input.routes, (id) => input.packageItemTypeIds.has(id));
  const byId = new Map(input.stationTypes.map((t) => [t.id, t]));
  const shows = new Map<number, boolean>();
  const showsOf = (typeId: number): boolean => {
    let v = shows.get(typeId);
    if (v === undefined) {
      const t = byId.get(typeId);
      v = t != null && showsReferenceImages(typeId, {
        templates: input.templates,
        codePopups: input.codePopups,
        packageLevel: t.packageLevel,
        opens: roles.get(typeId)?.has('opening') ?? false,
      });
      shows.set(typeId, v);
    }
    return v;
  };

  const byItemType: Record<string, number[]> = {};
  const routes = [...input.routes].sort((a, b) => a.item_type_id - b.item_type_id || a.route_number - b.route_number);
  for (const r of routes) {
    const list = (byItemType[String(r.item_type_id)] ??= []);
    for (const typeId of r.route_steps) {
      if (!list.includes(typeId) && showsOf(typeId)) list.push(typeId);
    }
  }
  return {
    stations: [...input.stationTypes].sort((a, b) => a.id - b.id).map((t) => ({ id: t.id, name: t.name })),
    byItemType,
  };
}
