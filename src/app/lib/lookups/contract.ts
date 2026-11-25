// The lookup tables as their endpoints serialise them, and the rules a settings screen and its route
// share. Client-safe: the reads and the CRUD kit are in src/app/lib/lookups.ts (server only); the
// client's cached copies are in src/app/components/lookups.ts.

/** GET /api/itemTypes: every item type, in table order. */
export type ItemTypeLite = { item_type_id: number; item_type_desc: string; is_package: boolean };

/** GET /api/item-types: every item type, by name. */
export type ItemTypeRow = { id: number; name: string; is_package: boolean };

/** GET /api/settings/item-types (POST and PUT answer the same row). */
export type ItemTypeSettingsRow = ItemTypeLite & { default_route_number: number | null; contents_count: number };

/** GET /api/sources. */
export type SourceRow = { id: number; desc: string };

/** GET /api/stations: by name. */
export type StationRow = { id: number; name: string; typeId: number };

/** GET /api/testing/stations/types: every station type, by id. */
export type StationTypeOption = { id: number; name: string };

/** GET /api/settings/test-stations-type, by id. POST and PUT answer it without `station_count`. */
export type StationTypeRow = {
  test_station_type_id: number;
  test_type_desc: string;
  /** Queue lists parent items only — accessories are tested alongside the parent. */
  package_level: boolean;
  /** Minutes in test/research with no result before the item is auto-released. 0 = never. */
  stale_after_minutes: number;
  station_count?: number;
};

/** GET /api/settings/test-stations (`?typeId=` narrows it to one type); POST and PUT answer it
 *  without the type's name and the live counts. */
export type TestStationRow = {
  test_station_id: number;
  test_station_type_id: number;
  test_station_desc: string;
  status: number;
  is_research: boolean;
  test_type_desc?: string;
  items_in_queue?: number;
  items_in_test?: number;
};

/** GET /api/settings/test-station-status. */
export type StationStatusRow = { test_station_status_id: number; test_station_status_desc: string };

/** The `code` of a settings write refused because another row already has the name (400). */
export const NAME_TAKEN = "NAME_TAKEN";

/**
 * stale_after_minutes = minutes an item may sit in test / in research on a station of this type with
 * no result before /api/cron/release-stale-tests reverts it; 0 = never auto-release. A typed value:
 * undefined when blank, null when it is not a whole number >= 0.
 */
export function readStaleAfterMinutes(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(`${raw}`.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}
