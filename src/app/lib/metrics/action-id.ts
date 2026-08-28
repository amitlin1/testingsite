// Client-side action identity for the metrics ledger (migration plan §4.4).
// One UUID per human action (a click, a wizard finish). The ledger's event_key
// embeds it ({reason}:{submit_id}:{item_id}:{seq} / test_started:{action_uuid}),
// so resending the SAME id on a retry of the same action makes metrics_record
// treat the second write as a replay instead of a duplicate event. Event TIME is
// never the client's business — the DB assigns occurred_at (§4.2).
export function newActionId(): string {
  // crypto.randomUUID needs a secure context; the lab serves the app over plain
  // http on the LAN, so fall back to a v4 built from getRandomValues.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
