import { getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordTransition } from "@/app/lib/metrics/record";
import { TransactionClient } from "@/app/lib/prisma";
import { PackageError } from "./errors";
import {
  MAX_DAILY_PACKAGES,
  MAX_PACKAGE_SEQ,
  baseOfId,
  isNewFormatId,
  itemIdFromBase,
  localDateParts,
  packageIdBase,
  packageIdFromBase,
} from "./ids";
import {
  checkItemRouteAgainstPackage,
  checkPackageRoute,
  firstStep,
  loadPackageLevelTypeIds,
  loadRouteShape,
  RouteShape,
} from "./route-rules";

/**
 * The package write path — docs/packages/PLAN.md §2, §4, §6.
 *
 * createPackage: one box and everything inside it, in ONE transaction: the
 * daily counter, the package row, its route row, then each item with its own
 * row, route row and ledger event. Everything shares one id prefix; the
 * package ends in 00, the items in 01.., in input order.
 *
 * addPackageItem: one more item into a box that is still being opened (the
 * intake wizard's "the template said 3, there are 4" path). Takes the next
 * position from the package row; positions are never reused.
 *
 * Both take the caller's tx and never open one: the caller owns the
 * transaction so a failure anywhere rolls back everything (§4.8 of the
 * metrics plan applies to item_created exactly as to every other event).
 */

export type PackageItemInput = {
  itemType: number;
  serialNumber: string;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo?: string | null;
  /** Route of the item type. Omitted → the template line's default → 1. */
  routeNumber?: number | null;
};

export type PackageInput = {
  customer: number;
  shipment: number;
  packageType: number;
  routeNumber?: number | null;
  /** Defaults to the shipment's makat. */
  makat?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  manufacturerNo?: string | null;
  items: PackageItemInput[];
};

export type CreatedPackage = {
  packageId: number;
  itemIds: number[];
};

type TemplateLine = {
  item_type_id: number;
  quantity: number;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  manufacturer_sku: string | null;
  route_number: number;
  sort_order: number;
};

const CHAR50 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 50);

async function nextDailyPackageCounter(tx: TransactionClient, dateKey: string): Promise<number> {
  // The row lock this upsert takes is held to commit, so two intakes running
  // at once queue behind each other and can never mint the same prefix.
  const rows = await tx.$queryRaw<{ counter: number }[]>`
    INSERT INTO daily_counters (date_key, counter)
    VALUES (${dateKey}::date, 1)
    ON CONFLICT (date_key)
    DO UPDATE SET counter = daily_counters.counter + 1
    RETURNING counter
  `;
  const counter = Number(rows[0]?.counter);
  if (!Number.isFinite(counter)) throw new Error("daily_counters returned no counter");
  if (counter > MAX_DAILY_PACKAGES) {
    throw new PackageError("DAILY_LIMIT", `נקלטו כבר ${MAX_DAILY_PACKAGES} מארזים היום — המונה היומי במזהה מלא`, 409);
  }
  return counter;
}

async function loadTemplate(tx: TransactionClient, packageTypeId: number): Promise<TemplateLine[]> {
  const rows = await tx.package_contents.findMany({
    where: { package_type_id: packageTypeId },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    select: {
      item_type_id: true, quantity: true, makat: true, model: true, manufacturer_name: true,
      manufacturer_no: true, manufacturer_sku: true, route_number: true, sort_order: true,
    },
  });
  return rows;
}

/** Resolves and validates one item's route against the package route.
 *  Returns the route number actually used. */
async function resolveItemRoute(
  tx: TransactionClient,
  item: PackageItemInput,
  template: TemplateLine[],
  pkgShape: RouteShape,
  packageLevel: Set<number>,
  itemTypeDesc: string,
): Promise<number> {
  const line = template.find((l) => l.item_type_id === item.itemType);
  const routeNumber = item.routeNumber ?? line?.route_number ?? 1;
  const shape = await loadRouteShape(tx, item.itemType, routeNumber);
  const problem = checkItemRouteAgainstPackage(shape, pkgShape, packageLevel, routeNumber);
  if (problem) {
    throw new PackageError("ITEM_ROUTE_SHAPE", `${itemTypeDesc}: ${problem}`, 409);
  }
  return routeNumber;
}

async function insertRoutedRow(
  tx: TransactionClient,
  args: {
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
    routeNumber: number;
    firstStepTypeId: number | null;
  },
): Promise<void> {
  const {
    itemId, customer, shipment, itemType, serialNumber, makat, model, manufacturer, manufacturerNo,
    packageId, packageSeq, templateSnapshot, routeNumber, firstStepTypeId,
  } = args;

  await tx.$executeRaw`
    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name,
                       manufacturer_no, shipment_id, package_id, package_seq, template_snapshot)
    VALUES (${itemId}, ${customer}, ${itemType}, ${serialNumber}, ${makat}, ${model}, ${manufacturer},
            ${manufacturerNo}, ${shipment}, ${packageId}, ${packageSeq}::smallint,
            ${templateSnapshot == null ? null : JSON.stringify(templateSnapshot)}::jsonb)
  `;

  // Step 1 is the opening station type for both the package and its items;
  // items are hidden there (package-level) until the wizard submits for them.
  const stationId = await findStationForRouteStep(tx, itemType, routeNumber, 1);
  const now = new Date(getCurrentUtcIso());
  await tx.$executeRaw`
    INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id,
                             created_at, is_finished, queue_start_time, route_number)
    VALUES (${itemId}, ${itemType}, 2, 1, ${stationId}, ${now}::timestamp, FALSE, ${now}::timestamp, ${routeNumber})
  `;

  // Ledger call site #1: item_created → queued, same tx as the item_routes
  // INSERT. metrics_open_run freezes unit_id = COALESCE(package_id, item_id).
  await recordTransition(tx, {
    eventKey: `item_created:${itemId}`,
    itemId,
    toState: "queued",
    stepNo: 1,
    stationTypeId: firstStepTypeId,
    reason: "item_created",
  });
}

export async function createPackage(tx: TransactionClient, input: PackageInput): Promise<CreatedPackage> {
  const { customer, shipment, packageType, items } = input;

  if (!Array.isArray(items) || items.length === 0) {
    throw new PackageError("EMPTY_PACKAGE", "מארז חייב להכיל לפחות פריט אחד");
  }
  if (items.length > MAX_PACKAGE_SEQ) {
    throw new PackageError("TOO_MANY_ITEMS", `מארז יכול להכיל עד ${MAX_PACKAGE_SEQ} פריטים`);
  }

  const customerRow = await tx.customers.findUnique({ where: { id: customer }, select: { id: true } });
  if (!customerRow) throw new PackageError("CUSTOMER_NOT_FOUND", "הלקוח לא נמצא", 404);

  const shipmentRow = await tx.shipments.findUnique({
    where: { id: shipment },
    select: { customer_id: true, makat: true },
  });
  if (!shipmentRow) throw new PackageError("SHIPMENT_NOT_FOUND", "המשלוח לא נמצא", 404);
  if (shipmentRow.customer_id !== customer) {
    throw new PackageError("SHIPMENT_CUSTOMER", "המשלוח שייך ללקוח אחר");
  }

  const packageTypeRow = await tx.item_types.findUnique({
    where: { item_type_id: packageType },
    select: { is_package: true, item_type_desc: true },
  });
  if (!packageTypeRow) throw new PackageError("PACKAGE_TYPE_NOT_FOUND", "סוג המארז לא נמצא", 404);
  if (!packageTypeRow.is_package) {
    throw new PackageError("NOT_A_PACKAGE_TYPE", `${packageTypeRow.item_type_desc.trim()} אינו סוג מארז`);
  }

  const itemTypeRows = await tx.item_types.findMany({
    where: { item_type_id: { in: [...new Set(items.map((i) => i.itemType))] } },
    select: { item_type_id: true, item_type_desc: true, is_package: true },
  });
  const itemTypeById = new Map(itemTypeRows.map((r) => [r.item_type_id, r]));
  for (const it of items) {
    const row = itemTypeById.get(it.itemType);
    if (!row) throw new PackageError("ITEM_TYPE_NOT_FOUND", `סוג פריט ${it.itemType} לא נמצא`, 404);
    if (row.is_package) {
      throw new PackageError("NESTED_PACKAGE", `${row.item_type_desc.trim()} הוא סוג מארז ולא יכול להיות פריט בתוך מארז`);
    }
    if (!it.serialNumber || !String(it.serialNumber).trim()) {
      throw new PackageError("ITEM_SERIAL_REQUIRED", `${row.item_type_desc.trim()}: חסר מספר סריאלי`);
    }
  }

  const packageLevel = await loadPackageLevelTypeIds(tx);
  const packageRouteNumber = input.routeNumber ?? 1;
  const pkgShape = await loadRouteShape(tx, packageType, packageRouteNumber);
  const pkgProblem = checkPackageRoute(pkgShape, packageLevel, packageRouteNumber);
  if (pkgProblem || !pkgShape) throw new PackageError("PACKAGE_ROUTE_SHAPE", pkgProblem ?? "מסלול המארז לא תקין", 409);

  const template = await loadTemplate(tx, packageType);

  // Resolve every item's route BEFORE minting anything, so a bad route never
  // burns a counter value.
  const itemRoutes: number[] = [];
  for (const it of items) {
    const desc = itemTypeById.get(it.itemType)!.item_type_desc.trim();
    itemRoutes.push(await resolveItemRoute(tx, it, template, pkgShape, packageLevel, desc));
  }

  const { datePart, dateKey } = localDateParts();
  const counter = await nextDailyPackageCounter(tx, dateKey);
  const base = packageIdBase(customer, datePart, counter);
  const packageId = packageIdFromBase(base);

  await insertRoutedRow(tx, {
    itemId: packageId,
    customer,
    shipment,
    itemType: packageType,
    serialNumber: null,
    makat: (input.makat ?? shipmentRow.makat ?? "").trim(),
    model: CHAR50(input.model),
    manufacturer: CHAR50(input.manufacturer),
    manufacturerNo: (input.manufacturerNo ?? "").trim(),
    packageId: null,
    packageSeq: null,
    templateSnapshot: template,
    routeNumber: packageRouteNumber,
    firstStepTypeId: firstStep(pkgShape),
  });

  const itemIds: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const seq = i + 1;
    const itemId = itemIdFromBase(base, seq);
    const itemShapeFirst = firstStep(pkgShape); // identical by the rule checked above
    await insertRoutedRow(tx, {
      itemId,
      customer,
      shipment,
      itemType: it.itemType,
      serialNumber: String(it.serialNumber).trim(),
      makat: String(it.makat ?? "").trim(),
      model: CHAR50(it.model),
      manufacturer: CHAR50(it.manufacturer),
      manufacturerNo: (it.manufacturerNo ?? "").trim(),
      packageId,
      packageSeq: seq,
      templateSnapshot: null,
      routeNumber: itemRoutes[i],
      firstStepTypeId: itemShapeFirst,
    });
    itemIds.push(Number(itemId));
  }

  await tx.$executeRaw`
    UPDATE items SET package_next_seq = ${items.length + 1}::smallint WHERE item_id = ${packageId}
  `;

  return { packageId: Number(packageId), itemIds };
}

export type AddedPackageItem = { itemId: number; packageSeq: number };

export async function addPackageItem(
  tx: TransactionClient,
  packageId: bigint,
  item: PackageItemInput,
): Promise<AddedPackageItem> {
  const rows = await tx.$queryRaw<{
    item_id: bigint;
    customer_id: number;
    shipment_id: number;
    package_id: bigint | null;
    package_next_seq: number;
    item_type_id: number;
    is_package: boolean;
    route_number: number | null;
    current_route_step: number | null;
    current_status: number | null;
    is_finished: boolean | null;
  }[]>`
    SELECT it.item_id, it.customer_id, it.shipment_id, it.package_id, it.package_next_seq, it.item_type_id,
           ty.is_package, ir.route_number, ir.current_route_step, ir.current_status, ir.is_finished
    FROM items it
    JOIN item_types ty ON ty.item_type_id = it.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = it.item_id
    WHERE it.item_id = ${packageId}
    FOR UPDATE OF it
  `;
  const pkg = rows[0];
  if (!pkg) throw new PackageError("PACKAGE_NOT_FOUND", "המארז לא נמצא", 404);
  if (!pkg.is_package || pkg.package_id != null) {
    throw new PackageError("NOT_A_PACKAGE", "המזהה שנסרק אינו מארז");
  }
  if (!isNewFormatId(pkg.item_id)) {
    // A legacy "package" (a pre-conversion parent) has no id prefix to extend;
    // deriving one would collide with other legacy ids. PLAN.md §8.
    throw new PackageError("LEGACY_PACKAGE", "מארז בפורמט הישן — יש להסב אותו לפני הוספת פריטים", 409);
  }
  if (pkg.route_number == null || pkg.current_route_step == null) {
    throw new PackageError("PACKAGE_NOT_ROUTED", "למארז אין מסלול פעיל", 409);
  }
  const opening =
    pkg.current_route_step === 1 && !pkg.is_finished && (pkg.current_status === 1 || pkg.current_status === 2);
  if (!opening) {
    throw new PackageError("PACKAGE_NOT_OPENING", "ניתן להוסיף פריטים למארז רק בזמן פתיחת המארז", 409);
  }
  const seq = Number(pkg.package_next_seq);
  if (seq > MAX_PACKAGE_SEQ) {
    throw new PackageError("PACKAGE_FULL", `מארז יכול להכיל עד ${MAX_PACKAGE_SEQ} פריטים`, 409);
  }

  const typeRow = await tx.item_types.findUnique({
    where: { item_type_id: item.itemType },
    select: { item_type_desc: true, is_package: true },
  });
  if (!typeRow) throw new PackageError("ITEM_TYPE_NOT_FOUND", "סוג הפריט לא נמצא", 404);
  if (typeRow.is_package) {
    throw new PackageError("NESTED_PACKAGE", `${typeRow.item_type_desc.trim()} הוא סוג מארז ולא יכול להיות פריט בתוך מארז`);
  }
  if (!item.serialNumber || !String(item.serialNumber).trim()) {
    throw new PackageError("ITEM_SERIAL_REQUIRED", "חסר מספר סריאלי");
  }

  const packageLevel = await loadPackageLevelTypeIds(tx);
  const pkgShape = await loadRouteShape(tx, pkg.item_type_id, pkg.route_number);
  const pkgProblem = checkPackageRoute(pkgShape, packageLevel, pkg.route_number);
  if (pkgProblem || !pkgShape) throw new PackageError("PACKAGE_ROUTE_SHAPE", pkgProblem ?? "מסלול המארז לא תקין", 409);

  const template = await loadTemplate(tx, pkg.item_type_id);
  const routeNumber = await resolveItemRoute(tx, item, template, pkgShape, packageLevel, typeRow.item_type_desc.trim());

  const itemId = itemIdFromBase(baseOfId(pkg.item_id), seq);
  await insertRoutedRow(tx, {
    itemId,
    customer: pkg.customer_id,
    shipment: pkg.shipment_id,
    itemType: item.itemType,
    serialNumber: String(item.serialNumber).trim(),
    makat: String(item.makat ?? "").trim(),
    model: CHAR50(item.model),
    manufacturer: CHAR50(item.manufacturer),
    manufacturerNo: (item.manufacturerNo ?? "").trim(),
    packageId: pkg.item_id,
    packageSeq: seq,
    templateSnapshot: null,
    routeNumber,
    firstStepTypeId: firstStep(pkgShape),
  });

  await tx.$executeRaw`
    UPDATE items SET package_next_seq = ${seq + 1}::smallint WHERE item_id = ${pkg.item_id}
  `;

  return { itemId: Number(itemId), packageSeq: seq };
}
