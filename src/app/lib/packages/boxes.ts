import { TransactionClient } from "@/app/lib/prisma";
import { forgetItem, resyncItemDims } from "@/app/lib/metrics/item-lifecycle";
import { parseItemQr, sameShipmentNumber } from "@/app/lib/itemQrParser";
import { PackageError } from "./errors";
import { MAX_PACKAGE_SEQ, baseOfId, itemIdFromBase, localDateParts, mintOrderKey, packageIdBase, packageIdFromBase } from "./ids";
import {
  CHAR50,
  CreatedPackage,
  PackageItemInput,
  addPackageItem,
  insertItemRow,
  loadTemplate,
  reserveDailyPackageCounters,
  resolveItemRoute,
  routeRow,
} from "./create-package";
import { checkPackageRoute, firstStep, loadPackageLevelTypeIds, loadRouteShape } from "./route-rules";
import { findSerials, serialKey } from "./serials";
import { serialProblem } from "./serial-key";
import { workDoneOn } from "./untouched";

/**
 * A box from the shipment to its opening (docs/packages/PLAN.md §6, as
 * changed on 2026-10-19 and 2026-10-27):
 *
 *   shipment saved  → syncShipmentBoxes: one PENDING box per declared unit of
 *                     each line — the package row with its id minted, linked
 *                     to its line (items.shipment_item_id) and carrying the
 *                     line's details (the certificate row), no route, nothing
 *                     inside. Its label prints from the shipment.
 *   intake scan     → intakeBox: the box enters its route and its items are
 *                     created from the package type's template, without
 *                     serials, with the box's details. undoIntake takes it
 *                     back while untouched.
 *   opening station → bindCertificateRow: the certificate row scanned at the
 *                     box makes sure the box is that row's (a label stuck on
 *                     the wrong box of the type is put right);
 *                     saveOpeningContents: the items that are really in the
 *                     box, each with its serial (details stay the
 *                     shipment's — the worker does not change them).
 *
 * "Pending" is exactly: a package row (item type is_package, package_id NULL)
 * with no item_routes row. Nothing reads the ledger for it: item_created is
 * recorded at intake, when the box gets its route.
 */

type DetailCols = { makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null };

type BoxRow = DetailCols & {
  item_id: bigint;
  customer_id: number;
  shipment_id: number;
  item_type_id: number;
  item_type_desc: string;
  is_package: boolean;
  package_id: bigint | null;
  shipment_item_id: number | null;
  routed: boolean;
  is_sent: boolean | null;
};

/** What a box says about its contents: its shipment line's certificate row. */
type BoxDetails = { makat: string; model: string; manufacturer: string; manufacturerNo: string };

const boxDetails = (r: DetailCols): BoxDetails => ({
  makat: (r.makat ?? "").trim(),
  model: CHAR50(r.model),
  manufacturer: CHAR50(r.manufacturer_name),
  manufacturerNo: (r.manufacturer_no ?? "").trim(),
});
const sameDetails = (a: BoxDetails, b: BoxDetails) =>
  a.makat === b.makat && a.model === b.model && a.manufacturer === b.manufacturer && a.manufacturerNo === b.manufacturerNo;
const byMintOrder = (a: { item_id: bigint }, b: { item_id: bigint }) => mintOrderKey(a.item_id).localeCompare(mintOrderKey(b.item_id));

/** The package row for an intake / undo, locked; refusals name the problem. */
async function lockBox(tx: TransactionClient, packageId: bigint): Promise<BoxRow> {
  const rows = await tx.$queryRaw<BoxRow[]>`
    SELECT i.item_id, i.customer_id, i.shipment_id, i.item_type_id, TRIM(t.item_type_desc) AS item_type_desc,
           t.is_package, i.package_id, i.shipment_item_id, (ir.item_id IS NOT NULL) AS routed, s.is_sent,
           i.makat, i.model, i.manufacturer_name, i.manufacturer_no
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
    throw new PackageError("NOT_A_PACKAGE", "זו מדבקה של פריט בתוך מארז — סרוק את מדבקת המארז", 409);
  }
  return box;
}

/** Pending boxes for one shipment line: the package rows, their ids from one
 *  reserved run of the day's counter, all written in one statement. */
async function mintPendingBoxes(
  tx: TransactionClient,
  args: { customer: number; shipment: number; packageType: number; lineId: number; details: BoxDetails; count: number },
): Promise<bigint[]> {
  if (args.count < 1) return [];
  const { datePart, dateKey } = localDateParts();
  const first = await reserveDailyPackageCounters(tx, dateKey, args.count);
  const ids = Array.from({ length: args.count }, (_, k) => packageIdFromBase(packageIdBase(args.customer, datePart, first + k)));
  const { makat, model, manufacturer, manufacturerNo } = args.details;
  await tx.$executeRaw`
    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name,
                       manufacturer_no, shipment_id, shipment_item_id)
    SELECT v::bigint, ${args.customer}, ${args.packageType}, NULL, ${makat}, ${model}, ${manufacturer},
           ${manufacturerNo}, ${args.shipment}, ${args.lineId}
    FROM UNNEST(${ids.map(String)}::text[]) AS v
  `;
  return ids;
}

/** What a sync did to the boxes — what a shipment edit tells the worker. */
export type BoxSync = {
  /** Boxes minted. */
  created: number;
  /** Pending boxes deleted: their labels no longer scan. */
  removed: string[];
  /** Pending boxes minted again under the shipment's new customer (the id
   *  holds the customer): their labels are printed again. */
  reminted: number;
};

type SyncBox = DetailCols & {
  item_id: bigint;
  item_type_id: number;
  item_type_desc: string;
  shipment_item_id: number | null;
  customer_id: number;
  routed: boolean;
};

/**
 * Makes the shipment's boxes match its declared lines, line by line: a line
 * short of boxes gets pending ones, a line with too many loses its newest
 * pending ones, and every pending box carries its line's details as they are
 * now. A line edit touches only that line's boxes — the box labelled for row
 * 1 stays row 1's. Boxes already taken in are never touched: declaring fewer
 * than were taken in, or retyping their line, is refused. A pending box
 * minted for another customer is minted again (the id holds the customer).
 * A box no line claims (minted before boxes were linked) is adopted by a line
 * of its type with room, or removed if pending. A sent shipment is left alone.
 */
export async function syncShipmentBoxes(tx: TransactionClient, shipmentId: number): Promise<BoxSync> {
  // The shipment row lock serializes two saves of one shipment.
  const ship = (await tx.$queryRaw<{ customer_id: number; makat: string | null; is_sent: boolean | null }[]>`
    SELECT customer_id, makat, is_sent FROM shipments WHERE id = ${shipmentId} FOR UPDATE
  `)[0];
  if (!ship || ship.is_sent) return { created: 0, removed: [], reminted: 0 };

  const lines = await tx.$queryRaw<(DetailCols & { id: number; item_type_id: number | null; quantity: number; item_type_desc: string | null })[]>`
    SELECT si.id, si.item_type_id, si.quantity, si.makat, si.model, si.manufacturer_name, si.manufacturer_no,
           TRIM(t.item_type_desc) AS item_type_desc
    FROM shipment_items si
    LEFT JOIN item_types t ON t.item_type_id = si.item_type_id
    WHERE si.shipment_id = ${shipmentId}
    ORDER BY si.id
  `;

  // Lock the boxes first, then read them in a statement of its own: an intake
  // that got there first has committed by now, and a fresh read sees its
  // route (a locking read would keep the join's older view).
  await tx.$queryRaw`SELECT item_id FROM items WHERE shipment_id = ${shipmentId} AND package_id IS NULL FOR UPDATE`;
  const boxes = await tx.$queryRaw<SyncBox[]>`
    SELECT i.item_id, i.item_type_id, TRIM(t.item_type_desc) AS item_type_desc, i.shipment_item_id, i.customer_id,
           (ir.item_id IS NOT NULL) AS routed, i.makat, i.model, i.manufacturer_name, i.manufacturer_no
    FROM items i
    JOIN item_types t ON t.item_type_id = i.item_type_id AND t.is_package
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    WHERE i.shipment_id = ${shipmentId} AND i.package_id IS NULL
  `;

  let created = 0;
  let reminted = 0;
  const removed: bigint[] = [];
  const del = async (ids: bigint[]) => {
    if (ids.length > 0) await tx.items.deleteMany({ where: { item_id: { in: ids } } });
  };

  const byLine = new Map<number, SyncBox[]>(lines.map((l) => [l.id, []]));
  const loose: SyncBox[] = [];
  for (const b of boxes) {
    const mine = b.shipment_item_id != null ? byLine.get(b.shipment_item_id) : undefined;
    if (mine) mine.push(b);
    else loose.push(b);
  }

  // Boxes no line claims: taken-in ones are placed first, oldest first.
  loose.sort((a, b) => Number(b.routed) - Number(a.routed) || byMintOrder(a, b));
  for (const b of loose) {
    const line = lines.find((l) => l.item_type_id === b.item_type_id && byLine.get(l.id)!.filter((x) => x.item_type_id === l.item_type_id).length < l.quantity);
    if (line) {
      await tx.$executeRaw`UPDATE items SET shipment_item_id = ${line.id} WHERE item_id = ${b.item_id}`;
      byLine.get(line.id)!.push(b);
    } else if (!b.routed) {
      await del([b.item_id]);
      removed.push(b.item_id);
    } else {
      const takenIn = boxes.filter((x) => x.item_type_id === b.item_type_id && x.routed).length;
      throw new PackageError(
        "SHIPMENT_BOXES_TAKEN_IN",
        `${b.item_type_desc}: ${takenIn === 1 ? "כבר נקלט מארז אחד" : `כבר נקלטו ${takenIn} מארזים`} — אי אפשר להצהיר על פחות`,
        409,
      );
    }
  }

  for (const [n, line] of lines.entries()) {
    const label = `שורה ${n + 1}${line.item_type_desc ? ` (${line.item_type_desc})` : ""}`;
    let mine = byLine.get(line.id)!;

    // The line was retyped: its pending boxes of the old type go; a box
    // already taken in keeps its type, so the line cannot change.
    const otherType = mine.filter((b) => b.item_type_id !== line.item_type_id);
    const takenOther = otherType.find((b) => b.routed);
    if (takenOther) {
      throw new PackageError("SHIPMENT_LINE_TAKEN_IN", `${label}: כבר נקלט ממנה ${takenOther.item_type_desc} — אי אפשר לשנות את סוג המארז בשורה`, 409);
    }
    await del(otherType.map((b) => b.item_id));
    removed.push(...otherType.map((b) => b.item_id));
    mine = mine.filter((b) => b.item_type_id === line.item_type_id);

    const takenIn = mine.filter((b) => b.routed).length;
    if (line.quantity < takenIn) {
      throw new PackageError(
        "SHIPMENT_BOXES_TAKEN_IN",
        `${label}: ${takenIn === 1 ? "כבר נקלט מארז אחד" : `כבר נקלטו ${takenIn} מארזים`} — אי אפשר להצהיר על פחות`,
        409,
      );
    }

    // The customer is part of the id: a pending box minted for another
    // customer is minted again below, under the shipment's customer.
    const stale = mine.filter((b) => !b.routed && b.customer_id !== ship.customer_id);
    await del(stale.map((b) => b.item_id));
    mine = mine.filter((b) => !stale.includes(b));
    const replaced = Math.min(stale.length, Math.max(0, line.quantity - mine.length));
    reminted += replaced;
    removed.push(...stale.slice(replaced).map((b) => b.item_id));

    // Too many: the newest pending boxes go.
    if (mine.length > line.quantity) {
      const extra = mine.filter((b) => !b.routed).sort((a, b) => byMintOrder(b, a)).slice(0, mine.length - line.quantity);
      await del(extra.map((b) => b.item_id));
      removed.push(...extra.map((b) => b.item_id));
      mine = mine.filter((b) => !extra.includes(b));
    }

    // A line without a makat takes the shipment's.
    const details = boxDetails({ ...line, makat: line.makat?.trim() || ship.makat });
    if (mine.length < line.quantity && line.item_type_id != null) {
      const minted = await mintPendingBoxes(tx, {
        customer: ship.customer_id, shipment: shipmentId, packageType: line.item_type_id, lineId: line.id, details,
        count: line.quantity - mine.length,
      });
      created += minted.length;
    }

    const outdated = mine.filter((b) => !b.routed && !sameDetails(boxDetails(b), details)).map((b) => String(b.item_id));
    if (outdated.length > 0) {
      await tx.$executeRaw`
        UPDATE items SET makat = ${details.makat}, model = ${details.model}, manufacturer_name = ${details.manufacturer},
                         manufacturer_no = ${details.manufacturerNo}
        WHERE item_id = ANY(${outdated}::text[]::bigint[])
      `;
    }
  }

  return { created, removed: removed.map(String), reminted };
}

/** Removes a shipment's pending boxes; refuses while any box was taken in. */
export async function dropShipmentBoxes(tx: TransactionClient, shipmentId: number): Promise<void> {
  await tx.$queryRaw`SELECT item_id FROM items WHERE shipment_id = ${shipmentId} FOR UPDATE`;
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
 * records. Each item takes the box's details (its shipment line's
 * certificate row); the template names types, quantities and routes only.
 * Same routing rules as createPackage.
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
  const fromBox = boxDetails(box);
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
      ...fromBox,
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

/** Only the opening station changes what is in a box: the box is at step 1 of
 *  its route, waiting or open, not finished. */
async function assertAtOpening(tx: TransactionClient, packageId: bigint): Promise<void> {
  const route = await tx.item_routes.findUnique({
    where: { item_id: packageId },
    select: { current_route_step: true, current_status: true, is_finished: true },
  });
  if (!route) throw new PackageError("NOT_TAKEN_IN", "המארז עוד לא נקלט", 409);
  const opening = route.current_route_step === 1 && !route.is_finished && (route.current_status === 1 || route.current_status === 2);
  if (!opening) throw new PackageError("PACKAGE_NOT_OPENING", "את תכולת המארז מעדכנים רק בעמדת הפתיחה", 409);
}

/** A box takes a shipment line: the link, and the line's details on the box
 *  and, once taken in, on its items. */
async function setBoxLine(tx: TransactionClient, boxId: bigint, lineId: number | null, d: BoxDetails): Promise<void> {
  await tx.$executeRaw`
    UPDATE items SET shipment_item_id = ${lineId}, makat = ${d.makat}, model = ${d.model},
                     manufacturer_name = ${d.manufacturer}, manufacturer_no = ${d.manufacturerNo}
    WHERE item_id = ${boxId}
  `;
  await tx.$executeRaw`
    UPDATE items SET makat = ${d.makat}, model = ${d.model}, manufacturer_name = ${d.manufacturer}, manufacturer_no = ${d.manufacturerNo}
    WHERE package_id = ${boxId}
  `;
}

/** What scanning a certificate row at the opening station found. */
export type CertRowBinding = {
  /** The row is one of the shipment's lines (scanned when the shipment was saved). */
  matched: boolean;
  /** The box was another row's until now: its label was on this row's box. */
  moved: boolean;
  /** The row's number on the certificate (מס"ד). */
  rowNo: string;
  /** The row's serial — a row with one is a single unit, this box. */
  serialNumber: string | null;
  /** The box's details as they are now (null when the row matched no line). */
  details: BoxDetails | null;
};

/**
 * The certificate row scanned at the opening station, at the box it
 * describes. A row of another shipment, or of another package type, is
 * refused. A row the shipment never scanned changes nothing (its serial still
 * fills the field). Otherwise the box becomes that row's: when its label was
 * on another row's box, it takes the scanned row's line and details (its
 * items too), and a box of the scanned row that nobody has opened takes this
 * box's old line in turn — every row keeps its count of boxes. When every box
 * of the row was opened already, the scan is refused: the row is someone
 * else's, or was scanned at the wrong box.
 */
export async function bindCertificateRow(tx: TransactionClient, packageId: bigint, barcode: string): Promise<CertRowBinding> {
  const row = parseItemQr(barcode.trim())?.[0];
  if (!row) throw new PackageError("NOT_A_CERT_ROW", "ברקוד השורה לא נקרא במלואו — סרוק שוב", 400);
  const box = await lockBox(tx, packageId);
  await assertAtOpening(tx, packageId);

  const ship = await tx.shipments.findUnique({ where: { id: box.shipment_id }, select: { shipment_code: true, makat: true } });
  if (row.shipmentNumber && !sameShipmentNumber(row.shipmentNumber, ship?.shipment_code)) {
    throw new PackageError("CERT_ROW_OTHER_SHIPMENT", `השורה שייכת לתעודת משלוח ${row.shipmentNumber}, והמארז ממשלוח ${ship?.shipment_code?.trim() ?? ""}`, 409);
  }
  const base = { rowNo: row.rowNum, serialNumber: row.serialNumber };
  const lines = await tx.$queryRaw<(DetailCols & { id: number; item_type_id: number | null; item_type_desc: string | null; cert_row_raw: string | null })[]>`
    SELECT si.id, si.item_type_id, TRIM(t.item_type_desc) AS item_type_desc, si.cert_row_raw,
           si.makat, si.model, si.manufacturer_name, si.manufacturer_no
    FROM shipment_items si LEFT JOIN item_types t ON t.item_type_id = si.item_type_id
    WHERE si.shipment_id = ${box.shipment_id}
  `;
  const line = lines.find((l) => l.cert_row_raw === row.raw);
  if (!line) return { ...base, matched: false, moved: false, details: null };
  if (line.item_type_id !== box.item_type_id) {
    throw new PackageError("CERT_ROW_OTHER_TYPE", `שורה ${row.rowNum} בתעודה היא של ${line.item_type_desc ?? "סוג מארז אחר"}, והמארז הוא ${box.item_type_desc}`, 409);
  }
  const detailsOf = (l: DetailCols) => boxDetails({ ...l, makat: l.makat?.trim() || ship?.makat || "" });
  if (box.shipment_item_id === line.id) return { ...base, matched: true, moved: false, details: boxDetails(box) };

  // The scanned row's other boxes, and whether anyone opened them yet.
  const partners = await tx.$queryRaw<{ item_id: bigint; routed: boolean; opened: boolean }[]>`
    SELECT i.item_id, (ir.item_id IS NOT NULL) AS routed,
           EXISTS (SELECT 1 FROM items m WHERE m.package_id = i.item_id AND m.serial_no IS NOT NULL) AS opened
    FROM items i LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    WHERE i.shipment_item_id = ${line.id} AND i.item_id <> ${packageId} AND i.package_id IS NULL
  `;
  const partner = partners.find((p) => !p.routed) ?? partners.find((p) => !p.opened);
  if (!partner && partners.length > 0) {
    throw new PackageError("CERT_ROW_TAKEN", `כל המארזים של שורה ${row.rowNum} בתעודה כבר נפתחו — בדוק שסרקת את השורה של המארז הזה`, 409);
  }

  const details = detailsOf(line);
  await setBoxLine(tx, packageId, line.id, details);
  if (partner) {
    const old = lines.find((l) => l.id === box.shipment_item_id);
    await setBoxLine(tx, partner.item_id, old?.id ?? null, old ? detailsOf(old) : boxDetails(box));
  }
  return { ...base, matched: true, moved: true, details };
}

export type OpeningItem = { itemId: string; serialNumber: string };
export type OpeningAdd = { itemType: number; serialNumber: string };

/**
 * The opening station records what is really in the box: every item kept
 * gets its serial, items that did not come are removed, items the template
 * did not foresee are added. The serial is the only thing the worker gives:
 * details are the shipment's — a kept item keeps its own (an item taken in
 * before items inherited them, with none, gets the box's), an added item
 * takes the box's. Serials follow the intake rule
 * (lib/packages/serials.ts): not twice in the box, not on another item of
 * the same type in this shipment. Refusals carry `itemIndex` into the list
 * `items` then `add`, as the wizard shows them.
 */
export async function saveOpeningContents(
  tx: TransactionClient,
  packageId: bigint,
  input: { items: OpeningItem[]; remove: string[]; add: OpeningAdd[] },
): Promise<void> {
  const box = await tx.items.findUnique({
    where: { item_id: packageId },
    select: { shipment_id: true, package_id: true, makat: true, model: true, manufacturer_name: true, manufacturer_no: true },
  });
  if (!box || box.package_id != null) throw new PackageError("PACKAGE_NOT_FOUND", "המארז לא נמצא", 404);
  await assertAtOpening(tx, packageId);

  const members = await tx.items.findMany({
    where: { package_id: packageId },
    select: { item_id: true, item_type_id: true, makat: true, model: true, manufacturer_name: true, manufacturer_no: true },
  });
  const memberType = new Map(members.map((m) => [m.item_id.toString(), m.item_type_id]));
  const memberById = new Map(members.map((m) => [m.item_id.toString(), m]));
  const fromBox = boxDetails(box);
  const removeIds = [...new Set(input.remove)];
  for (const id of removeIds) if (!memberType.has(id)) throw new PackageError("NOT_IN_PACKAGE", "פריט שאינו במארז", 400);
  for (const it of input.items) {
    if (!memberType.has(it.itemId) || removeIds.includes(it.itemId)) throw new PackageError("NOT_IN_PACKAGE", "פריט שאינו במארז", 400);
  }
  if (members.length - removeIds.length + input.add.length < 1) {
    throw new PackageError("EMPTY_PACKAGE", "מארז חייב להכיל לפחות פריט אחד");
  }

  // Every serial of the box as it will be: required, a serial, and free.
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
    const notSerial = serialProblem(it.serialNumber);
    if (notSerial) throw new PackageError("ITEM_SERIAL_INVALID", `${desc}: ${notSerial}`, 400, i);
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
    const why = await workDoneOn(tx, [itemId], { atOpening: true, noun: "פריט" });
    if (why) throw new PackageError("ITEM_TOUCHED", `${why} — אי אפשר לסמן אותו כ״לא הגיע״`, 409);
    await forgetItem(tx, itemId);
    await tx.item_routes.deleteMany({ where: { item_id: itemId } });
    await tx.items.delete({ where: { item_id: itemId } });
  }
  for (const it of input.items) {
    const itemId = BigInt(it.itemId);
    const blank = !Object.values(boxDetails(memberById.get(it.itemId)!)).some(Boolean);
    await tx.items.update({
      where: { item_id: itemId },
      data: {
        serial_no: it.serialNumber.trim(),
        ...(blank && {
          makat: fromBox.makat,
          model: fromBox.model,
          manufacturer_name: fromBox.manufacturer,
          manufacturer_no: fromBox.manufacturerNo,
        }),
      },
    });
    await resyncItemDims(tx, itemId);
  }
  for (let k = 0; k < input.add.length; k++) {
    try {
      await addPackageItem(tx, packageId, { ...input.add[k], ...fromBox, routeNumber: null });
    } catch (e) {
      // On the added row it is about (after the kept ones, as the list runs).
      if (e instanceof PackageError && e.itemIndex == null) throw new PackageError(e.code, e.message, e.status, input.items.length + k);
      throw e;
    }
  }
}
