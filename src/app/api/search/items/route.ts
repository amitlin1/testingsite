import { prisma } from "@/app/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Item search for the command palette — filtered IN THE DATABASE.
//
// Deliberately not client-side: `items` is unbounded (unlike stations and
// station types, which the palette preloads via /api/search/index), so
// fetching everything and calling String.includes per keystroke — what the
// existing screens do — does not scale. This matches across every identifier
// a user might actually type at us, capped and ranked in SQL.

/** Result cap. The palette shows a handful; more is noise, not help. */
const LIMIT = 8;
/** Shorter than this and a substring match returns half the table. */
const MIN_QUERY = 2;

export interface SearchItem {
  itemId: string;
  serialNo: string;
  makat: number | null;
  model: string | null;
  manufacturerName: string | null;
  manufacturerNo: string | null;
  customerCode: string | null;
  shipmentCode: string | null;
  itemTypeDesc: string | null;
  statusDesc: string | null;
  stationDesc: string | null;
  isFinished: boolean;
  /**
   * The station whose testing-screen queue this item actually shows up in, or
   * null when it shows up in none (finished, or no matching station). Resolved
   * in SQL against the same rules /api/testing/items uses to build a queue —
   * see the LATERAL below — so the palette never offers a link that lands on an
   * empty queue.
   */
  queueStationId: number | null;
  queueStationTypeId: number | null;
  queueStationDesc: string | null;
}

/**
 * Escape the LIKE metacharacters so a user typing "100%" searches for a
 * literal percent instead of matching everything. Backslash first — otherwise
 * it would double-escape the escapes we add right after.
 */
function likePattern(q: string): string {
  return `%${q.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) return NextResponse.json([]);

  try {
    const pattern = likePattern(q);
    // Prefix matches rank above mid-string ones, and an exact serial/מק״ט hit
    // wins outright — typing a full serial should put that item first, not
    // bury it under items that merely contain the digits.
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        i.item_id,
        i.serial_no,
        i.makat,
        RTRIM(i.model)             AS model,
        RTRIM(i.manufacturer_name) AS manufacturer_name,
        i.manufacturer_no,
        RTRIM(c.customer_code)     AS customer_code,
        sh.shipment_code,
        it.item_type_desc,
        ist.item_status_desc,
        ts.test_station_desc,
        COALESCE(ir.is_finished, false) AS is_finished,
        qs.test_station_id      AS queue_station_id,
        qs.test_station_type_id AS queue_station_type_id,
        RTRIM(qs.test_station_desc) AS queue_station_desc,
        (CASE
          WHEN i.serial_no = ${q} OR i.makat::text = ${q} OR i.item_id::text = ${q} THEN 100
          WHEN i.serial_no ILIKE ${q + "%"} OR i.makat::text ILIKE ${q + "%"}     THEN 80
          WHEN RTRIM(i.model) ILIKE ${q + "%"}                                    THEN 60
          ELSE 40
        END) AS score
      FROM items i
      LEFT JOIN item_types    it  ON it.item_type_id     = i.item_type_id
      LEFT JOIN item_routes   ir  ON ir.item_id          = i.item_id
      LEFT JOIN item_status   ist ON ist.item_status_id  = ir.current_status
      LEFT JOIN test_stations ts  ON ts.test_station_id  = ir.test_station_id
      LEFT JOIN customers     c   ON c.id                = i.customer_id
      LEFT JOIN shipments     sh  ON sh.id               = i.shipment_id
      -- Which station's queue would actually list this item? Mirrors the WHERE
      -- in /api/testing/items: status 1/5 sit AT a station, status 2 waits for
      -- any station of the current route step's type, status 4 waits for any
      -- research station, and a parents_only type never lists an accessory.
      LEFT JOIN LATERAL (
        SELECT s.test_station_id, s.test_station_type_id, s.test_station_desc
        FROM test_stations s
        LEFT JOIN test_stations_type stt ON stt.test_station_type_id = s.test_station_type_id
        WHERE COALESCE(ir.is_finished, false) = false
          AND ir.finished_at IS NULL
          AND (COALESCE(stt.parents_only, false) = false OR i.parent_item_id IS NULL)
          AND (
               (ir.current_status = 1 AND s.test_station_id = ir.test_station_id)
            OR (ir.current_status = 5 AND s.test_station_id = ir.test_station_id AND s.is_research)
            OR (ir.current_status = 4 AND s.is_research)
            OR (ir.current_status = 2 AND s.test_station_type_id = (
                  SELECT tr.route_steps[ir.current_route_step]
                  FROM testing_routes tr
                  WHERE tr.item_type_id = i.item_type_id
                    AND tr.route_number = COALESCE(ir.route_number, 1)
                  LIMIT 1))
          )
        -- Prefer the station the route already points at, then a working one.
        ORDER BY (s.test_station_id = ir.test_station_id) DESC, s.status ASC, s.test_station_id ASC
        LIMIT 1
      ) qs ON true
      WHERE
           i.serial_no          ILIKE ${pattern}
        OR i.makat::text        ILIKE ${pattern}
        OR i.item_id::text      ILIKE ${pattern}
        OR i.model              ILIKE ${pattern}
        OR i.manufacturer_name  ILIKE ${pattern}
        OR i.manufacturer_no    ILIKE ${pattern}
        OR c.customer_code      ILIKE ${pattern}
        OR sh.shipment_code     ILIKE ${pattern}
        OR it.item_type_desc    ILIKE ${pattern}
      ORDER BY score DESC, i.item_id DESC
      LIMIT ${LIMIT}
    `;

    const items: SearchItem[] = rows.map((r) => ({
      itemId: String(r.item_id),
      serialNo: String(r.serial_no ?? ""),
      makat: r.makat == null ? null : Number(r.makat),
      model: (r.model as string | null)?.trim() ?? null,
      manufacturerName: (r.manufacturer_name as string | null)?.trim() ?? null,
      manufacturerNo: (r.manufacturer_no as string | null)?.trim() ?? null,
      customerCode: (r.customer_code as string | null)?.trim() ?? null,
      shipmentCode: (r.shipment_code as string | null)?.trim() ?? null,
      itemTypeDesc: (r.item_type_desc as string | null)?.trim() ?? null,
      statusDesc: (r.item_status_desc as string | null)?.trim() ?? null,
      stationDesc: (r.test_station_desc as string | null)?.trim() ?? null,
      isFinished: Boolean(r.is_finished),
      queueStationId: r.queue_station_id == null ? null : Number(r.queue_station_id),
      queueStationTypeId: r.queue_station_type_id == null ? null : Number(r.queue_station_type_id),
      queueStationDesc: (r.queue_station_desc as string | null)?.trim() ?? null,
    }));

    return NextResponse.json(items);
  } catch (error) {
    console.error("Error searching items:", error);
    return NextResponse.json([]);
  }
}
