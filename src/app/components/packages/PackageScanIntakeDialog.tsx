"use client";
import React from "react";
import { Check, CircleAlert, ScanLine, Undo2, Volume2, VolumeX } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { PackageView } from "@/app/lib/packages/read";
import { typeAsUsKeyboard } from "@/app/lib/scannerKeys";
import { PackageDialog, PackageDialogHeader } from "./PackageDialog";
import { playCue, setSoundOn, soundOn, subscribeSound } from "./scanSound";
import { GREEN, GREEN_BG, HAIR, HAIR_2, INK_2, MUTED, RED, RED_BG, fmtId } from "./packageUi";

/**
 * קליטת מארזים — the box labels printed with the shipment are scanned here,
 * one after another; each scan puts that box into its route with its items
 * from the template (POST /api/packages/intake). Serials are not typed here:
 * the opening station records them when the box is opened. A box scanned by
 * mistake is taken back with "בטל" while nobody has worked on it.
 */

type Outcome = { tone: "ok" | "error"; text: string };

const BOX_ID = /^\d{16}(-\d+)?$/;

export default function PackageScanIntakeDialog({
  open, onClose, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** A box was taken in or taken back — the page behind refreshes. */
  onChanged?: () => void;
}) {
  const [scan, setScan] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  // This session's boxes, newest first.
  const [taken, setTaken] = React.useState<PackageView[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sound = React.useSyncExternalStore(subscribeSound, soundOn, () => true);

  if (!open) return null;

  const fail = (text: string) => { setOutcome({ tone: "error", text }); playCue("error"); };

  const submit = async () => {
    const value = scan.trim();
    if (!value || busy) return;
    setScan("");
    if (!BOX_ID.test(value)) {
      fail(/^\d+(-\d+)?$/.test(value)
        ? `${value} אינו מזהה של מארז (16 ספרות). אם זו מדבקת משלוח — הדפס את מדבקות המארזים מעמוד המשלוחים.`
        : `"${value}" אינו ברקוד של מדבקת מארז.`);
      return;
    }
    if (!value.split("-")[0].endsWith("00")) { fail("זו מדבקה של פריט בתוך מארז — סרוק את מדבקת הקופסה (המזהה מסתיים ב-00)."); return; }
    setBusy(true);
    try {
      const res = await apiFetch("/api/packages/intake", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barcode: value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { fail(d?.error || "קליטת המארז נכשלה"); return; }
      const pkg: PackageView = d.package;
      setTaken((t) => [pkg, ...t]);
      setOutcome({ tone: "ok", text: `${pkg.item_type_desc} נקלט · ${pkg.items.length} פריטים · משלוח ${pkg.shipment_code ?? ""} — ממתין בעמדת הפתיחה` });
      playCue("ok");
      onChanged?.();
    } catch {
      fail("שגיאה בתקשורת");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const undo = async (pkg: PackageView) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/packages/${pkg.item_id}/intake`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { fail(d?.error || "ביטול הקליטה נכשל"); return; }
      setTaken((t) => t.filter((p) => p.item_id !== pkg.item_id));
      setOutcome({ tone: "ok", text: `הקליטה של ${pkg.item_type_desc} בוטלה — המארז ממתין לקליטה, אפשר לסרוק אותו שוב` });
      onChanged?.();
    } catch {
      fail("שגיאה בתקשורת");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const close = () => { setScan(""); setOutcome(null); setTaken([]); onClose(); };

  return (
    <PackageDialog open onClose={close} width="min(760px, calc(100vw - 32px))" maxHeight="88vh">
      <PackageDialogHeader
        title="קליטת מארזים"
        onClose={close}
        subtitle={<div style={{ fontSize: 13.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>סרוק את מדבקת המארז שהודפסה מהמשלוח. המארז נכנס למסלול וממתין בעמדת הפתיחה — שם מזינים את הסריאליים. אפשר לסרוק כמה מארזים ברצף.</div>}
      />
      <div className="pkg-dlg-body">
        <div style={{ position: "relative", maxWidth: 520 }}>
          {/* Physical right: the field is LTR (a code) inside the RTL page, and its text sits on the right edge. */}
          <span aria-hidden style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: MUTED, display: "inline-flex" }}><ScanLine size={20} strokeWidth={1.75} /></span>
          <input
            ref={inputRef}
            autoFocus
            dir="ltr"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void submit(); return; }
              typeAsUsKeyboard(e);
            }}
            placeholder="סרוק מדבקת מארז"
            aria-label="מדבקת מארז"
            aria-busy={busy || undefined}
            className="pkg-field pkg-field--lg pkg-field--code"
            style={{ paddingRight: 44 }}
          />
        </div>

        {outcome && (
          <div role={outcome.tone === "error" ? "alert" : "status"} style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start", maxWidth: 640, background: outcome.tone === "ok" ? GREEN_BG : RED_BG, border: `1px solid ${outcome.tone === "ok" ? "color-mix(in srgb, var(--color-status-approved) 22%, transparent)" : "color-mix(in srgb, var(--color-destructive) 25%, transparent)"}`, borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ color: outcome.tone === "ok" ? GREEN : RED, marginTop: 1, display: "inline-flex" }}>
              {outcome.tone === "ok" ? <Check size={16} strokeWidth={2.25} aria-hidden /> : <CircleAlert size={16} strokeWidth={2} aria-hidden />}
            </span>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: outcome.tone === "ok" ? GREEN : RED, lineHeight: 1.5 }}>{outcome.text}</div>
          </div>
        )}

        <div style={{ marginTop: 22, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>נקלטו עכשיו</div>
          <div style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{taken.length === 1 ? "מארז אחד" : `${taken.length} מארזים`}</div>
        </div>
        {taken.length === 0 ? (
          <div style={{ marginTop: 8, border: `1px dashed ${HAIR}`, borderRadius: 12, padding: "18px 16px", fontSize: 13.5, color: MUTED, textAlign: "center" }}>
            עוד לא נסרק מארז.
          </div>
        ) : (
          <div style={{ marginTop: 8, border: `1px solid ${HAIR}`, borderRadius: 12, overflow: "hidden" }}>
            {taken.map((p, i) => {
              const { head, suffix } = fmtId(p.item_id);
              return (
                <div key={p.item_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i > 0 ? `1px solid ${HAIR_2}` : undefined, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.item_type_desc}</div>
                    <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span dir="ltr" style={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}>{head} <b style={{ color: INK_2 }}>{suffix}</b></span>
                      <span>משלוח {p.shipment_code ?? "—"}</span>
                      <span>{p.items.length} פריטים</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => undo(p)} disabled={busy} className="pkg-link pkg-link--hit" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}
                    aria-label={`בטל את הקליטה · ${p.item_type_desc} ${head} ${suffix}`}>
                    <Undo2 size={14} strokeWidth={2} aria-hidden />בטל
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="pkg-dlg-foot">
        {/* Taken in chimes, refused buzzes — for scanning without watching the screen. */}
        <button type="button" onClick={() => setSoundOn(!sound)} aria-pressed={sound} aria-label="צלילי קליטה ושגיאה"
          title={sound ? "צלילים פועלים — לחץ להשתקה" : "צלילים מושתקים — לחץ להפעלה"} className="pkg-iconbtn pkg-iconbtn--ink">
          {sound ? <Volume2 size={16} strokeWidth={1.75} aria-hidden /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden />}
        </button>
        <div style={{ fontSize: 12.5, color: MUTED }}>הסריאליים נרשמים בעמדת הפתיחה</div>
        <div className="pkg-dlg-foot-actions">
          <button type="button" onClick={close} disabled={busy} className="pkg-pill pkg-pill--primary" style={{ paddingInline: 22 }}>סיום</button>
        </div>
      </div>
    </PackageDialog>
  );
}
