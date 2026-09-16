"use client";
import React from "react";
import { HAIR, INK, INK_2, MUTED, BLUE, RED, SHADOW, seq2 } from "@/app/components/packages/packageUi";

/**
 * פריט שלא הגיע לסגירה — design/Package Stations.dc.html (decide). Two
 * choices and a mandatory note; the decision is recorded on the box's closing
 * result (docs/packages/PLAN.md §4, decision 5).
 */
export type PackDecision = "packed_anyway" | "missing";

export default function PackageDecisionDialog({
  open, item, onClose, onSave,
}: {
  open: boolean;
  item: { package_seq: number | null; item_type_desc: string; station_name: string | null } | null;
  onClose: () => void;
  onSave: (decision: PackDecision, note: string) => void;
}) {
  const [choice, setChoice] = React.useState<PackDecision | null>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (open) { setChoice(null); setNote(""); } }, [open, item]);
  if (!open || !item) return null;

  const choices: { key: PackDecision; label: string; note: string; tone: string }[] = [
    { key: "packed_anyway", label: "נארז בכל זאת", note: "הפריט הובא לעמדה ידנית ונארז בקופסה.", tone: BLUE },
    { key: "missing", label: "חסר במארז", note: "המארז נסגר בלי הפריט. החוסר יירשם על המארז ועל הפריט.", tone: RED },
  ];
  const can = choice != null && note.trim() !== "";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(520px, 94vw)", background: "#fff", borderRadius: 18, boxShadow: SHADOW, overflow: "hidden", color: INK }}>
        <div style={{ padding: "22px 24px 0" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>פריט שלא הגיע לסגירה</div>
          <div style={{ fontSize: 14, color: INK_2, marginTop: 9, lineHeight: 1.55 }}>
            פריט {seq2(item.package_seq)} · {item.item_type_desc} סיים את המסלול {item.station_name ? `בעמדת ${item.station_name}` : "במקום אחר"} ולא הגיע לעמדת הסגירה. בחר מה נעשה איתו.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "18px 24px 0" }}>
          {choices.map((c) => {
            const on = choice === c.key;
            return (
              <div key={c.key} onClick={() => setChoice(c.key)} style={{ display: "flex", alignItems: "flex-start", gap: 12, border: `1px solid ${on ? c.tone : HAIR}`, background: on ? (c.key === "missing" ? "rgba(191,53,53,0.06)" : "#e6efff") : "#fff", borderRadius: 12, padding: "12px 14px", cursor: "pointer" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1px solid ${on ? c.tone : "#d4d4dc"}`, background: "#fff", marginTop: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {on && <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.tone }} />}
                </span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: on ? c.tone : INK }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>{c.note}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ margin: "16px 24px 0" }}>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>הערה · חובה</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה קרה לפריט?" style={{ width: "100%", minHeight: 76, border: `1px solid ${HAIR}`, borderRadius: 11, padding: "11px 13px", fontSize: 14, resize: "vertical", outline: "none", fontFamily: "inherit" }} />
        </div>
        <div style={{ padding: "18px 24px 22px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ minHeight: 44, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: INK }}>ביטול</button>
          <button type="button" disabled={!can} onClick={() => choice && onSave(choice, note.trim())} style={{ minHeight: 44, background: can ? BLUE : HAIR, color: can ? "#fff" : "#9a9aa0", border: 0, borderRadius: 9999, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: can ? "pointer" : "not-allowed", fontFamily: "inherit" }}>שמור החלטה</button>
        </div>
      </div>
    </div>
  );
}
