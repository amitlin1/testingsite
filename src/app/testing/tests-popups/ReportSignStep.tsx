"use client";
import React from "react";
import type SignatureCanvas from "react-signature-canvas";
import ShipmentSignatureField from "@/app/components/shipments/ShipmentSignatureField";
import { apiFetch } from "@/lib/api/client";
import { AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, HAIR, INK, MUTED } from "@/app/components/packages/packageUi";

/**
 * "חתימה על הדוחות" — a closing template's last step (popup-templates schema `report_sign`,
 * docs/ITEM_REPORTS.md), the one its finish button ("סגור מארז") sits on: the reports of the items
 * that finish their route at this closing and ask for the closing signature, each on screen, and
 * one signature for all of them. The signature travels with each item's closing result
 * (POST /api/testing/results `ReportSignature`), and the server records it in that same request —
 * so the box is never closed with its reports unsigned. It does not lock the reports: the
 * approver's final signature, on the item page, does. The signer is the signed-in user, and only
 * REPORT_CLOSING_SIGN_ROLES may sign.
 */

export type SignItem = { item_id: string; badge: string; label: string; serial: string | null };

export const REPORT_SIGN_TEXT = {
  subtitle: "עברו על הדוחות של הפריטים וחתמו פעם אחת. החתימה נשמרת בכל הדוחות יחד עם סגירת המארז.",
  loading: "טוען את הדוחות…",
  loadFailed: "טעינת הדוחות נכשלה. בלי הדוחות אי אפשר לסגור את המארז — נסה שוב.",
  retry: "נסה שוב",
  needsSignature: "יש לחתום לפני סגירת המארז",
  nothingToSign: "לאף פריט במארז אין דוח שמחכה לחתימה בסגירה. אפשר לסגור את המארז.",
  cannotSign: "רק בודק או מנהל יכולים לחתום על הדוחות ולסגור את המארז",
  cannotSignBody: "הדוחות של הפריטים במארז צריכים חתימה של בודק או מנהל בסגירה, ובלי החתימה המארז לא נסגר. בקש מבודק או ממנהל לסגור את המארז.",
  preview: "תצוגת הדוח",
  previewNote: "הדוח מוצג כמו שהוא עכשיו. שורת סגירת המארז תתווסף אליו בשמירה.",
  previewLoading: "טוען את הדוח…",
  previewFailed: "לא הצלחנו להציג את הדוח.",
  doneSigned: (n: number) => (n === 1 ? "החתימה נשמרה בדוח" : `החתימה נשמרה ב-${n} דוחות`),
  doneAwaitingFinal: (n: number) => (n === 1 ? "הדוח ממתין לחתימה הסופית של מנהל" : `${n} דוחות ממתינים לחתימה הסופית של מנהל`),
  doneWaiting: (n: number) => (n === 1 ? "דוח אחד ממתין לחתימה של מנהל או בודק" : `${n} דוחות ממתינים לחתימה של מנהל או בודק`),
  doneFailed: (labels: string) => `החתימה לא נשמרה בדוח של ${labels}. המקום שלה בדוח יישאר ריק.`,
} as const;

type StatusJson = { state: string; needsClosingSignature: boolean; closingSignedBy: string | null; canSignClosing: boolean; needsSignature: boolean };

/** Of the items about to finish at this closing, the reports this user signs with it, how many wait
 *  for someone else who may sign, and which of this user's will still wait for the final signature
 *  afterwards. Throws when a status does not load — a required signature is never skipped
 *  silently. */
export async function reportsToSign(ids: readonly string[]): Promise<{ mine: string[]; othersOnly: number; awaitFinal: string[] }> {
  const statuses = await Promise.all(ids.map(async (id) => {
    const res = await apiFetch(`/api/item-reports/${id}/status`);
    if (!res.ok) throw new Error(String(res.status));
    return { id, s: (await res.json()) as StatusJson };
  }));
  const waiting = statuses.filter((x) => x.s.needsClosingSignature && x.s.state !== "final" && !x.s.closingSignedBy);
  const mine = waiting.filter((x) => x.s.canSignClosing);
  return {
    mine: mine.map((x) => x.id),
    othersOnly: waiting.filter((x) => !x.s.canSignClosing).length,
    awaitFinal: mine.filter((x) => x.s.needsSignature).map((x) => x.id),
  };
}

/** The live HTML of each report (the item page's signing preview), loaded once per item shown. */
function useReportHtml(id: string | null): string | null | "failed" {
  const [cache, setCache] = React.useState<Record<string, string | "failed">>({});
  React.useEffect(() => {
    if (!id || cache[id]) return;
    let alive = true;
    apiFetch(`/api/item-reports/${id}?html=1`)
      .then((r) => (r.ok && r.status !== 204 ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { if (alive) setCache((c) => ({ ...c, [id]: t })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [id]: "failed" })); });
    return () => { alive = false; };
  }, [id, cache]);
  return id ? cache[id] ?? null : null;
}

export function ReportSignStep({
  items, loadError, onRetry, cannotSign, canvasRef, signed, onSignedChange,
}: {
  /** null while the reports to sign load. */
  items: SignItem[] | null;
  loadError: boolean;
  onRetry: () => void;
  /** Reports wait for a closing signature this user may not give (not REPORT_CLOSING_SIGN_ROLES): the box stays open. */
  cannotSign: boolean;
  canvasRef: React.RefObject<SignatureCanvas | null>;
  signed: boolean;
  onSignedChange: (signed: boolean) => void;
}) {
  const [viewId, setViewId] = React.useState<string | null>(null);
  const shown = items?.find((it) => it.item_id === viewId) ?? items?.[0] ?? null;
  const html = useReportHtml(shown?.item_id ?? null);
  const T = REPORT_SIGN_TEXT;

  if (loadError) {
    return (
      <div role="alert" style={{ marginTop: 20, fontSize: 14, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 220 }}>{T.loadFailed}</span>
        <button type="button" onClick={onRetry} className="pkg-pill pkg-pill--ghost pkg-pill--station">{T.retry}</button>
      </div>
    );
  }
  if (!items) return <div role="status" style={{ marginTop: 20, fontSize: 14, color: MUTED }}>{T.loading}</div>;
  if (cannotSign) {
    return (
      <div role="alert" style={{ marginTop: 20, fontSize: 14, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "12px 14px" }}>
        {T.cannotSignBody}
      </div>
    );
  }
  if (!shown) return <div role="status" style={{ marginTop: 20, fontSize: 14, color: MUTED }}>{T.nothingToSign}</div>;

  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
        {items.length > 1 && (
          <div role="group" aria-label="הדוחות" style={{ display: "flex", flexDirection: "column", gap: 6, width: 190, flexShrink: 0 }}>
            {items.map((it) => {
              const on = it.item_id === shown.item_id;
              return (
                <button key={it.item_id} type="button" aria-pressed={on} onClick={() => setViewId(it.item_id)} className="pkg-press"
                  style={{ textAlign: "start", border: `1px solid ${on ? BLUE : HAIR}`, background: on ? "var(--color-primary-soft)" : "var(--color-canvas)", borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? BLUE : INK }}>{it.badge} · {it.label}</span>
                  <span style={{ fontSize: 11.5, color: MUTED }}>{it.serial ?? "ללא סריאלי"}</span>
                </button>
              );
            })}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ height: 300, border: `1px solid ${HAIR}`, borderRadius: 10, overflow: "hidden", background: "var(--color-canvas-parchment)" }}>
            {html && html !== "failed" ? (
              <iframe title={`${T.preview} · ${shown.badge} · ${shown.label}`} srcDoc={html} sandbox="" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />
            ) : (
              <div style={{ padding: 14, fontSize: 13, color: MUTED }}>{html === "failed" ? T.previewFailed : T.previewLoading}</div>
            )}
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>{T.previewNote}</div>
        </div>
      </div>
      <ShipmentSignatureField canvasRef={canvasRef} signed={signed} onSignedChange={onSignedChange} hint={T.needsSignature} />
    </div>
  );
}
