/**
 * Who may delete a shipment, client-safe — the rule DELETE /api/shipments/[id]
 * applies, said on the row before anyone tries:
 *   - a sent shipment is never deleted;
 *   - one whose boxes were taken in only by a manager (ACCESS.deleteTakenInShipment),
 *     who is warned first that those boxes, their items and their tests go with it;
 *   - any other one by anyone on the shipments screen.
 */

export type ShipmentDeleteRule =
  | { kind: "blocked"; reason: string }
  | { kind: "plain" }
  /** Allowed, with the boxes already taken in (`takenIn`) going too. */
  | { kind: "withTakenIn"; takenIn: number };

export function shipmentDeleteRule(
  s: { is_sent?: boolean | null; sampled_amount?: number | null },
  canDeleteTakenIn: boolean,
): ShipmentDeleteRule {
  if (s.is_sent) return { kind: "blocked", reason: "לא ניתן למחוק משלוח שנשלח" };
  const takenIn = s.sampled_amount || 0;
  if (takenIn === 0) return { kind: "plain" };
  if (!canDeleteTakenIn) return { kind: "blocked", reason: "לא ניתן למחוק משלוח שנקלטו בו מארזים" };
  return { kind: "withTakenIn", takenIn };
}
