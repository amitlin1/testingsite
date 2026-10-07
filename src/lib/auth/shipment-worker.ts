import type { Session } from "next-auth";
import { isAdmin } from "./roles";

export type ShipmentWorker = { id: number | null; name: string | null };

/**
 * Who a shipment worker field ("עובד מקבל" / "עובד מוציא") is attributed to —
 * the server side of useShipmentWorker:
 *
 *   - a manager may attribute it to anyone: what they submitted is kept;
 *   - anyone else is always THEMSELVES (the employeeNumber on their login),
 *     whatever the client sent — unless `keep` holds who it already is (editing
 *     a shipment never reassigns its receiver to the editor);
 *   - not a manager and no employeeNumber: nobody to attribute it to → `error`.
 */
export function resolveShipmentWorker(
  session: Session,
  submitted: ShipmentWorker,
  keep?: ShipmentWorker | null,
): { worker: ShipmentWorker } | { error: string } {
  if (isAdmin(session.roles ?? [])) {
    return { worker: { id: submitted.id || null, name: submitted.name || null } };
  }
  if (keep?.id != null) return { worker: keep };
  const empNo = session.user.employeeNumber ? Number(session.user.employeeNumber) : NaN;
  if (!Number.isFinite(empNo) || empNo <= 0) {
    return { error: "לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו ב'הגדרות > משתמשים'." };
  }
  return {
    worker: { id: empNo, name: session.user.displayName ?? session.user.name ?? session.user.preferredUsername },
  };
}
