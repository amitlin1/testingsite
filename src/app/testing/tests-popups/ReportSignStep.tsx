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
  // The zoom stays as set when another item is shown; the scale is what the viewer shows with it.
  const [zoom, setZoom] = React.useState<Zoom>({ mode: "width" });
  const [scale, setScale] = React.useState<number | null>(null);
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
    // .pkg-report-sign (packages.css) makes the wizard body a column, so the report takes the free height.
    <div className="pkg-report-sign" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        {items.length > 1 ? (
          <div role="group" aria-label="הדוחות" style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            {items.map((it) => {
              const on = it.item_id === shown.item_id;
              return (
                <button key={it.item_id} type="button" aria-pressed={on} onClick={() => setViewId(it.item_id)} className="pkg-press"
                  style={{ textAlign: "start", border: `1px solid ${on ? BLUE : HAIR}`, background: on ? "var(--color-primary-soft)" : "var(--color-canvas)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? BLUE : INK, whiteSpace: "nowrap" }}>{it.badge} · {it.label}</span>
                  <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>{it.serial ?? "ללא סריאלי"}</span>
                </button>
              );
            })}
          </div>
        ) : <span />}
        <ZoomBar zoom={zoom} shownScale={scale} onZoom={setZoom} />
      </div>
      <ReportViewer title={`${T.preview} · ${shown.badge} · ${shown.label}`} html={html} zoom={zoom} onScale={setScale} />
      <div style={{ fontSize: 12, color: MUTED, marginTop: -4 }}>{T.previewNote}</div>
      <ShipmentSignatureField canvasRef={canvasRef} signed={signed} onSignedChange={onSignedChange} hint={T.needsSignature} height={92} />
    </div>
  );
}

/* ---- the report preview: fitted to the frame, zoomable -------------------------------------- */

/** A4 at 96dpi — the width the report is laid out for (render.ts renders the PDF at it). */
const A4_W = 794;
const A4_H = 1123;
/** Room for the frame's own scrollbar inside the iframe, so the report keeps its A4 width beside it. */
const SCROLLBAR = 18;
const GAP = 12;
const Z_MIN = 0.3;
const Z_MAX = 1.6;

/** "width" fits the page's width to the frame (the default), "page" a whole A4 page, "free" a set scale. */
type Zoom = { mode: "width" } | { mode: "page" } | { mode: "free"; scale: number };

/** On screen the print HTML has no page margins (those live in @page), so the preview gets them —
 *  the report wraps at the same width as in the PDF — and a fixed A4 width. */
// The body is exactly A4 wide, so the iframe never needs a horizontal scrollbar: only the vertical
// one, which SCROLLBAR leaves room for.
const SCREEN_CSS = `<style>@media screen{html{overflow-x:hidden;}body{width:${A4_W}px;box-sizing:border-box;padding:14mm 16mm;}}</style>`;
function previewDoc(html: string): string {
  return html.includes("</head>") ? html.replace("</head>", `${SCREEN_CSS}</head>`) : SCREEN_CSS + html;
}

function scaleFor(zoom: Zoom, box: { w: number; h: number }): number {
  if (zoom.mode === "free") return zoom.scale;
  const s = zoom.mode === "width" ? (box.w - GAP * 2) / (A4_W + SCROLLBAR) : (box.h - GAP * 2) / A4_H;
  // Floored: a fitted sheet a fraction of a pixel wider than the frame would overflow it.
  return Math.min(Z_MAX, Math.max(Z_MIN / 2, Math.floor(s * 1000) / 1000));
}

function ZoomBar({ zoom, shownScale, onZoom }: { zoom: Zoom; shownScale: number | null; onZoom: (z: Zoom) => void }) {
  const step = (d: number) => {
    const from = shownScale ?? 1;
    onZoom({ mode: "free", scale: Math.min(Z_MAX, Math.max(Z_MIN, Math.round((from + d) * 10) / 10)) });
  };
  const btn = (on: boolean): React.CSSProperties => ({
    border: 0, borderRadius: 7, padding: "5px 9px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    background: on ? "var(--color-primary-soft)" : "transparent", color: on ? BLUE : INK,
  });
  return (
    <div role="toolbar" aria-label="גודל התצוגה" style={{ display: "flex", alignItems: "center", gap: 2, border: `1px solid ${HAIR}`, borderRadius: 10, padding: 3, background: "var(--color-canvas)" }}>
      <button type="button" aria-pressed={zoom.mode === "width"} onClick={() => onZoom({ mode: "width" })} style={btn(zoom.mode === "width")}>התאם לרוחב</button>
      <button type="button" aria-pressed={zoom.mode === "page"} onClick={() => onZoom({ mode: "page" })} style={btn(zoom.mode === "page")}>עמוד שלם</button>
      <span aria-hidden style={{ width: 1, height: 18, background: HAIR, margin: "0 2px" }} />
      <button type="button" aria-label="הקטן" onClick={() => step(-0.1)} disabled={shownScale != null && shownScale <= Z_MIN} style={btn(false)}>−</button>
      <span aria-live="polite" style={{ minWidth: 42, textAlign: "center", fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
        {shownScale == null ? "" : `${Math.round(shownScale * 100)}%`}
      </span>
      <button type="button" aria-label="הגדל" onClick={() => step(0.1)} disabled={shownScale != null && shownScale >= Z_MAX} style={btn(false)}>+</button>
    </div>
  );
}

/**
 * The report in a frame that takes the free height. The iframe stays sandboxed (nothing in it runs
 * and nothing outside reads it), so it is scaled from outside: laid out at A4 width and shrunk with a
 * transform, its own scrollbar scrolling the report. A zoom only changes the transform — the report
 * is not reloaded and keeps its scroll; another item reloads it from the top.
 */
function ReportViewer({ title, html, zoom, onScale }: { title: string; html: string | null | "failed"; zoom: Zoom; onScale: (s: number | null) => void }) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const doc = React.useMemo(() => (html && html !== "failed" ? previewDoc(html) : null), [html]);
  const s = box && box.w > 0 && box.h > 0 ? scaleFor(zoom, box) : null;
  React.useEffect(() => { onScale(s); }, [s, onScale]);

  const sheetW = s ? (A4_W + SCROLLBAR) * s : 0;
  const sheetH = box ? box.h - GAP * 2 : 0;
  // A fitted sheet always fits, so the frame has no scrollbars: a scrollbar that appears takes width
  // or height, which refits the sheet, which hides the scrollbar again — the frame flickered. Only a
  // zoom the reader set can be larger than the frame, and only then does it scroll.
  const scrolls = zoom.mode === "free";
  return (
    <div ref={frameRef} style={{ flex: 1, minHeight: 260, position: "relative", overflow: scrolls ? "auto" : "hidden", border: `1px solid ${HAIR}`, borderRadius: 10, background: "var(--color-canvas-parchment)" }}>
      {!doc || !s || !box ? (
        <div style={{ padding: 14, fontSize: 13, color: MUTED }}>{html === "failed" ? T_FAILED : T_LOADING}</div>
      ) : (
        // Absolute, so the sheet never feeds the frame's own height back (the frame measures itself).
        <div style={{ position: "absolute", top: 0, insetInlineStart: 0, width: Math.max(box.w, sheetW + GAP * 2), height: box.h, display: "flex", justifyContent: "center", padding: GAP, boxSizing: "border-box" }}>
          <div style={{ position: "relative", width: sheetW, height: sheetH, flexShrink: 0, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.12)" }}>
            <iframe title={title} srcDoc={doc} sandbox=""
              style={{ position: "absolute", top: 0, left: 0, width: A4_W + SCROLLBAR, height: sheetH / s, border: 0, background: "#fff", transform: `scale(${s})`, transformOrigin: "top left" }} />
          </div>
        </div>
      )}
    </div>
  );
}

const T_LOADING = REPORT_SIGN_TEXT.previewLoading;
const T_FAILED = REPORT_SIGN_TEXT.previewFailed;
