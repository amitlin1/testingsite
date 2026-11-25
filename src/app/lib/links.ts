/**
 * The app's deep links, built in one place: the screens that link and the
 * screens that read the link (their URL state) share these names.
 */

/** /packages reads its search from `q`, its shipment filter from `shipment`, and opens the intake
 *  dialog on `new=1`. */
export const PACKAGES_PARAMS = { q: "q", shipment: "shipment", intake: "new" } as const;

export const PACKAGES_HREF = "/packages";

export function packageHref(id: string | number): string {
  return `/packages/${id}`;
}

export function packagesSearchHref(q: string): string {
  return `${PACKAGES_HREF}?${PACKAGES_PARAMS.q}=${encodeURIComponent(q)}`;
}

export function packagesShipmentHref(shipmentId: string | number): string {
  return `${PACKAGES_HREF}?${PACKAGES_PARAMS.shipment}=${shipmentId}`;
}

export function packagesNewHref(): string {
  return `${PACKAGES_HREF}?${PACKAGES_PARAMS.intake}=1`;
}

export function itemHistoryHref(id: string | number): string {
  return `/items/${id}/history`;
}

/** /testing's URL state that other screens link to: a station's queue, one item. */
export const TESTING_PARAMS = { station: "station", item: "item" } as const;

/** The testing screen narrowed to a station's queue and / or one item. */
export function testingQueueHref({ station, item }: { station?: string | number | null; item?: string | number | null }): string {
  const p = new URLSearchParams();
  if (station != null && station !== "") p.set(TESTING_PARAMS.station, String(station));
  if (item != null && item !== "") p.set(TESTING_PARAMS.item, String(item));
  const qs = p.toString();
  return qs ? `/testing?${qs}` : "/testing";
}

/** The package types screen, opened on a package type (its `type` URL state). */
export function settingsPackagesHref(typeId?: number | null): string {
  return typeId == null ? "/settings/packages" : `/settings/packages?type=${typeId}`;
}

/** The stations screen, opened on a station type and optionally one of its stations (its `type` /
 *  `station` URL state). */
export function testStationsHref(typeId: number, stationId?: number): string {
  const base = `/settings/test-stations?type=${typeId}`;
  return stationId == null ? base : `${base}&station=${stationId}`;
}

/** The popup templates screen, opened on a station type's template (its `type` URL state). */
export function popupTemplatesHref(typeId: number): string {
  return `/settings/popup-templates?type=${typeId}`;
}
