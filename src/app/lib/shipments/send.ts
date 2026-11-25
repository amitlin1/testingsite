/**
 * Returning a shipment, client-safe: how much of each declared line already
 * went out and how much may still go. A send names a package type and a makat
 * (shipment_history has no line id), so a line is matched by both — two lines
 * of one type and makat share one sent total, and the first of them is the
 * one a send is checked against.
 */

/** A declared line of the shipment, as the shipments list carries it. */
export type DeclaredLine = { item_type_id: number; makat?: string | null; quantity: number; item_type_desc?: string };

/** What went out for one type and makat: one send, or the total of several. */
export type SentRow = { item_type_id: number | null; makat: string | null; amount: number };

/** A blank makat and none are the same makat. */
const sameMakat = (a: string | null | undefined, b: string | null | undefined) => (a || null) === (b || null);

const isFor = (typeId: number | null, makat: string | null | undefined) =>
  (r: { item_type_id: number | null; makat?: string | null }) => r.item_type_id === typeId && sameMakat(r.makat, makat);

/** The declared line a send of this type and makat is counted against. */
export function declaredLineOf<L extends DeclaredLine>(lines: L[], typeId: number | null, makat: string | null | undefined): L | undefined {
  return lines.find(isFor(typeId, makat));
}

/** The boxes of this type and makat that already went out. */
export function sentOf(sent: SentRow[], typeId: number | null, makat: string | null | undefined): number {
  return sent.filter(isFor(typeId, makat)).reduce((n, r) => n + r.amount, 0);
}

/** The most boxes of this type and makat one more send may take. */
export function maxToSend(lines: DeclaredLine[], sent: SentRow[], typeId: number | null, makat: string | null | undefined): number {
  const declared = declaredLineOf(lines, typeId, makat)?.quantity ?? 0;
  return Math.max(0, declared - sentOf(sent, typeId, makat));
}

/** Each declared line with what went out of its type and makat. */
export function sendProgress(lines: DeclaredLine[], sent: SentRow[]) {
  return lines.map((l) => ({ desc: l.item_type_desc, makat: l.makat, sent: sentOf(sent, l.item_type_id, l.makat), received: l.quantity }));
}
