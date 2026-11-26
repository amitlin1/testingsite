import type { Session } from "next-auth";
import { identityOf } from "@/lib/auth/identity";
import { ACCESS, can } from "@/lib/auth/roles";

/**
 * Who a shipment worker field ("עובד מקבל" on a new / edited shipment, "עובד
 * מוציא" on a send) is attributed to. One rule, client and server:
 *
 *   - everyone starts from THEMSELVES, identified by the employeeNumber on
 *     their login;
 *   - only a manager may change it, picking any storekeeper (or themselves):
 *     what a manager submitted is kept;
 *   - anyone else is always themselves, whatever the client sent — unless the
 *     shipment already has its worker (editing never reassigns the receiver to
 *     the editor);
 *   - not a manager and no employeeNumber: nobody to attribute it to.
 *
 * The forms lock the field by it (useShipmentWorker), and POST/PUT
 * /api/shipments and POST /api/shipment-history apply it, so the lock can't be
 * sidestepped.
 */

export type ShipmentWorker = { id: number | null; name: string | null };

/** May this login attribute a shipment to someone else? */
export function picksShipmentWorker(session: Session | null | undefined): boolean {
  return can(session?.roles, ACCESS.actAsOtherWorker);
}

export function resolveShipmentWorker(
  session: Session,
  submitted: ShipmentWorker,
  keep?: ShipmentWorker | null,
): { worker: ShipmentWorker } | { error: string } {
  if (picksShipmentWorker(session)) {
    return { worker: { id: submitted.id || null, name: submitted.name || null } };
  }
  if (keep?.id != null) return { worker: keep };
  const { workerId, displayName } = identityOf(session);
  if (workerId == null) {
    return { error: "לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו ב'הגדרות > משתמשים'." };
  }
  return { worker: { id: workerId, name: displayName } };
}
