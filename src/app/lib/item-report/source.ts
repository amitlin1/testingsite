/**
 * What an item's report is built from, read from the database: the item, the
 * route it runs, the template its report uses, and every result it saved.
 * Server-only.
 */
import type { Data } from "@measured/puck";
import { prisma } from "@/lib/db";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { readSchemaRef } from "@/app/lib/test-results/details";
import { parseFieldsConfigOrNull } from "./catalog";
import { isTemplate, templateHasContent } from "./template-utils";
import { fieldOrderOf, type ItemFacts, type ResultRow } from "./variables";

export type ReportSource = {
  item: ItemFacts;
  route: { test_route_id: number; route_number: number; route_steps: number[]; step_uids: string[] } | null;
  template: Data | null;
  rows: ResultRow[];
  /** step uid → field ids in the order of the field config the rows were saved with. */
  fieldOrder?: Map<string, string[]>;
};

async function loadItem(itemId: bigint): Promise<ItemFacts | null> {
  const rows = await prisma.$queryRaw<ItemFacts[]>`
    SELECT i.item_id, i.serial_no, i.makat, TRIM(i.model) AS model,
           TRIM(i.manufacturer_name) AS manufacturer_name, i.manufacturer_no,
           i.package_id, i.package_seq::int AS package_seq,
           ir.item_type_id, TRIM(t.item_type_desc) AS item_type,
           TRIM(c.name) AS customer, s.shipment_code,
           TRIM(pt.item_type_desc) AS package_type,
           ir.route_number, ir.created_at, ir.finished_at,
           TRIM(st.item_status_desc) AS status
      FROM items i
      JOIN item_routes ir ON ir.item_id = i.item_id
      LEFT JOIN item_types t ON t.item_type_id = ir.item_type_id
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN shipments s ON s.id = i.shipment_id
      LEFT JOIN items p ON p.item_id = i.package_id
      LEFT JOIN item_types pt ON pt.item_type_id = p.item_type_id
      LEFT JOIN item_status st ON st.item_status_id = ir.current_status
     WHERE i.item_id = ${itemId}`;
  return rows[0] ?? null;
}

async function loadRows(itemId: bigint): Promise<ResultRow[]> {
  const rows = await prisma.$queryRaw<(Omit<ResultRow, "created_at"> & { created_at: Date })[]>`
    SELECT tr.test_result_id, tr.route_number, tr.route_step,
           COALESCE(TRIM(ts.test_station_desc), '') AS station,
           COALESCE(TRIM(tst.test_type_desc), '') AS station_type,
           COALESCE(ts.is_research, false) AS station_is_research,
           tr.worker_id, e.worker_name, tr.passed, tr.result, tr.comments, tr.details, tr.created_at
      FROM test_results tr
      LEFT JOIN test_stations ts ON ts.test_station_id = tr.test_station_id
      LEFT JOIN test_stations_type tst ON tst.test_station_type_id = tr.test_station_type_id
      LEFT JOIN item_state_event e ON e.event_id = tr.state_event_id
     WHERE tr.item_id = ${itemId}
     ORDER BY tr.created_at, tr.test_result_id`;
  const out = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  // The ledger keeps the worker's name as it was; rows written without one
  // fall back to today's directory (best-effort — a deleted user stays "#id").
  if (out.some((r) => !r.worker_name && r.worker_id != null)) {
    try {
      const { getWorkersDirectory } = await import("@/lib/keycloak-admin");
      const names = new Map((await getWorkersDirectory()).map((w) => [w.worker_id, w.worker_name]));
      for (const r of out) if (!r.worker_name && r.worker_id != null) r.worker_name = names.get(r.worker_id) ?? null;
    } catch (e) {
      console.error("[item-report] workers directory unavailable — worker ids print as #id", e);
    }
  }
  return out;
}

/** The field configs the rows were saved against (details.schema {route_id, v}). */
async function loadFieldOrder(rows: readonly ResultRow[]): Promise<Map<string, string[]>> {
  const refs = new Map<string, { route_id: number; v: number }>();
  for (const r of rows) {
    const { route_id, v } = readSchemaRef(r.details);
    if (route_id != null && v != null) refs.set(`${route_id}:${v}`, { route_id, v });
  }
  if (refs.size === 0) return new Map();
  const versions = await prisma.route_field_versions.findMany({
    where: { OR: [...refs.values()].map((x) => ({ test_route_id: x.route_id, version: x.v })) },
    select: { test_route_id: true, version: true, config: true },
    orderBy: { version: "desc" },
  });
  const configs: RouteFieldsConfig[] = [];
  for (const v of versions) {
    const cfg = parseFieldsConfigOrNull(v.config, `route ${v.test_route_id} v${v.version}`);
    if (cfg) configs.push(cfg);
  }
  return fieldOrderOf(configs);
}

/** report_general_template holds one row, this one. */
export const GENERAL_TEMPLATE_ID = 1;

/** The general template (report_general_template), or null when there is none. */
async function loadGeneralTemplate(): Promise<Data | null> {
  const row = await prisma.report_general_template.findUnique({ where: { id: GENERAL_TEMPLATE_ID }, select: { template: true } });
  return isTemplate(row?.template) ? (row!.template as unknown as Data) : null;
}

/**
 * The route an item runs, and the template its report is built from: the
 * route's own when it has content, else the general one. A kit's box gets
 * none — the report is per item.
 */
async function loadRouteAndTemplate(item: ItemFacts) {
  // (item_type_id, route_number) is unique (testing_routes_type_number_uq).
  const route = await prisma.testing_routes.findFirst({
    where: { item_type_id: item.item_type_id, route_number: item.route_number },
    select: {
      test_route_id: true, route_number: true, route_steps: true, step_uids: true,
      report_template: { select: { template: true } }, item_types: { select: { is_package: true } },
    },
  });
  const raw = route?.report_template?.template;
  const own = isTemplate(raw) && templateHasContent(raw) ? (raw as unknown as Data) : null;
  return {
    route: route ? { test_route_id: route.test_route_id, route_number: route.route_number, route_steps: route.route_steps, step_uids: route.step_uids } : null,
    template: own ?? (route && !route.item_types.is_package ? await loadGeneralTemplate() : null),
  };
}

/** `rows: false` skips the results (status checks need only the item + template). */
export async function loadReportSource(itemId: bigint, opts: { rows?: boolean } = {}): Promise<ReportSource | null> {
  const item = await loadItem(itemId);
  if (!item) return null;
  if (opts.rows === false) return { item, ...(await loadRouteAndTemplate(item)), rows: [] };
  const [{ route, template }, rows] = await Promise.all([loadRouteAndTemplate(item), loadRows(itemId)]);
  return { item, route, template, rows, fieldOrder: await loadFieldOrder(rows) };
}
