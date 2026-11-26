import { prisma } from "@/lib/db";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { ItemStatus } from "@/lib/item-status";
import {
  ITEM_STATE_LABEL, PACKAGE_STATUS_LABEL, packageMatches,
  type PackageItemView, type PackageStatusKey, type PackageTimelineEntry, type PackageView,
} from "./contract";
import { itemsAwaitingFinalSignature } from "@/app/lib/item-report/lifecycle";
import { arrivedAtClosing, atGateStep, blocksGate, decisionsOf, itemState, itemWhereText, packageStatus } from "./rules";

/**
 * Read side of the package model — what the packages list, the package page,
 * the queue cards and the item dialog show. Everything is derived from the
 * operational tables (items / item_routes / item_route_history /
 * test_results); nothing here writes. The shapes it answers with are the
 * client-safe contract (./contract.ts).
 *
 * A pending box is minted with its shipment and has no route yet (boxes.ts).
 */

export type PackageListFilters = {
  shipmentId?: number | null;
  customerId?: number | null;
  packageTypeId?: number | null;
  status?: PackageStatusKey | null;
  q?: string | null;
  /** Restrict to these package ids (the queue / item dialog reuse the view). */
  ids?: bigint[] | null;
  /** Leave out boxes whose shipment already went out (shipments.is_sent). */
  excludeSent?: boolean;
};

type PkgRow = {
  item_id: bigint;
  item_type_id: number;
  item_type_desc: string;
  customer_id: number;
  customer_code: string | null;
  customer_name: string | null;
  shipment_id: number;
  shipment_code: string | null;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  route_number: number | null;
  current_status: number | null;
  current_route_step: number | null;
  current_step_type_id: number | null;
  current_step_desc: string | null;
  current_step_package_level: boolean | null;
  station_name: string | null;
  route_length: number | null;
  is_finished: boolean | null;
  shipment_is_sent: boolean | null;
  shipment_sent_date: Date | null;
  created_at: Date | null;
  finished_at: Date | null;
  opened_at: Date | null;
  template_snapshot: unknown;
  closing_details: unknown;
  opening_sku: string | null;
  /** Has a route row: taken in. */
  routed: boolean;
  shipment_item_id: number | null;
  cert_row_no: string | null;
  cert_serial_no: string | null;
};

type MemberRow = {
  item_id: bigint;
  package_id: bigint;
  package_seq: number | null;
  item_type_id: number;
  item_type_desc: string;
  serial_no: string | null;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  current_status: number | null;
  current_route_step: number | null;
  route_length: number | null;
  is_finished: boolean | null;
  step_type_id: number | null;
  step_type_desc: string | null;
  station_name: string | null;
  last_step_type_id: number | null;
  prev_step_desc: string | null;
  prev_step_package_level: boolean | null;
};

const iso = (d: Date | null | undefined) => (d ? normalizeToUtcIso(d) : null);

export async function loadPackages(filters: PackageListFilters = {}): Promise<PackageView[]> {
  const idsFilter = filters.ids && filters.ids.length > 0 ? filters.ids : null;
  const pkgs = await prisma.$queryRaw<PkgRow[]>`
    SELECT i.item_id, i.item_type_id, TRIM(it.item_type_desc) AS item_type_desc,
           i.customer_id, TRIM(c.customer_code) AS customer_code, TRIM(c.name) AS customer_name,
           i.shipment_id, sh.shipment_code,
           i.makat, TRIM(i.model) AS model, TRIM(i.manufacturer_name) AS manufacturer_name, i.manufacturer_no,
           ir.route_number, ir.current_status, ir.current_route_step,
           tr.route_steps[ir.current_route_step] AS current_step_type_id,
           TRIM(pstt.test_type_desc) AS current_step_desc, pstt.package_level AS current_step_package_level,
           TRIM(pts.test_station_desc) AS station_name,
           COALESCE(array_length(tr.route_steps, 1), 0) AS route_length,
           sh.is_sent AS shipment_is_sent, sh.shipment_sent_date,
           ir.is_finished, ir.created_at, ir.finished_at,
           (SELECT max(h.processing_end_time) FROM item_route_history h
             WHERE h.item_id = i.item_id AND h.current_route_step = 1) AS opened_at,
           i.template_snapshot,
           (SELECT r.details FROM test_results r
             WHERE r.item_id = i.item_id
               AND r.route_step = COALESCE(array_length(tr.route_steps, 1), 0)
             ORDER BY r.test_result_id DESC LIMIT 1) AS closing_details,
           (SELECT NULLIF(TRIM(r.details->>'sku'), '') FROM test_results r
             WHERE r.item_id = i.item_id AND r.route_step = 1
             ORDER BY r.test_result_id DESC LIMIT 1) AS opening_sku,
           (ir.item_id IS NOT NULL) AS routed,
           i.shipment_item_id, NULLIF(TRIM(si.cert_row_no), '') AS cert_row_no, NULLIF(TRIM(si.serial_no), '') AS cert_serial_no
    FROM items i
    JOIN item_types it ON it.item_type_id = i.item_type_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN shipments sh ON sh.id = i.shipment_id
    LEFT JOIN shipment_items si ON si.id = i.shipment_item_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
    LEFT JOIN test_stations_type pstt ON pstt.test_station_type_id = tr.route_steps[ir.current_route_step]
    LEFT JOIN test_stations pts ON pts.test_station_id = ir.test_station_id
    WHERE i.package_id IS NULL AND it.is_package = true
      AND (${filters.excludeSent === true}::boolean = false OR COALESCE(sh.is_sent, false) = false)
      AND (${filters.shipmentId ?? null}::int IS NULL OR i.shipment_id = ${filters.shipmentId ?? null}::int)
      AND (${filters.customerId ?? null}::int IS NULL OR i.customer_id = ${filters.customerId ?? null}::int)
      AND (${filters.packageTypeId ?? null}::int IS NULL OR i.item_type_id = ${filters.packageTypeId ?? null}::int)
      AND (${idsFilter}::bigint[] IS NULL OR i.item_id = ANY(${idsFilter}::bigint[]))
    ORDER BY ir.created_at DESC NULLS LAST, i.item_id DESC
  `;
  if (pkgs.length === 0) return [];

  const pkgIds = pkgs.map((p) => p.item_id);
  const members = await prisma.$queryRaw<MemberRow[]>`
    SELECT i.item_id, i.package_id, i.package_seq, i.item_type_id, TRIM(it.item_type_desc) AS item_type_desc,
           i.serial_no, i.makat, TRIM(i.model) AS model, TRIM(i.manufacturer_name) AS manufacturer_name, i.manufacturer_no,
           ir.current_status, ir.current_route_step,
           COALESCE(array_length(tr.route_steps, 1), 0) AS route_length,
           ir.is_finished,
           tr.route_steps[ir.current_route_step] AS step_type_id,
           stt.test_type_desc AS step_type_desc,
           ts.test_station_desc AS station_name,
           tr.route_steps[array_length(tr.route_steps, 1)] AS last_step_type_id,
           TRIM(pvt.test_type_desc) AS prev_step_desc,
           pvt.package_level AS prev_step_package_level
    FROM items i
    JOIN item_types it ON it.item_type_id = i.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
    LEFT JOIN test_stations_type stt ON stt.test_station_type_id = tr.route_steps[ir.current_route_step]
    LEFT JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
    LEFT JOIN test_stations_type pvt ON pvt.test_station_type_id = tr.route_steps[ir.current_route_step - 1]
    WHERE i.package_id = ANY(${pkgIds}::bigint[])
    ORDER BY i.package_id, i.package_seq NULLS LAST, i.item_id
  `;

  const byPkg = new Map<string, MemberRow[]>();
  for (const m of members) {
    const k = m.package_id.toString();
    if (!byPkg.has(k)) byPkg.set(k, []);
    byPkg.get(k)!.push(m);
  }

  const views: PackageView[] = [];
  for (const p of pkgs) {
    const decisions = decisionsOf(p.closing_details);
    const decisionOf = (id: bigint) => decisions.find((d) => d.item_id === id.toString());
    const rows = byPkg.get(p.item_id.toString()) ?? [];
    const items: PackageItemView[] = rows.map((m) => {
      const decision = decisionOf(m.item_id);
      const state = itemState(m, p, decision);
      return {
        item_id: m.item_id.toString(),
        package_seq: m.package_seq,
        item_type_id: m.item_type_id,
        item_type_desc: m.item_type_desc,
        serial_no: m.serial_no,
        makat: m.makat,
        model: m.model,
        manufacturer_name: m.manufacturer_name,
        manufacturer_no: m.manufacturer_no,
        current_status: m.current_status,
        current_route_step: m.current_route_step,
        route_length: Number(m.route_length ?? 0),
        step_desc: m.step_type_desc?.trim() || null,
        is_finished: m.is_finished === true,
        state,
        state_label: ITEM_STATE_LABEL[state],
        station_name: itemWhereText(m),
        arrived_at_closing: arrivedAtClosing(m),
        prev_step_desc: m.prev_step_desc || null,
        prev_step_package_level: m.prev_step_package_level === true,
        pack_decision: decision?.decision ?? null,
        pack_note: decision?.note ?? null,
      };
    });

    // Blockers: the members that keep the box out of the closing queue at its
    // gate — the rule the write path uses (readiness.ts), over the members
    // already loaded. Read and gate can race; packageStatus reports what the
    // items say.
    const gateType = atGateStep(p, p.current_step_package_level) ? p.current_step_type_id : null;
    const blocked: PackageView["blocked_by"] = gateType == null || p.current_status === ItemStatus.Done
      ? []
      : rows.flatMap((m, i) => blocksGate(m, gateType)
        ? [{ item_id: items[i].item_id, package_seq: items[i].package_seq, item_type_desc: items[i].item_type_desc, station_name: items[i].station_name }]
        : []);

    const status = packageStatus(p, blocked.length);
    views.push({
      item_id: p.item_id.toString(),
      item_type_id: p.item_type_id,
      item_type_desc: p.item_type_desc,
      customer_id: p.customer_id,
      customer_code: p.customer_code,
      customer_name: p.customer_name,
      shipment_id: p.shipment_id,
      shipment_code: p.shipment_code,
      makat: p.makat,
      model: p.model,
      manufacturer_name: p.manufacturer_name,
      manufacturer_no: p.manufacturer_no,
      route_number: p.route_number,
      current_status: p.current_status,
      current_route_step: p.current_route_step,
      current_step_type_id: p.current_step_type_id,
      current_step_desc: p.current_step_desc || null,
      station_name: p.station_name || null,
      route_length: Number(p.route_length ?? 0),
      is_finished: p.is_finished === true,
      shipment_is_sent: p.shipment_is_sent === true,
      shipment_sent_at: iso(p.shipment_sent_date),
      created_at: iso(p.created_at),
      opened_at: iso(p.opened_at),
      closed_at: iso(p.finished_at),
      status,
      status_label: PACKAGE_STATUS_LABEL[status],
      items,
      finished_count: items.filter((it) => it.state === "done").length,
      awaiting_final_signature: 0,
      blocked_by: blocked,
      template_snapshot: p.template_snapshot ?? null,
      opening_sku: p.opening_sku ?? null,
      shipment_item_id: p.shipment_item_id ?? null,
      cert_row_no: p.cert_row_no ?? null,
      cert_serial_no: p.cert_serial_no ?? null,
    });
  }

  // The closed boxes' items whose report waits for the final signature (the list's
  // "ממתינים לחתימת מאשר"). Only closed boxes: the approver signs after the closing.
  const closed = views.filter((v) => v.status === "done");
  if (closed.length > 0) {
    const awaiting = await itemsAwaitingFinalSignature(closed.flatMap((v) => v.items.map((it) => BigInt(it.item_id))));
    for (const v of closed) v.awaiting_final_signature = v.items.filter((it) => awaiting.has(it.item_id)).length;
  }

  let out = views;
  if (filters.status) out = out.filter((v) => v.status === filters.status);
  const q = filters.q?.trim();
  if (q) out = out.filter((v) => packageMatches(v, q));
  return out;
}

export async function loadPackage(packageId: bigint): Promise<PackageView | null> {
  const [v] = await loadPackages({ ids: [packageId] });
  return v ?? null;
}

/** The box a row belongs to: its own for a box, its box's for an item
 *  inside one, none for a legacy loose item. */
export function boxIdOf(row: { item_id: bigint; package_id: bigint | null; is_package: boolean }): bigint | null {
  return row.package_id ?? (row.is_package ? row.item_id : null);
}

/** The package-level milestones of the box (design: "ציר זמן של המארז"). */
export async function loadPackageTimeline(v: PackageView): Promise<PackageTimelineEntry[]> {
  const history = await prisma.item_route_history.findMany({
    where: { item_id: BigInt(v.item_id) },
    orderBy: { log_id: "asc" },
    select: { current_route_step: true, processing_end_time: true, worker_id: true },
  });
  const opened = history.find((h) => h.current_route_step === 1 && h.processing_end_time);
  const closed = v.route_length > 0 ? history.find((h) => h.current_route_step === v.route_length && h.processing_end_time && v.route_length > 1) : undefined;

  if (v.status === "pending") {
    return [
      { key: "intake", title: "ממתין לקליטה", at: null, worker_id: null, state: "pending", note: "המדבקה הודפסה מהמשלוח" },
      { key: "open", title: "פתיחת מארז", at: null, worker_id: null, state: "pending", note: "טרם התחיל" },
      { key: "close", title: "סגירת מארז", at: null, worker_id: null, state: "pending", note: "טרם התחיל" },
    ];
  }
  const out: PackageTimelineEntry[] = [
    { key: "intake", title: "נקלט מהמשלוח", at: v.created_at, worker_id: null, state: "done", note: null },
  ];
  if (opened) {
    out.push({ key: "open", title: "פתיחת מארז · הושלם", at: iso(opened.processing_end_time), worker_id: opened.worker_id, state: "done", note: null });
  } else if (v.status === "test" && (v.current_route_step ?? 1) <= 1) {
    out.push({ key: "open", title: "פתיחת מארז · בבדיקה", at: null, worker_id: null, state: "pending", note: "בעמדת הפתיחה" });
  } else {
    out.push({ key: "open", title: "פתיחת מארז · בתור", at: null, worker_id: null, state: "queued", note: "ממתין" });
  }
  if (v.status === "done" || (closed && v.is_finished)) {
    out.push({ key: "close", title: "סגירת מארז · הושלם", at: iso(closed?.processing_end_time ?? null) ?? v.closed_at, worker_id: closed?.worker_id ?? null, state: "done", note: null });
  } else if (v.status === "waitItems") {
    out.push({ key: "close", title: "סגירת מארז · ממתין לפריטים", at: null, worker_id: null, state: "blocked", note: `${v.blocked_by.length} פריטים בעמדות אחרות` });
  } else if (v.status === "readyClose") {
    out.push({ key: "close", title: "סגירת מארז · בתור", at: null, worker_id: null, state: "queued", note: "ממתין" });
  } else if (v.status === "test" && (v.current_route_step ?? 1) > 1) {
    out.push({ key: "close", title: "סגירת מארז · בבדיקה", at: null, worker_id: null, state: "pending", note: "בעמדת הסגירה" });
  } else {
    out.push({ key: "close", title: "סגירת מארז", at: null, worker_id: null, state: "pending", note: "טרם התחיל" });
  }
  return out;
}
