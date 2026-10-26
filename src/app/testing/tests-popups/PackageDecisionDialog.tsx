"use client";
import React from "react";
import { DialogTitle } from "@/components/ui";
import { PackageDialog } from "@/app/components/packages/PackageDialog";
import { INK, INK_2, MUTED, BLUE, RED, seq2 } from "@/app/components/packages/packageUi";
import "@/app/packages/packages.css";

/**
 * פריט שלא הגיע לסגירה — design/Package Stations.dc.html (decide). Two
 * choices and a mandatory note; the decision is recorded on the box's closing
 * result (docs/packages/PLAN.md §4, decision 5).
 *
 * Opens over the closing wizard (mounted after it, so it stacks above);
 * Escape closes this dialog only. The choices are a radio group: Tab reaches
 * the chosen one (or the first), the arrow keys move and choose.
 */
export type PackDecision = "packed_anyway" | "missing";

export default function PackageDecisionDialog({
  open, item, onClose, onSave,
}: {
  open: boolean;
  item: { item_id: string; package_seq: number | null; item_type_desc: string; station_name: string | null } | null;
  onClose: () => void;
  onSave: (decision: PackDecision, note: string) => void;
}) {
  const [choice, setChoice] = React.useState<PackDecision | null>(null);
  const [note, setNote] = React.useState("");
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const noteId = React.useId();
  const groupLabelId = React.useId();
  // Reset only when the dialog opens for a DIFFERENT item. The testing page
  // re-renders every second (its elapsed-time clocks), which hands this dialog
  // a fresh `item` object each time — keying on the object wiped the worker's
  // choice and note mid-typing.
  // Done during render, so the previous item's choice is never painted.
  const itemId = item?.item_id ?? null;
  const [resetFor, setResetFor] = React.useState({ open, itemId });
  if (resetFor.open !== open || resetFor.itemId !== itemId) {
    setResetFor({ open, itemId });
    if (open) { setChoice(null); setNote(""); }
  }
  if (!open || !item) return null;

  const choices: { key: PackDecision; label: string; note: string; tone: string }[] = [
    { key: "packed_anyway", label: "נארז בכל זאת", note: "הפריט הובא לעמדה ידנית ונארז בקופסה.", tone: BLUE },
    { key: "missing", label: "חסר במארז", note: "המארז נסגר בלי הפריט. החוסר יירשם על המארז ועל הפריט.", tone: RED },
  ];
  const can = choice != null && note.trim() !== "";
  const focusIdx = Math.max(0, choices.findIndex((c) => c.key === choice));
  // Radio keys: arrows move to the next / previous option and choose it.
  const onRadioKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowLeft" ? 1 : e.key === "ArrowUp" || e.key === "ArrowRight" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + choices.length) % choices.length;
    setChoice(choices[next].key);
    optionRefs.current[next]?.focus();
  };

  return (
    <PackageDialog open onClose={onClose} width="min(520px, 94vw)">
      <div style={{ padding: "22px 24px 0" }}>
        <DialogTitle style={{ padding: 0, display: "block" }}>פריט שלא הגיע לסגירה</DialogTitle>
        <div style={{ fontSize: 14, color: INK_2, marginTop: 9, lineHeight: 1.55 }}>
          פריט {seq2(item.package_seq)} · {item.item_type_desc} סיים את המסלול {item.station_name ? `בעמדת ${item.station_name}` : "במקום אחר"} ולא הגיע לעמדת הסגירה. <span id={groupLabelId}>בחר מה נעשה איתו.</span>
        </div>
      </div>
      <div role="radiogroup" aria-labelledby={groupLabelId} style={{ display: "flex", flexDirection: "column", gap: 9, margin: "18px 24px 0" }}>
        {choices.map((c, i) => {
          const on = choice === c.key;
          return (
            <button key={c.key} ref={(el) => { optionRefs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={i === focusIdx ? 0 : -1}
              onClick={() => setChoice(c.key)} onKeyDown={(e) => onRadioKey(e, i)}
              className="pkg-choice pkg-press"
              style={{ display: "flex", alignItems: "flex-start", gap: 12, borderRadius: 12, padding: "12px 14px", ...(on ? { borderColor: c.tone, background: c.key === "missing" ? "var(--color-danger-bg)" : "var(--color-primary-soft)" } : null) }}>
              <span aria-hidden style={{ width: 18, height: 18, borderRadius: "50%", border: `1px solid ${on ? c.tone : "var(--color-field-border)"}`, background: "var(--color-canvas)", marginTop: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {on && <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.tone }} />}
              </span>
              <span>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: on ? c.tone : INK }}>{c.label}</span>
                <span style={{ display: "block", fontSize: 12.5, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>{c.note}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ margin: "16px 24px 0" }}>
        <label htmlFor={noteId} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>הערה · חובה</label>
        <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה קרה לפריט?" required aria-required="true" className="pkg-field pkg-field--area" />
      </div>
      <div style={{ padding: "18px 24px 22px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} className="pkg-pill pkg-pill--ghost pkg-pill--station" style={{ paddingInline: 20 }}>ביטול</button>
        <button type="button" disabled={!can} onClick={() => choice && onSave(choice, note.trim())} className="pkg-pill pkg-pill--primary pkg-pill--station" style={{ paddingInline: 22 }}>שמור החלטה</button>
      </div>
    </PackageDialog>
  );
}
