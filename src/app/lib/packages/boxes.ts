import { TransactionClient } from "@/app/lib/prisma";
import { forgetItem, resyncItemDims } from "@/app/lib/metrics/item-lifecycle";
import { PackageError } from "./errors";
import { MAX_PACKAGE_SEQ, baseOfId, itemIdFromBase, localDateParts, packageIdBase, packageIdFromBase } from "./ids";
import {
  CHAR50,
  CreatedPackage,
  PackageItemInput,
  addPackageItem,
  insertItemRow,
  loadTemplate,
  nextDailyPackageCounter,
  resolveItemRoute,
  routeRow,
} from "./create-package";
import { checkPackageRoute, firstStep, loadPackageLevelTypeIds, loadRouteShape } from "./route-rules";
import { findSerials, serialKey } from "./serials";
import { workDoneOn } from "./untouched";

/**
 * A box from the shipment to its opening (docs/packages/PLAN.md §6, as
 * changed on 2026-10-19):
 *
 *   shipment saved  → syncShipmentBoxes: one PENDING box per declared unit —
 *                     the package row with its id minted, no route, nothing
 *                     inside. Its label prints from the shipment.
 *   intake scan     → intakeBox: the box enters its route and its items are
 *                     created from the package type's template, without
 *                     serials. undoIntake takes it back while untouched.
 *   opening station → saveOpeningContents: the items that are really in the
 *                     box, each with its serial and details.
 *
 * "Pending" is exactly: a package row (item type is_package, package_id NULL)
 * with no item_routes row. Nothing reads the ledger for it: item_created is
 * recorded at intake, when the box gets its route.
 */

type BoxRow = {
  item_id: bigint;
  customer_id: number;
  shipment_id: number;
  item_type_id: number;
  item_type_desc: string;
  is_package: boolean;
  package_id: bigint | null;
  routed: boolean;
  is_sent: boolean | null;
};

/** The package row for an intake / undo, locked; refusals name the problem. */
async function lockBox(tx: TransactionClient, packageId: bigint): Promise<BoxRow> {
  const rows = await tx.$queryRaw<BoxRow[]>`
    SELECT i.item_id, i.customer_id, i.shipment_id, i.item_type_id, TRIM(t.item_type_desc) AS item_type_desc,
           t.is_package, i.package_id, (ir.item_id IS NOT NULL) AS routed, s.is_sent
    FROM items i
    JOIN item_types t ON t.item_type_id = i.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN shipments s ON s.id = i.shipment_id
    WHERE i.item_id = ${packageId}
    FOR UPDATE OF i
  `;
  const box = rows[0];
  if (!box) throw new PackageError("PACKAGE_NOT_FOUND", "לא נמצא מארז עם המזהה הזה", 404);
  if (!box.is_package || box.package_id != null) {
    throw new PackageError("NOT_A_PACKAGE", "זו מדבקה של פריט בתוך מארז — סרוק את מדבקת הקופסה", 409);
  }
  return box;
}

/** One pending box: the package row and its id, nothing else. */
async function mintPendingBox(
  tx: TransactionClient,
  args: { customer: number; shipment: number; packageType: number; makat: string },
): Promise<bigint> {
  const { datePart, dateKey } = localDateParts();
  const counter = await nextDailyPackageCounter(tx, dateKey);
  const packageId = packageIdFromBase(packageIdBase(args.customer, datePart, counter));
  await insertItemRow(tx, {
    itemId: packageId,
    customer: args.customer,
    shipment: args.shipment,
    itemType: args.packageType,
    serialNumber: null,
    makat: args.makat,
    model: "",
    manufacturer: "",
    manufacturerNo: "",
    packageId: null,
    packageSeq: null,
    templateSnapshot: null,
  });
  return packageId;
}

/**
 * Makes the shipment's boxes match its declared lines, per package type: a
 * missing unit gets a pending box, an extra pending box (newest first) goes.
 * Boxes already taken in are never touched — declaring fewer than were taken
 * in is refused. A sent shipment is left alone. Pending boxes follow the
 * shipment's customer (their ids keep the one they were minted with).
 */
export async function syncShipmentBoxes(tx: TransactionClient, shipmentId: number): Promise<{ created: number; removed: number }> {
  const ship = await tx.shipments.findUnique({ where: { id: shipmentId }, select: { customer_id: true, makat: true, is_sent: true } });
  if (!ship || ship.is_sent) return { created: 0, removed: 0 };

  const lines = await tx.shipment_items.findMany({
    where: { shipment_id: shipmentId },
    select: { item_type_id: true, quantity: true, makat: true },
    orderBy: { id: "asc" },
  });
  const wanted = new Map<number, { qty: number; makat: string }>();
  for (const l of lines) {
    if (l.item_type_id == null || !(l.quantity > 0)) continue;
    const w = wanted.get(l.item_type_id) ?? { qty: 0, makat: "" };
    w.qty += l.quantity;
    if (!w.makat && l.makat?.trim()) w.makat = l.makat.trim();
    wanted.set(l.item_type_id, w);
  }

  const boxes = await tx.$queryRaw<{ item_id: bigint; item_type_id: number; item_type_desc: string; routed: boolean }[]>`
    SELECT i.item_id, i.item_type_id, TRIM(t.item_type_desc) AS item_type_desc, (ir.item_id IS NOT NULL) AS routed
    FROM items i
    JOIN item_types t ON t.item_type_id = i.item_type_id AND t.is_package
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    WHERE i.shipment_id = ${shipmentId} AND i.package_id IS NULL
    ORDER BY i.item_id
  `;

  let created = 0;
  let removed = 0;
  for (const type of new Set([...wanted.keys(), ...boxes.map((b) => b.item_type_id)])) {
    const target = wanted.get(type)?.qty ?? 0;
    const have = boxes.filter((b) => b.item_type_id === type);
    const takenIn = have.filter((b) => b.routed).length;
    if (target < takenIn) {
      throw new PackageError(
        "SHIPMENT_BOXES_TAKEN_IN",
        `${have[0]?.item_type_desc ?? "סוג מארז"}: ${takenIn === 1 ? "כבר נקלט מארז אחד" : `כבר נקלטו ${takenIn} מארזים`} — אי אפשר להצהיר על פחות`,
        409,
      );
    }
    if (have.length < target) {
      const makat = wanted.get(type)?.makat || (ship.makat ?? "").trim();
      for (let n = have.length; n < target; n++) {
        await mintPendingBox(tx, { customer: ship.customer_id, shipment: shipmentId, packageType: type, makat });
        created++;
      }
    } else if (have.length > target) {
      const excess = have.filter((b) => !b.routed).slice(target - have.length).map((b) => b.item_id);
      await tx.items.deleteMany({ where: { item_id: { in: excess } } });
      removed += excess.length;
    }
  }

  await tx.$executeRaw`
    UPDATE items i SET customer_id = ${ship.customer_id}
    WHERE i.shipment_id = ${shipmentId} AND i.package_id IS NULL AND i.customer_id <> ${ship.customer_id}
      AND NOT EXISTS (SELECT 1 FROM item_routes ir WHERE ir.item_id = i.item_id)
  `;
  return { created, removed };
}

/** Removes a shipment's pending boxes; refuses while any box was taken in. */
export async function dropShipmentBoxes(tx: TransactionClient, shipmentId: number): Promise<void> {
  const rows = await tx.$queryRaw<{ item_id: bigint; routed: boolean }[]>`
    SELECT i.item_id, (ir.item_id IS NOT NULL) AS routed
    FROM items i LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    WHERE i.shipment_id = ${shipmentId}
  `;
  if (rows.some((r) => r.routed)) {
    throw new PackageError("SHIPMENT_TAKEN_IN", "לא ניתן למחוק משלוח שמארזים ממנו כבר נקלטו", 409);
  }
  await tx.items.deleteMany({ where: { item_id: { in: rows.map((r) => r.item_id) } } });
}

/**
 * The intake scan: a pending box enters its route (the package type's
 * default route) and its items are created from the template, one per unit,
 * in the template's order — without serials, which the opening station
 * records. Same routing rules as createPackage.
 */
export async function intakeBox(tx: TransactionClient, packageId: bigint): Promise<CreatedPackage> {
  const box = await lockBox(tx, packageId);
  if (box.routed) throw new PackageError("ALREADY_TAKEN_IN", "המארז הזה כבר נקלט", 409);
  if (box.is_sent) throw new PackageError("SHIPMENT_SENT", "המשלוח של המארז הזה כבר נשלח", 409);

  const template = await loadTemplate(tx, box.item_type_id);
  const units = template.flatMap((l) => Array.from({ length: Math.max(1, l.quantity) }, () => l));
  if (units.length === 0) {
    throw new PackageError("NO_TEMPLATE", `ל${box.item_type_desc} לא הוגדרה תכולה — יש להגדיר אותה בהגדרות סוגי המארזים`, 409);
  }
  if (units.length > MAX_PACKAGE_SEQ) {
    throw new PackageError("TOO_MANY_ITEMS", `מארז יכול להכיל עד ${MAX_PACKAGE_SEQ} פריטים`);
  }

  const typeRow = await tx.item_types.findUnique({ where: { item_type_id: box.item_type_id }, select: { default_route_number: true } });
  const routeNumber = typeRow?.default_route_number ?? 1;
  const packageLevel = await loadPackageLevelTypeIds(tx);
  const pkgShape = await loadRouteShape(tx, box.item_type_id, routeNumber);
  const pkgProblem = checkPackageRoute(pkgShape, packageLevel, routeNumber);
  if (pkgProblem || !pkgShape) throw new PackageError("PACKAGE_ROUTE_SHAPE", pkgProblem ?? "מסלול המארז לא תקין", 409);

  // Every unit's route before anything is written.
  const descs = new Map(
    (await tx.item_types.findMany({
      where: { item_type_id: { in: [...new Set(units.map((u) => u.item_type_id))] } },
      select: { item_type_id: true, item_type_desc: true },
    })).map((t) => [t.item_type_id, t.item_type_desc.trim()]),
  );
  const routes: number[] = [];
  for (const u of units) {
    const asInput: PackageItemInput = { itemType: u.item_type_id, serialNumber: "", makat: "", model: "", manufacturer: "", routeNumber: null };
    routes.push(await resolveItemRoute(tx, asInput, template, pkgShape, packageLevel, descs.get(u.item_type_id) ?? ""));
  }

  await tx.$executeRaw`
    UPDATE items SET template_snapshot = ${JSON.stringify(template)}::jsonb, package_next_seq = ${units.length + 1}::smallint
    WHERE item_id = ${packageId}
  `;
  await routeRow(tx, { itemId: packageId, itemType: box.item_type_id, routeNumber, firstStepTypeId: firstStep(pkgShape) });

  const base = baseOfId(packageId);
  const itemIds: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const itemId = itemIdFromBase(base, i + 1);
    await insertItemRow(tx, {
      itemId,
      customer: box.customer_id,
      shipment: box.shipment_id,
      itemType: u.item_type_id,
      serialNumber: null,
      makat: (u.makat ?? "").trim(),
      model: CHAR50(u.model),
      manufacturer: CHAR50(u.manufacturer_name),
      manufacturerNo: (u.manufacturer_no ?? "").trim(),
      packageId,
      packageSeq: i + 1,
      templateSnapshot: null,
    });
    await routeRow(tx, { itemId, itemType: u.item_type_id, routeNumber: routes[i], firstStepTypeId: firstStep(pkgShape) });
    itemIds.push(Number(itemId));
  }
  return { packageId: Number(packageId), itemIds };
}

/** Takes an intake back while nobody has worked on the box: its items go and
 *  it is pending again, its label still good. */
export async function undoIntake(tx: TransactionClient, packageId: bigint): Promise<void> {
  const box = await lockBox(tx, packageId);
  if (!box.routed) throw new PackageError("NOT_TAKEN_IN", "המארז הזה עוד לא נקלט", 409);
  const members = await tx.items.findMany({ where: { package_id: packageId }, select: { item_id: true } });
  const ids = [packageId, ...members.map((m) => m.item_id)];
  const why = await workDoneOn(tx, ids);
  if (why) throw new PackageError("PACKAGE_TOUCHED", `${why} — אי אפשר לבטל את הקליטה`, 409);
  for (const id of ids) await forgetItem(tx, id);
  await tx.item_routes.deleteMany({ where: { item_id: { in: ids } } });
  await tx.items.deleteMany({ where: { package_id: packageId } });
  await tx.$executeRaw`UPDATE items SET template_snapshot = NULL, package_next_seq = 1 WHERE item_id = ${packageId}`;
}

export type OpeningItem = { itemId: string; serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo?: string | null };

/**
 * The opening station records what is really in the box: every item kept
 * gets its serial and details, items that did not come are removed, items
 * the template did not foresee are added. Serials follow the intake rule
 * (lib/packages/serials.ts): not twice in the box, not on another item of
 * the same type in this shipment. Refusals carry `itemIndex` into the list
 * `items` then `add`, as the wizard shows them.
 */
export async function saveOpeningContents(
  tx: TransactionClient,
  packageId: bigint,
  input: { items: OpeningItem[]; remove: string[]; add: PackageItemInput[] },
): Promise<void> {
  const route = await tx.item_routes.findUnique({
    where: { item_id: packageId },
    select: { current_route_step: true, current_status: true, is_finished: true },
  });
  const box = await tx.items.findUnique({ where: { item_id: packageId }, select: { shipment_id: true, package_id: true } });
  if (!box || box.package_id != null) throw new PackageError("PACKAGE_NOT_FOUND", "המארז לא נמצא", 404);
  if (!route) throw new PackageError("NOT_TAKEN_IN", "המארז עוד לא נקלט", 409);
  const opening = route.current_route_step === 1 && !route.is_finished && (route.current_status === 1 || route.current_status === 2);
  if (!opening) throw new PackageError("PACKAGE_NOT_OPENING", "את תכולת המארז מעדכנים רק בעמדת הפתיחה", 409);

  const members = await tx.items.findMany({ where: { package_id: packageId }, select: { item_id: true, item_type_id: true } });
  const memberType = new Map(members.map((m) => [m.item_id.toString(), m.item_type_id]));
  const removeIds = [...new Set(input.remove)];
  for (const id of removeIds) if (!memberType.has(id)) throw new PackageError("NOT_IN_PACKAGE", "פריט שאינו במארז", 400);
  for (const it of input.items) {
    if (!memberType.has(it.itemId) || removeIds.includes(it.itemId)) throw new PackageError("NOT_IN_PACKAGE", "פריט שאינו במארז", 400);
  }
  if (members.length - removeIds.length + input.add.length < 1) {
    throw new PackageError("EMPTY_PACKAGE", "מארז חייב להכיל לפחות פריט אחד");
  }

  // Every serial of the box as it will be: required, and free.
  const entries = [
    ...input.items.map((it) => ({ itemType: memberType.get(it.itemId)!, serial: it.serialNumber, it })),
    ...input.add.map((it) => ({ itemType: it.itemType, serial: it.serialNumber, it })),
  ];
  const types = new Map(
    (await tx.item_types.findMany({
      where: { item_type_id: { in: [...new Set(entries.map((e) => e.itemType))] } },
      select: { item_type_id: true, item_type_desc: true },
    })).map((t) => [t.item_type_id, t.item_type_desc.trim()]),
  );
  const seen = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const { it, itemType } = entries[i];
    const desc = types.get(itemType) ?? "פריט";
    if (!it.serialNumber?.trim()) throw new PackageError("ITEM_SERIAL_REQUIRED", `${desc}: חסר מספר סריאלי`, 400, i);
    if (!it.makat?.trim() || !it.model?.trim() || !it.manufacturer?.trim()) {
      throw new PackageError("MISSING_FIELDS", `${desc}: יש למלא מק״ט, דגם ויצרן`, 400, i);
    }
    const key = serialKey(it.serialNumber);
    const first = seen.get(key);
    if (first != null) throw new PackageError("ITEM_SERIAL_DUPLICATE", `${desc}: הסריאלי ${it.serialNumber.trim()} כבר הוזן בשורה ${first + 1}`, 409, i);
    seen.set(key, i);
  }
  const existing = await findSerials(tx, entries.map((e) => e.serial));
  for (let i = 0; i < entries.length; i++) {
    const { serial, itemType } = entries[i];
    const clash = existing.find((m) =>
      m.serial === serialKey(serial) && m.shipment_id === box.shipment_id && m.item_type_id === itemType && String(m.package_id) !== packageId.toString());
    if (clash) {
      throw new PackageError("ITEM_SERIAL_EXISTS", `${types.get(itemType) ?? "פריט"}: הסריאלי ${serial.trim()} כבר נקלט במשלוח הזה`, 409, i);
    }
  }

  // Items that did not come: still at the opening with the box, nothing
  // recorded on them (the station started them along with the box).
  for (const id of removeIds) {
    const itemId = BigInt(id);
    const why = await workDoneOn(tx, [itemId], { atOpening: true });
    if (why) throw new PackageError("ITEM_TOUCHED", `${why} — אי אפשר להסיר את הפריט`, 409);
    await forgetItem(tx, itemId);
    await tx.item_routes.deleteMany({ where: { item_id: itemId } });
    await tx.items.delete({ where: { item_id: itemId } });
  }
  for (const it of input.items) {
    const itemId = BigInt(it.itemId);
    await tx.items.update({
      where: { item_id: itemId },
      data: {
        serial_no: it.serialNumber.trim(),
        makat: it.makat.trim(),
        model: CHAR50(it.model),
        manufacturer_name: CHAR50(it.manufacturer),
        manufacturer_no: (it.manufacturerNo ?? "").trim(),
      },
    });
    await resyncItemDims(tx, itemId);
  }
  for (let k = 0; k < input.add.length; k++) {
    try {
      await addPackageItem(tx, packageId, input.add[k]);
    } catch (e) {
      // On the added row it is about (after the kept ones, as the list runs).
      if (e instanceof PackageError && e.itemIndex == null) throw new PackageError(e.code, e.message, e.status, input.items.length + k);
      throw e;
    }
  }
}
