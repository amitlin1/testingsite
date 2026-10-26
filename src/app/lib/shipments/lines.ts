import { TransactionClient } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { parseItemQr, sameShipmentNumber } from "@/app/lib/itemQrParser";
import { PackageError } from "@/app/lib/packages/errors";
import { lineDetails } from "@/app/lib/packages/shipment-types";

/**
 * The shipment's declared lines on the server: what the forms send, checked
 * and saved (POST / PUT /api/shipments). The boxes follow the lines
 * (lib/packages/boxes.ts syncShipmentBoxes), each box keeping the line it
 * was minted for — so a line is updated in place, never deleted and
 * inserted again, and a line removed takes only its own pending boxes.
 */

/** The most boxes one shipment may declare: past it a typo is likelier than
 *  a shipment, and minting stays well inside one transaction's time. */
export const MAX_SHIPMENT_BOXES = 2000;

/** Interactive-transaction limits for a shipment save (the default 5s ran
 *  out at about 650 boxes). */
export const SHIPMENT_TX = { maxWait: 5_000, timeout: 30_000 } as const;

export type ShipmentLineInput = {
  /** The saved line this one is (shipment_items.id), or null for a new line. */
  lineId: number | null;
  itemTypeId: number;
  quantity: number;
  details: ReturnType<typeof lineDetails>;
};

/**
 * The lines a shipment form sent, checked; a refusal names the line. Every
 * line needs a package type and a whole quantity of at least 1 (the forms
 * drop only the untouched blank row, never a started one). A certificate row
 * appears once, and a row that carries its certificate's shipment number
 * must carry this shipment's.
 */
export function readShipmentLines(raw: unknown, shipmentCode: string): ShipmentLineInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ShipmentLineInput[] = [];
  const rows = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const l = (list[i] ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const itemTypeId = Number(l.item_type_id);
    if (!Number.isInteger(itemTypeId) || itemTypeId < 1) {
      throw new PackageError("SHIPMENT_LINE_TYPE", `שורה ${n}: חסר סוג מארז`, 400);
    }
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new PackageError("SHIPMENT_LINE_QUANTITY", `שורה ${n}: הכמות חייבת להיות מספר שלם, לפחות 1`, 400);
    }
    const details = lineDetails(l);
    if (details.cert_row_raw) {
      if (rows.has(details.cert_row_raw)) {
        throw new PackageError("SHIPMENT_LINE_TWICE", `שורה ${n}: אותה שורה מהתעודה כבר מופיעה במשלוח`, 400);
      }
      rows.add(details.cert_row_raw);
      const row = parseItemQr(`2^${details.cert_row_raw}`)?.[0];
      if (row?.shipmentNumber && !sameShipmentNumber(row.shipmentNumber, shipmentCode)) {
        throw new PackageError(
          "CERT_ROW_OTHER_SHIPMENT",
          `שורה ${n}: השורה מהתעודה שייכת למשלוח ${row.shipmentNumber}, לא למשלוח ${shipmentCode.trim()}`,
          400,
        );
      }
    }
    const lineId = l.line_id == null || l.line_id === "" ? NaN : Number(l.line_id);
    out.push({ lineId: Number.isInteger(lineId) && lineId > 0 ? lineId : null, itemTypeId, quantity, details });
  }
  const total = out.reduce((sum, l) => sum + l.quantity, 0);
  if (total > MAX_SHIPMENT_BOXES) {
    throw new PackageError("SHIPMENT_TOO_BIG", `משלוח יכול להצהיר על עד ${MAX_SHIPMENT_BOXES} מארזים (הוצהרו ${total})`, 400);
  }
  return out;
}

/**
 * Which saved line each sent line is: its line_id; else the saved line of the
 * same certificate row; else — only from a client that does not send line ids
 * (`byId` false: an older form or script) — the next saved line of the same
 * package type, in order, as edits matched lines before line ids. Null = a
 * new line. The forms say they send ids (line_ids: true): a form whose saved
 * lines were all removed sends no id at all, and its new line is new.
 */
export function matchSavedLines(
  sent: Pick<ShipmentLineInput, "lineId" | "itemTypeId" | "details">[],
  saved: { id: number; item_type_id: number | null; cert_row_raw: string | null }[],
  byId: boolean,
): (number | null)[] {
  const taken = new Set<number>();
  const take = (id: number | undefined) => (id != null && !taken.has(id) ? (taken.add(id), id) : null);
  const out: (number | null)[] = sent.map((l) => (l.lineId != null && saved.some((s) => s.id === l.lineId) ? take(l.lineId) : null));
  sent.forEach((l, i) => {
    if (out[i] == null && l.details.cert_row_raw) {
      out[i] = take(saved.find((s) => !taken.has(s.id) && s.cert_row_raw === l.details.cert_row_raw)?.id);
    }
  });
  if (!byId) {
    sent.forEach((l, i) => {
      if (out[i] == null) out[i] = take(saved.find((s) => !taken.has(s.id) && s.item_type_id === l.itemTypeId)?.id);
    });
  }
  return out;
}

/**
 * Writes the shipment's lines: a sent line that is a saved one
 * (matchSavedLines) is updated in place — its boxes stay its own — a new one
 * is inserted, and a saved line the form left out is removed with its pending
 * boxes, refused while a box of it was taken in. Answers the ids of the boxes
 * removed with their lines. `byId`: the client sends line ids (matchSavedLines).
 */
export async function saveShipmentLines(tx: TransactionClient, shipmentId: number, lines: ShipmentLineInput[], byId = true): Promise<string[]> {
  const saved = await tx.shipment_items.findMany({
    where: { shipment_id: shipmentId },
    select: { id: true, item_type_id: true, cert_row_raw: true },
    orderBy: { id: "asc" },
  });
  const matched = matchSavedLines(lines, saved, byId);
  for (const [i, l] of lines.entries()) {
    const data = { item_type_id: l.itemTypeId, quantity: l.quantity, ...l.details };
    const id = matched[i];
    if (id != null) await tx.shipment_items.update({ where: { id }, data });
    else await tx.shipment_items.create({ data: { shipment_id: shipmentId, ...data } });
  }

  const kept = new Set(matched.filter((id): id is number => id != null));
  const gone = saved.map((s) => s.id).filter((id) => !kept.has(id));
  if (gone.length === 0) return [];
  // Lock, then read fresh: an intake of one of these boxes that got there
  // first is seen as taken in.
  await tx.$queryRaw`SELECT item_id FROM items WHERE shipment_item_id = ANY(${gone}::int[]) FOR UPDATE`;
  const boxes = await tx.$queryRaw<{ item_id: bigint; routed: boolean; item_type_desc: string }[]>`
    SELECT i.item_id, (ir.item_id IS NOT NULL) AS routed, TRIM(t.item_type_desc) AS item_type_desc
    FROM items i
    JOIN item_types t ON t.item_type_id = i.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    WHERE i.shipment_item_id = ANY(${gone}::int[]) AND i.package_id IS NULL
  `;
  const taken = boxes.find((b) => b.routed);
  if (taken) {
    throw new PackageError("SHIPMENT_LINE_TAKEN_IN", `אי אפשר להסיר את השורה של ${taken.item_type_desc}: כבר נקלטו ממנה מארזים`, 409);
  }
  if (boxes.length > 0) await tx.items.deleteMany({ where: { item_id: { in: boxes.map((b) => b.item_id) } } });
  await tx.shipment_items.deleteMany({ where: { id: { in: gone } } });
  return boxes.map((b) => String(b.item_id));
}

/** The shipment a duplicate repeats, as the forms show it (ShipmentDuplicateDialog). */
export type DuplicateShipment = {
  id: number;
  shipment_code: string;
  customer_code: string | null;
  shipment_date: string | null;
  received_at: string | null;
  amount: number;
};

/**
 * The shipment already in the system with this certificate — the same
 * number (trimmed, case-blind) and the same customer — other than `exceptId`.
 * A transaction-scoped advisory lock on the pair comes first, so two saves
 * of one certificate at the same moment cannot both pass the check.
 */
export async function findDuplicateShipment(
  tx: TransactionClient,
  shipmentCode: string,
  customerId: number,
  exceptId: number | null = null,
): Promise<DuplicateShipment | null> {
  const code = shipmentCode.trim().toUpperCase();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shipment:${code}:${customerId}`}))`;
  const rows = await tx.$queryRaw<{ id: number; shipment_code: string; customer_code: string | null; shipment_date: Date | null; received_at: Date | null; amount: number }[]>`
    SELECT s.id, TRIM(s.shipment_code) AS shipment_code, TRIM(c.customer_code) AS customer_code,
           s.shipment_date, s.received_at, s.amount
    FROM shipments s
    JOIN customers c ON c.id = s.customer_id
    WHERE UPPER(TRIM(s.shipment_code)) = ${code} AND s.customer_id = ${customerId} AND s.id <> ${exceptId ?? -1}
    ORDER BY s.id DESC
    LIMIT 1
  `;
  const d = rows[0];
  return d
    ? { ...d, shipment_date: normalizeToUtcIso(d.shipment_date), received_at: d.received_at ? d.received_at.toISOString() : null }
    : null;
}

/** The refusal of a save that repeats a certificate; the form offers to enter it anyway (allow_duplicate). */
export function duplicateShipmentError(d: DuplicateShipment): PackageError {
  return new PackageError(
    "SHIPMENT_DUPLICATE",
    `משלוח ${d.shipment_code} של לקוח ${d.customer_code ?? ""} כבר קיים במערכת`,
    409,
    undefined,
    { existing: d },
  );
}
