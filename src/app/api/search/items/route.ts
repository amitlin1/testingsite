import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listedAtStation } from "@/app/lib/testing/queue-rule";
import { DEFAULT_ROUTE_NUMBER } from "@/app/lib/packages/template-wire";
import { ITEM_SEARCH_LIMIT, ITEM_SEARCH_MIN_QUERY, type SearchItem } from "@/app/lib/search/contract";

export const runtime = "nodejs";

// Item search for the command palette — filtered IN THE DATABASE.
//
// Deliberately not client-side: `items` is unbounded (unlike stations and
// station types, which the palette preloads via /api/search/index), so
// fetching everything and calling String.includes per keystroke — what the
// existing screens do — does not scale. This matches across every identifier
// a user might actually type at us, capped and ranked in SQL.

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
  if (q.length < ITEM_SEARCH_MIN_QUERY) return NextResponse.json([]);

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
        COALESCE(it.is_package, false)  AS is_package,
        i.package_id,
        i.package_seq,
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
      -- The station whose testing queue lists this item (lib/testing/queue-rule.ts).
      LEFT JOIN LATERAL (
        SELECT s.test_station_id, s.test_station_type_id, s.test_station_desc
        FROM test_stations s
        LEFT JOIN test_stations_type stt ON stt.test_station_type_id = s.test_station_type_id
        WHERE COALESCE(ir.is_finished, false) = false
          AND ${listedAtStation({
            route: "ir",
            item: "i",
            stationId: Prisma.sql`s.test_station_id`,
            stationTypeId: Prisma.sql`s.test_station_type_id`,
            stationIsResearch: Prisma.sql`s.is_research`,
            stationPackageLevel: Prisma.sql`stt.package_level`,
            currentStepTypeId: Prisma.sql`(SELECT tr.route_steps[ir.current_route_step] FROM testing_routes tr
                                            WHERE tr.item_type_id = i.item_type_id AND tr.route_number = COALESCE(ir.route_number, ${DEFAULT_ROUTE_NUMBER})
                                            LIMIT 1)`,
          })}
        -- Prefer the station the route already points at, then a working one.
        ORDER BY (s.test_station_id = ir.test_station_id) DESC, s.status ASC, s.test_station_id ASC
        LIMIT 1
      ) qs ON true
      WHERE
           i.serial_no          ILIKE ${pattern}
        OR i.makat::text        ILIKE ${pattern}
        OR i.item_id::text      ILIKE ${pattern}
        OR i.package_id::text   ILIKE ${pattern}
        OR i.model              ILIKE ${pattern}
        OR i.manufacturer_name  ILIKE ${pattern}
        OR i.manufacturer_no    ILIKE ${pattern}
        OR c.customer_code      ILIKE ${pattern}
        OR sh.shipment_code     ILIKE ${pattern}
        OR it.item_type_desc    ILIKE ${pattern}
      ORDER BY score DESC, i.item_id DESC
      LIMIT ${ITEM_SEARCH_LIMIT}
    `;

    const items: SearchItem[] = rows.map((r) => ({
      itemId: String(r.item_id),
      serialNo: String(r.serial_no ?? ""),
      makat: r.makat == null ? null : String(r.makat),
      model: (r.model as string | null)?.trim() ?? null,
      manufacturerName: (r.manufacturer_name as string | null)?.trim() ?? null,
      manufacturerNo: (r.manufacturer_no as string | null)?.trim() ?? null,
      customerCode: (r.customer_code as string | null)?.trim() ?? null,
      shipmentCode: (r.shipment_code as string | null)?.trim() ?? null,
      itemTypeDesc: (r.item_type_desc as string | null)?.trim() ?? null,
      statusDesc: (r.item_status_desc as string | null)?.trim() ?? null,
      stationDesc: (r.test_station_desc as string | null)?.trim() ?? null,
      isFinished: Boolean(r.is_finished),
      isPackage: Boolean(r.is_package),
      packageId: r.package_id == null ? null : String(r.package_id),
      packageSeq: r.package_seq == null ? null : Number(r.package_seq),
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
