import { Prisma } from "@prisma/client";
import { resyncItemDims } from "@/app/lib/metrics/ledger/item-lifecycle";
import { prisma, TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { nestedPackageRefusal } from "./create-package";
import { loadPackageContext } from "./context";
import { PackageError } from "./errors";
import { assertItemFitsBox, deleteItemRows, restartRoute } from "./lifecycle";
import { recheckPackageReadiness } from "./readiness";
import { resetPackageToOpening } from "./reset";
import { loadPackageLevelTypeIds, loadRouteShape } from "./route-rules";
import { assertSerialFreeForItem } from "./serials";
import { DEFAULT_ROUTE_NUMBER } from "./template-wire";

/**
 * PUT and DELETE /api/items/[id]: an items row edited or deleted — the box
 * itself (a box is an items row) or an item inside one.
 */

const ITEM_NOT_FOUND = "הפריט לא נמצא";

/** A row that vanished under the write (Prisma P2025) is a 404. */
async function orNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw new HttpError(404, ITEM_NOT_FOUND);
    throw e;
  }
}

export type ItemEdit = {
  customer: number;
  itemType: number;
  /** null: none sent. */
  serialNumber: string | null;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo: string;
  /** The worker saw the "the whole box starts over" warning and confirmed. */
  confirmPackageReset: boolean;
  workerId: number | null;
  workerName: string | null;
};

export type ItemEditOutcome = { item_id: string; retyped: boolean; packageReset: string[] | null };

/**
 * The editable base fields of a row. The id, the shipment and the
 * status / progress fields (item_routes, driven by the testing workflow) are
 * not edited here. For every field but the type it is an ordinary correction:
 * the ledger freezes customer / shipment / serial onto each run and interval
 * so no read query has to join items (§3.6), and metrics_resync_item_dims
 * re-freezes them.
 *
 * Changing the TYPE re-routes the row: a different type can have an entirely
 * different set of stations, so the steps already walked mean nothing on the
 * new route and the row restarts it (lifecycle.ts restartRoute). Package
 * model (docs/features/packages/PLAN.md §4, "שינוי סוג"):
 *   - a PACKAGE never changes type (delete and re-create instead);
 *   - an item inside a box may not become a package type;
 *   - retyping an item while its box is still at the opening step restarts
 *     just that item — its new route must still fit the box;
 *   - retyping an item after the box was opened resets the WHOLE box to the
 *     opening station, and only with `confirmPackageReset` (the UI shows the
 *     warning first; without it the answer is 409 PACKAGE_RESET_REQUIRED).
 */
export function editItem(tx: TransactionClient, itemId: bigint, edit: ItemEdit): Promise<ItemEditOutcome> {
  return orNotFound(async () => {
    const ctx = await loadPackageContext(tx, itemId);
    if (!ctx) throw new PackageError("ITEM_NOT_FOUND", ITEM_NOT_FOUND, 404);

    // A package has no serial; an item inside a box must carry one.
    if (!ctx.isPackage && !edit.serialNumber) {
      throw new PackageError("MISSING_FIELDS", "חסר מספר סריאלי");
    }
    if (!ctx.isPackage) await assertSerialFreeForItem(tx, itemId, edit.itemType, String(edit.serialNumber));

    const route = await tx.item_routes.findUnique({ where: { item_id: itemId }, select: { item_type_id: true } });
    const typeChanged = route != null && route.item_type_id !== edit.itemType;

    let nextTypeDesc = "";
    if (typeChanged) {
      const nextType = await tx.item_types.findUnique({
        where: { item_type_id: edit.itemType },
        select: { is_package: true, item_type_desc: true },
      });
      if (!nextType) throw new PackageError("ITEM_TYPE_NOT_FOUND", "סוג הפריט לא נמצא", 404);
      nextTypeDesc = nextType.item_type_desc.trim();
      if (ctx.isPackage) {
        throw new PackageError("PACKAGE_TYPE_LOCKED", "לא ניתן לשנות סוג של מארז — יש למחוק וליצור מחדש", 409);
      }
      if (nextType.is_package) throw nestedPackageRefusal(nextTypeDesc);
    }

    const updated = await tx.items.update({
      where: { item_id: itemId },
      data: {
        customer_id: edit.customer,
        item_type_id: edit.itemType,
        serial_no: edit.serialNumber,
        makat: edit.makat,
        model: edit.model,
        manufacturer_name: edit.manufacturer,
        manufacturer_no: edit.manufacturerNo,
      },
    });

    let packageReset: string[] | null = null;
    if (typeChanged) packageReset = await retype(tx, itemId, ctx.packageId, nextTypeDesc, edit);

    // Same transaction as the writes above (§4.8).
    await resyncItemDims(tx, itemId);

    return { item_id: updated.item_id.toString(), retyped: typeChanged, packageReset };
  });
}

/** The row restarts on its new type. Answers the rows a box reset sent back
 *  to the opening, or null when only this row restarted. */
async function retype(
  tx: TransactionClient,
  itemId: bigint,
  packageId: bigint | null,
  nextTypeDesc: string,
  edit: ItemEdit,
): Promise<string[] | null> {
  // A route_number is only meaningful within a type, so the old one cannot be
  // carried across.
  const routeNumber = DEFAULT_ROUTE_NUMBER;
  const { workerId, workerName } = edit;

  // Inside a box: the new route must fit the box's. A box without its route
  // row or its route is not checked.
  let packagePastOpening = false;
  if (packageId != null) {
    const pkgRoute = await tx.item_routes.findUnique({
      where: { item_id: packageId },
      select: { item_type_id: true, route_number: true, current_route_step: true, is_finished: true },
    });
    if (pkgRoute) {
      const pkgShape = await loadRouteShape(tx, pkgRoute.item_type_id, pkgRoute.route_number);
      if (pkgShape) {
        const box = { shape: pkgShape, packageLevel: await loadPackageLevelTypeIds(tx) };
        await assertItemFitsBox(tx, { itemType: edit.itemType, routeNumber }, box, nextTypeDesc);
      }
      packagePastOpening = pkgRoute.current_route_step > 1 || pkgRoute.is_finished;
    }
  }

  if (packagePastOpening && !edit.confirmPackageReset) {
    throw new PackageError("PACKAGE_RESET_REQUIRED", "שינוי הסוג יאפס את כל המארז ויחזיר אותו לעמדת הפתיחה — נדרש אישור", 409);
  }

  if (packagePastOpening && packageId != null) {
    // The whole box starts over; the reset restarts each row on its CURRENT
    // type and route, so this row's new ones go onto its route row first.
    await tx.item_routes.update({ where: { item_id: itemId }, data: { item_type_id: edit.itemType, route_number: routeNumber } });
    const outcome = await resetPackageToOpening(tx, packageId, { reason: "retyped", workerId, workerName });
    return outcome.resetItemIds.map((x) => x.toString());
  }

  await restartRoute(tx, {
    itemId,
    itemType: edit.itemType,
    routeNumber,
    now: new Date(),
    abandonReason: "retyped",
    event: { key: { name: "retype", item: true, unique: true }, reason: "manual_override", workerId, workerName },
  });
  // An item that left the closing gate (its new route starts at the opening)
  // may have been the last one the box was waiting for.
  if (packageId != null) await recheckPackageReadiness(tx, packageId, { workerId, workerName });
  return null;
}

/**
 * Deletes a row and everything owned solely by it (lifecycle.ts
 * deleteItemRows). Package model (docs/features/packages/PLAN.md §4):
 *   - deleting a PACKAGE deletes every item inside it (items.package_id → the
 *     box is a real FK, so it could not go alone anyway). Without `cascade`
 *     the items are reported back as a 409 so the UI can list them;
 *   - deleting the LAST item inside a box is refused: an empty package is not
 *     allowed — delete the package instead;
 *   - after an item leaves a box, the box's closing gate is re-evaluated.
 */
export async function deleteItem(itemId: bigint, opts: { cascade: boolean }): Promise<{ deletedConnectedCount: number }> {
  return orNotFound(async () => {
    const ctx = await loadPackageContext(prisma, itemId);
    if (ctx?.packageId != null) {
      const siblings = await prisma.items.count({ where: { package_id: ctx.packageId } });
      if (siblings <= 1) {
        throw new HttpError(409, "זה הפריט האחרון במארז — יש למחוק את המארז במקום", {
          code: "LAST_PACKAGE_ITEM",
          extra: { packageId: ctx.packageId.toString() },
        });
      }
    }

    const children = await prisma.items.findMany({
      where: { package_id: itemId },
      select: { item_id: true, serial_no: true, model: true },
    });
    if (children.length > 0 && !opts.cascade) {
      throw new HttpError(409, "למארז יש פריטים בתוכו — מחיקתו תמחק גם אותם", {
        code: "PACKAGE_HAS_ITEMS",
        extra: { connectedItems: children.map((c) => ({ item_id: c.item_id.toString(), serial_no: c.serial_no, model: c.model })) },
      });
    }

    await prisma.$transaction(async (tx) => {
      await deleteItemRows(tx, itemId, children.map((c) => c.item_id));
      // One item fewer to wait for: the box may be ready for closing now.
      if (ctx?.packageId != null) await recheckPackageReadiness(tx, ctx.packageId, {});
    });
    return { deletedConnectedCount: children.length };
  });
}
