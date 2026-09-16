import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { computePackageGate } from "./readiness";

/**
 * Read side of the package model — what the packages list, the package page,
 * the queue cards and the item dialog show. Everything is derived from the
 * operational tables (items / item_routes / item_route_history /
 * test_results); nothing here writes.
 *
 * Vocabulary (design/Packages.dc.html):
 *   item state   new (טרם נפתח) · queue (ממתין) · test (בבדיקה) · done (הושלם) · missing (חסר במארז)
 *   box status   queue (ממתין לפתיחה) · test (בבדיקה) · waitItems (ממתין לפריטי המארז) ·
 *                readyClose (ממתין לסגירה) · done (הושלם)
 */

export type PackageItemState = "new" | "queue" | "test" | "done" | "missing";
export type PackageStatusKey = "queue" | "test" | "waitItems" | "readyClose" | "done";

export const PACKAGE_STATUS_LABEL: Record<PackageStatusKey, string> = {
  queue: "ממתין לפתיחה",
  test: "בבדיקה",
  waitItems: "ממתין לפריטי המארז",
  readyClose: "ממתין לסגירה",
  done: "הושלם",
};

export const ITEM_STATE_LABEL: Record<PackageItemState, string> = {
  new: "טרם נפתח",
  queue: "ממתין",
  test: "בבדיקה",
  done: "הושלם",
  missing: "חסר במארז",
};

export type PackageItemView = {
  item_id: string;
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
  route_length: number;
  is_finished: boolean;
  state: PackageItemState;
  state_label: string;
  /** Where the item is right now, in words: a station, "ממתין ל<type>", "—". */
  station_name: string | null;
  /** True when the item is at the package's closing step (waiting or in test). */
  arrived_at_closing: boolean;
  /** Closing decision recorded on the box for this item, when any. */
  pack_decision: "packed" | "packed_anyway" | "missing" | null;
  pack_note: string | null;
};

export type PackageView = {
  item_id: string;
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
  /** Station type of the box's current step (the queue it belongs to). */
  current_step_type_id: number | null;
  route_length: number;
  is_finished: boolean;
  created_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  status: PackageStatusKey;
  status_label: string;
  items: PackageItemView[];
  finished_count: number;
  /** Items that keep the box out of the closing queue, with where they are. */
  blocked_by: { item_id: string; package_seq: number | null; item_type_desc: string; station_name: string | null }[];
  template_snapshot: unknown;
};

export type PackageListFilters = {
  shipmentId?: number | null;
  customerId?: number | null;
  packageTypeId?: number | null;
  status?: PackageStatusKey | null;
  q?: string | null;
  /** Restrict to these package ids (the queue / item dialog reuse the view). */
  ids?: bigint[] | null;
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
  route_length: number | null;
  is_finished: boolean | null;
  created_at: Date | null;
  finished_at: Date | null;
  opened_at: Date | null;
  template_snapshot: unknown;
  closing_details: unknown;
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
};

type Decision = { item_id: string; decision: "packed" | "packed_anyway" | "missing"; note?: string | null };

function decisionsOf(details: unknown): Decision[] {
  if (!details || typeof details !== "object") return [];
  const d = (details as { decisions?: unknown }).decisions;
  if (!Array.isArray(d)) return [];
  return d
    .filter((x) => x && typeof x === "object" && "item_id" in x && "decision" in x)
    .map((x) => ({ item_id: String((x as Decision).item_id), decision: (x as Decision).decision, note: (x as Decision).note ?? null }));
}

function itemState(m: MemberRow, pkg: PkgRow, decision: Decision | undefined): PackageItemState {
  if (decision?.decision === "missing") return "missing";
  if (m.is_finished || m.current_status === 3) return "done";
  if (m.current_status === 1 || m.current_status === 5) return "test";
  const boxNotOpened = (pkg.current_route_step ?? 1) <= 1 && !pkg.is_finished;
  if (boxNotOpened && (m.current_route_step ?? 1) <= 1) return "new";
  return "queue";
}

function stationText(m: MemberRow): string | null {
  if (m.is_finished || m.current_status === 3) return null;
  if ((m.current_status === 1 || m.current_status === 5) && m.station_name) return m.station_name.trim();
  if (m.current_status === 4) return "ממתין למחקר";
  if (m.step_type_desc) return `ממתין ל${m.step_type_desc.trim()}`;
  return null;
}

function packageStatus(pkg: PkgRow, blocked: number): PackageStatusKey {
  if (pkg.is_finished || pkg.current_status === 3) return "done";
  if (pkg.current_status === 1 || pkg.current_status === 5) return "test";
  if (pkg.current_status === 6) return "waitItems";
  const step = pkg.current_route_step ?? 1;
  if (step <= 1) return "queue";
  // Queued at a later step: the closing queue, unless something still blocks
  // (a race between the gate and this read — report what the items say).
  return blocked > 0 ? "waitItems" : "readyClose";
}

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
           COALESCE(array_length(tr.route_steps, 1), 0) AS route_length,
           ir.is_finished, ir.created_at, ir.finished_at,
           (SELECT max(h.processing_end_time) FROM item_route_history h
             WHERE h.item_id = i.item_id AND h.current_route_step = 1) AS opened_at,
           i.template_snapshot,
           (SELECT r.details FROM test_results r
             WHERE r.item_id = i.item_id
               AND r.route_step = COALESCE(array_length(tr.route_steps, 1), 0)
             ORDER BY r.test_result_id DESC LIMIT 1) AS closing_details
    FROM items i
    JOIN item_types it ON it.item_type_id = i.item_type_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN shipments sh ON sh.id = i.shipment_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
    WHERE i.package_id IS NULL AND it.is_package = true
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
           tr.route_steps[array_length(tr.route_steps, 1)] AS last_step_type_id
    FROM items i
    JOIN item_types it ON it.item_type_id = i.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
    LEFT JOIN test_stations_type stt ON stt.test_station_type_id = tr.route_steps[ir.current_route_step]
    LEFT JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
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
      const atClosing =
        !m.is_finished && m.current_status !== 3 &&
        m.step_type_id != null && m.step_type_id === m.last_step_type_id &&
        (m.current_route_step ?? 0) > 1 &&
        (m.current_status === 1 || m.current_status === 2);
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
        is_finished: m.is_finished === true,
        state,
        state_label: ITEM_STATE_LABEL[state],
        station_name: stationText(m),
        arrived_at_closing: atClosing,
        pack_decision: decision?.decision ?? null,
        pack_note: decision?.note ?? null,
      };
    });

    // Blockers: unfinished items not at the box's current package-level step.
    // computePackageGate is the same rule the write path uses.
    let blocked: PackageView["blocked_by"] = [];
    const step = p.current_route_step ?? 1;
    if (!p.is_finished && p.current_status !== 3 && step > 1) {
      const gate = await computePackageGate(prisma, p.item_id);
      const blockedIds = new Set(gate.blockingItemIds.map((b) => b.toString()));
      blocked = items
        .filter((it) => blockedIds.has(it.item_id))
        .map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, station_name: it.station_name }));
    }

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
      route_length: Number(p.route_length ?? 0),
      is_finished: p.is_finished === true,
      created_at: iso(p.created_at),
      opened_at: iso(p.opened_at),
      closed_at: iso(p.finished_at),
      status,
      status_label: PACKAGE_STATUS_LABEL[status],
      items,
      finished_count: items.filter((it) => it.state === "done").length,
      blocked_by: blocked,
      template_snapshot: p.template_snapshot ?? null,
    });
  }

  let out = views;
  if (filters.status) out = out.filter((v) => v.status === filters.status);
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    out = out.filter((v) =>
      v.item_id.includes(q) ||
      v.item_type_desc.toLowerCase().includes(q) ||
      (v.makat ?? "").toLowerCase().includes(q) ||
      (v.shipment_code ?? "").toLowerCase().includes(q) ||
      (v.customer_name ?? "").toLowerCase().includes(q) ||
      v.items.some((it) => it.item_id.includes(q) || (it.serial_no ?? "").toLowerCase().includes(q) || (it.makat ?? "").toLowerCase().includes(q)),
    );
  }
  return out;
}

export async function loadPackage(packageId: bigint): Promise<PackageView | null> {
  const [v] = await loadPackages({ ids: [packageId] });
  return v ?? null;
}

/** The package an item belongs to, as the item dialog / queue card show it. */
export async function loadPackageOfItem(itemId: bigint): Promise<PackageView | null> {
  const row = await prisma.items.findUnique({ where: { item_id: itemId }, select: { package_id: true } });
  if (!row?.package_id) return null;
  return loadPackage(row.package_id);
}

export type PackageTimelineEntry = {
  key: "intake" | "open" | "close";
  title: string;
  at: string | null;
  worker_id: number | null;
  state: "done" | "pending" | "blocked" | "queued";
  note: string | null;
};

/** The package-level milestones of the box (design: "ציר זמן של המארז"). */
export async function loadPackageTimeline(v: PackageView): Promise<PackageTimelineEntry[]> {
  const history = await prisma.item_route_history.findMany({
    where: { item_id: BigInt(v.item_id) },
    orderBy: { log_id: "asc" },
    select: { current_route_step: true, processing_end_time: true, worker_id: true },
  });
  const opened = history.find((h) => h.current_route_step === 1 && h.processing_end_time);
  const closed = v.route_length > 0 ? history.find((h) => h.current_route_step === v.route_length && h.processing_end_time && v.route_length > 1) : undefined;

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
