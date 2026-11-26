import { Prisma } from "@prisma/client";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordTransition, type MetricsTransition } from "@/app/lib/metrics/ledger/record";
import { abandonRun, forgetItem } from "@/app/lib/metrics/ledger/item-lifecycle";
import { TransactionClient } from "@/lib/db";
import { ItemStatus } from "@/lib/item-status";
import { PackageError } from "./errors";
import { CUSTOMER_CODE_RULE, MAX_DAILY_PACKAGES, idCustomerCode } from "./ids";
import { checkItemRouteAgainstPackage, checkPackageRoute, loadPackageLevelTypeIds, loadRouteShape, type RouteShape } from "./route-rules";
import { itemRouteNumber } from "./template-wire";

/**
 * The life of a routed row — a box, or an item inside one (docs/features/packages/PLAN.md
 * §2, §4, §6). Every write path (createPackage, the intake, the opening, the
 * package reset, an item's retype and delete) goes through these steps, each
 * written once with the order of its statements, so the ledger sees every
 * transition the same way whoever caused it.
 *
 * Every function takes the caller's tx and never opens one: the caller owns
 * the transaction, so a failure anywhere rolls back everything (§4.8 of the
 * metrics plan — the ledger and the operational tables commit together).
 */

/** A template line: the type, how many, and their route. The item's details
 *  are never the template's (boxes.ts intakeBox). */
export type TemplateLine = {
  item_type_id: number;
  quantity: number;
  route_number: number;
  sort_order: number;
};

export async function loadTemplate(tx: TransactionClient, packageTypeId: number): Promise<TemplateLine[]> {
  return tx.package_contents.findMany({
    where: { package_type_id: packageTypeId },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    select: { item_type_id: true, quantity: true, route_number: true, sort_order: true },
  });
}

/** items.model and items.manufacturer_name are CHAR(50) (prisma/schema.prisma):
 *  trimmed and cut to fit. Reads TRIM them back (the column pads). */
export const fitChar50 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 50);

/** What a box and its items say about their contents: the shipment line's
 *  certificate row, as the items columns hold it. */
export type BoxDetails = { makat: string; model: string; manufacturer: string; manufacturerNo: string };

export type DetailCols = { makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null };

export const boxDetails = (r: DetailCols): BoxDetails => ({
  makat: (r.makat ?? "").trim(),
  model: fitChar50(r.model),
  manufacturer: fitChar50(r.manufacturer_name),
  manufacturerNo: (r.manufacturer_no ?? "").trim(),
});

/** The customer's code as a new id carries it, or the refusal that says to fix
 *  it in the customers' settings. Checked before a counter value is reserved. */
export function idCodeOrRefuse(customerCode: string | null | undefined): string {
  const code = idCustomerCode(customerCode);
  if (code == null) {
    const shown = (customerCode ?? "").trim();
    throw new PackageError(
      "CUSTOMER_CODE_FORMAT",
      `${shown ? `קוד הלקוח "${shown}" לא מתאים למזהה המארז` : "ללקוח אין קוד"} — ${CUSTOMER_CODE_RULE}. יש לתקן אותו בהגדרות ← לקוחות.`,
      409,
    );
  }
  return code;
}

/**
 * Reserves `count` consecutive values of the day's package counter in one
 * statement and answers the first; the values are first .. first+count-1.
 * The row lock this upsert takes is held to commit, so two savers running at
 * once queue behind each other and can never mint the same prefix.
 */
export async function reserveDailyPackageCounters(tx: TransactionClient, dateKey: string, count: number): Promise<number> {
  const rows = await tx.$queryRaw<{ counter: number }[]>`
    INSERT INTO daily_counters (date_key, counter)
    VALUES (${dateKey}::date, ${count})
    ON CONFLICT (date_key)
    DO UPDATE SET counter = daily_counters.counter + ${count}
    RETURNING counter
  `;
  const last = Number(rows[0]?.counter);
  if (!Number.isFinite(last)) throw new Error("daily_counters returned no counter");
  if (last > MAX_DAILY_PACKAGES) {
    const left = Math.max(0, MAX_DAILY_PACKAGES - (last - count));
    throw new PackageError(
      "DAILY_LIMIT",
      count === 1
        ? `נקלטו כבר ${MAX_DAILY_PACKAGES} מארזים היום — המונה היומי במזהה מלא`
        : `המונה היומי במזהה מאפשר עוד ${left} מארזים היום, והמשלוח צריך ${count}`,
      409,
    );
  }
  return last - count + 1;
}

/** The box's route, refused unless it is a package route (route-rules.ts). */
export async function assertPackageRoute(
  tx: TransactionClient,
  packageType: number,
  routeNumber: number,
): Promise<BoxRoute> {
  const packageLevel = await loadPackageLevelTypeIds(tx);
  const shape = await loadRouteShape(tx, packageType, routeNumber);
  const problem = checkPackageRoute(shape, packageLevel, routeNumber);
  if (problem || !shape) throw new PackageError("PACKAGE_ROUTE_SHAPE", problem ?? "מסלול המארז לא תקין", 409);
  return { shape, packageLevel };
}

/** The box's route and which station types are package-level: what an item's route must fit. */
export type BoxRoute = { shape: RouteShape; packageLevel: Set<number> };

/** An item's route must start and end where its box's does (PLAN.md §4), or the item would leak
 *  out of the group: refused otherwise. */
export async function assertItemFitsBox(
  tx: TransactionClient,
  item: { itemType: number; routeNumber: number },
  pkg: BoxRoute,
  itemTypeDesc: string,
): Promise<void> {
  const shape = await loadRouteShape(tx, item.itemType, item.routeNumber);
  const problem = checkItemRouteAgainstPackage(shape, pkg.shape, pkg.packageLevel, item.routeNumber);
  if (problem) throw new PackageError("ITEM_ROUTE_SHAPE", `${itemTypeDesc}: ${problem}`, 409);
}

/** One item's route inside the box (template-wire.ts itemRouteNumber), refused unless it fits the
 *  box's route. */
export async function resolveItemRoute(
  tx: TransactionClient,
  item: { itemType: number; routeNumber?: number | null },
  template: TemplateLine[],
  pkg: BoxRoute,
  itemTypeDesc: string,
): Promise<number> {
  const routeNumber = itemRouteNumber(item.routeNumber, template.find((l) => l.item_type_id === item.itemType));
  await assertItemFitsBox(tx, { itemType: item.itemType, routeNumber }, pkg, itemTypeDesc);
  return routeNumber;
}

export type ItemRowArgs = {
  itemId: bigint;
  customer: number;
  shipment: number;
  itemType: number;
  serialNumber: string | null;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo: string;
  packageId: bigint | null;
  packageSeq: number | null;
  templateSnapshot: TemplateLine[] | null;
};

/** The items row alone. Without enterRoute it is a box waiting for intake
 *  (boxes.ts) — no route, nothing in the ledger. */
export async function insertItemRow(tx: TransactionClient, args: ItemRowArgs): Promise<void> {
  const {
    itemId, customer, shipment, itemType, serialNumber, makat, model, manufacturer, manufacturerNo,
    packageId, packageSeq, templateSnapshot,
  } = args;
  await tx.$executeRaw`
    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name,
                       manufacturer_no, shipment_id, package_id, package_seq, template_snapshot)
    VALUES (${itemId}, ${customer}, ${itemType}, ${serialNumber}, ${makat}, ${model}, ${manufacturer},
            ${manufacturerNo}, ${shipment}, ${packageId}, ${packageSeq}::smallint,
            ${templateSnapshot == null ? null : JSON.stringify(templateSnapshot)}::jsonb)
  `;
}

/**
 * Where a row starts route `routeNumber` of `itemType`: the station that serves step 1, and the
 * field-config version the route has published now. The version is frozen onto the row
 * (route-fields spec §1.5): its popups are built from that version, not the route's latest; 0
 * (never published) → NULL = the fixed popups. A box freezes its kit route's version, each item
 * its own route's.
 */
async function routeStart(tx: TransactionClient, itemType: number, routeNumber: number) {
  return {
    stationId: await findStationForRouteStep(tx, itemType, routeNumber, 1),
    fieldsVersion: Prisma.sql`(SELECT NULLIF(tr.fields_version, 0) FROM testing_routes tr
                               WHERE tr.item_type_id = ${itemType} AND tr.route_number = ${routeNumber})`,
  };
}

/** An existing items row enters step 1 of its route: the route row, and the
 *  ledger's item_created in the same transaction. */
export async function enterRoute(
  tx: TransactionClient,
  args: { itemId: bigint; itemType: number; routeNumber: number; firstStepTypeId: number | null },
): Promise<void> {
  const { itemId, itemType, routeNumber, firstStepTypeId } = args;

  // Step 1 is the opening station type for both the package and its items;
  // items are hidden there (package-level) until the wizard submits for them.
  const start = await routeStart(tx, itemType, routeNumber);
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id,
                             created_at, is_finished, queue_start_time, route_number, fields_version)
    VALUES (${itemId}, ${itemType}, ${ItemStatus.Queued}, 1, ${start.stationId}, ${now}::timestamp, FALSE, ${now}::timestamp, ${routeNumber},
            ${start.fieldsVersion})
  `;

  // item_created → queued, same tx as the item_routes INSERT.
  // metrics_open_run freezes unit_id = COALESCE(package_id, item_id).
  await recordTransition(tx, {
    key: { item: true },
    itemId,
    toState: "queued",
    stepNo: 1,
    stationTypeId: firstStepTypeId,
    reason: "item_created",
  });
}

/**
 * A routed row starts its route over: step 1 of `itemType`'s route
 * `routeNumber`, as routeStart finds it. The ledger's open run is abandoned (closed with
 * is_trusted = false, so it never counts as a completion) and a fresh
 * `queued` transition opens the next run against the new plan.
 *
 * The package reset and an item's retype both come through here.
 */
export async function restartRoute(
  tx: TransactionClient,
  args: {
    itemId: bigint;
    itemType: number;
    routeNumber: number;
    now: Date;
    abandonReason: string;
    event: Pick<MetricsTransition, "key" | "reason" | "workerId" | "workerName" | "payload">;
  },
): Promise<void> {
  const { itemId, itemType, routeNumber, now } = args;
  const start = await routeStart(tx, itemType, routeNumber);
  await tx.$executeRaw`
    UPDATE item_routes
       SET item_type_id = ${itemType},
           route_number = ${routeNumber},
           current_route_step = 1,
           current_status = ${ItemStatus.Queued},
           test_station_id = ${start.stationId},
           is_finished = false,
           finished_at = NULL,
           queue_start_time = ${now}::timestamp,
           processing_start_time = NULL,
           fields_version = ${start.fieldsVersion}
     WHERE item_id = ${itemId}
  `;

  // Close the old run first: metrics_record reuses an OPEN run, and
  // route_run_one_open forbids a second one — without it the new transition
  // would land back on the run built for the old route.
  await abandonRun(tx, itemId, args.abandonReason);

  const route = await tx.testing_routes.findFirst({
    where: { item_type_id: itemType, route_number: routeNumber },
    select: { route_steps: true },
  });
  // metrics_open_run reads the item_routes row updated above.
  await recordTransition(tx, {
    ...args.event,
    itemId,
    toState: "queued",
    stepNo: 1,
    stationId: null,
    stationTypeId: route?.route_steps?.[0] ?? null,
  });
}

/**
 * Rows leave the system: the ledger forgets them first, then everything they
 * own goes — results, report pointers (the PDF blobs stay in the versioned
 * bucket, like the item's other files), station history, route rows. The
 * ledger holds no FK to `items` on purpose (no read query joins it), so
 * deleting a row strands its runs, events and intervals unless
 * metrics_forget_item runs; it works off item_id alone, so it is safe before
 * the rows it accompanies are gone, and commits with them. The items rows
 * themselves are the caller's: a box taken back stays, pending.
 */
export async function forgetRouted(tx: TransactionClient, ids: bigint[]): Promise<void> {
  for (const id of ids) await forgetItem(tx, id);
  await tx.test_results.deleteMany({ where: { item_id: { in: ids } } });
  await tx.item_reports.deleteMany({ where: { item_id: { in: ids } } });
  await tx.item_route_history.deleteMany({ where: { item_id: { in: ids } } });
  await tx.item_routes.deleteMany({ where: { item_id: { in: ids } } });
}

/** forgetRouted, then the items rows: the items inside the box first — they
 *  hold the FK (package_id) to it. */
export async function deleteItemRows(tx: TransactionClient, rowId: bigint, memberIds: bigint[] = []): Promise<void> {
  await forgetRouted(tx, [rowId, ...memberIds]);
  if (memberIds.length > 0) await tx.items.deleteMany({ where: { item_id: { in: memberIds } } });
  await tx.items.delete({ where: { item_id: rowId } });
}
