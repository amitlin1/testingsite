/**
 * The command palette's search contract: what /api/search/index (the small,
 * preloaded tables) and /api/search/items (items, filtered in the database)
 * answer. Client-safe: no prisma, no server import.
 */

export interface SearchStation {
  id: number;
  desc: string;
  typeId: number;
  typeDesc: string;
  status: number;
  /**
   * Human label for `status` (1 "עבודה", 2 "המתנה", 3 "לא פעילה"). Resolved
   * by /api/search/index because `test_stations.status` has no FK to `test_station_status` —
   * assuming "anything but 1 is inactive" mislabels a station in המתנה.
   */
  statusDesc: string;
  isResearch: boolean;
}

export interface SearchStationType {
  id: number;
  desc: string;
  packageLevel: boolean;
  stationCount: number;
}

export interface SearchItemType {
  id: number;
  desc: string;
}

export interface SearchIndex {
  stations: SearchStation[];
  stationTypes: SearchStationType[];
  itemTypes: SearchItemType[];
}

export interface SearchItem {
  itemId: string;
  serialNo: string;
  makat: string | null;
  model: string | null;
  manufacturerName: string | null;
  manufacturerNo: string | null;
  customerCode: string | null;
  shipmentCode: string | null;
  itemTypeDesc: string | null;
  statusDesc: string | null;
  stationDesc: string | null;
  isFinished: boolean;
  /** Package model (docs/features/packages/PLAN.md): this row is a box. */
  isPackage: boolean;
  /** The box this item sits in (null for a box or a legacy loose item). */
  packageId: string | null;
  packageSeq: number | null;
  /**
   * The station whose testing-screen queue this item actually shows up in, or
   * null when it shows up in none (finished, or no matching station). Resolved
   * in SQL against the same rules /api/testing/items uses to build a queue
   * (the LATERAL in api/search/items/route.ts) — so the palette never offers a
   * link that lands on an empty queue.
   */
  queueStationId: number | null;
  queueStationTypeId: number | null;
  queueStationDesc: string | null;
}

/** /api/search/items answers [] below this length: a shorter substring match returns half the table. */
export const ITEM_SEARCH_MIN_QUERY = 2;
/** /api/search/items result cap. The palette shows a handful; more is noise, not help. */
export const ITEM_SEARCH_LIMIT = 8;
