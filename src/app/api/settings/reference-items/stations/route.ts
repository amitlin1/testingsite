import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { parsePopupTemplateConfig } from '@/app/lib/popup-templates/validate';
import type { PopupTemplateConfig } from '@/app/lib/popup-templates/schema';
import { referenceStationsOf } from '@/lib/reference-stations';

export const runtime = 'nodejs';

/**
 * GET /api/settings/reference-items/stations — the stations the reference-items page uploads to
 * (src/lib/reference-stations.ts): every station type's name, and per item type the station types
 * of its routes that show reference images, in route order. A real error answers 500, never an
 * empty answer: the page then says so instead of offering no station.
 */
export async function GET() {
  try {
    const [types, routes, packageTypes, templates] = await Promise.all([
      prisma.test_stations_type.findMany({ select: { test_station_type_id: true, test_type_desc: true, package_level: true } }),
      prisma.testing_routes.findMany({ select: { item_type_id: true, route_number: true, route_steps: true } }),
      prisma.item_types.findMany({ where: { is_package: true }, select: { item_type_id: true } }),
      prisma.station_popup_templates.findMany({ select: { test_station_type_id: true, config: true } }),
    ]);
    const configs = new Map<number, PopupTemplateConfig>();
    for (const t of templates) {
      try {
        configs.set(t.test_station_type_id, parsePopupTemplateConfig(t.config));
      } catch {
        // A stored template that no longer parses opens today's popup at the station
        // (TemplateStation's fallback): the type is judged without it.
      }
    }
    return NextResponse.json(referenceStationsOf({
      stationTypes: types.map((t) => ({ id: t.test_station_type_id, name: t.test_type_desc.trim(), packageLevel: t.package_level })),
      routes,
      packageItemTypeIds: new Set(packageTypes.map((t) => t.item_type_id)),
      templates: configs,
    }));
  } catch (error) {
    console.error('Error fetching reference stations:', error);
    return NextResponse.json({ error: 'Failed to fetch reference stations' }, { status: 500 });
  }
}
