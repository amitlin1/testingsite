"use client";
import React from "react";
import { Check, Minus, Plus } from "lucide-react";
import "./controls.css";

/** Copies stepper (1–9) of the label dialogs. In a field row it takes the
 *  field frame (44px, --r-field, the field edge). */
export function CopiesStepper({ copies, onChange, labelId }: { copies: number; onChange: (n: number) => void; labelId?: string }) {
  return (
    <div role="group" aria-labelledby={labelId} style={{ boxSizing: "border-box", height: 44, border: "1px solid var(--color-field-border)", borderRadius: "var(--r-field)", background: "var(--color-canvas)", display: "flex", alignItems: "center", justifyContent: "space-between", paddingInline: "13px 6px" }}>
      <span aria-live="polite" style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{copies}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button type="button" aria-label="פחות עותקים" onClick={() => onChange(Math.max(1, copies - 1))} className="pkg-iconbtn pkg-iconbtn--ink"><Minus size={15} strokeWidth={2} aria-hidden /></button>
        <button type="button" aria-label="יותר עותקים" onClick={() => onChange(Math.min(9, copies + 1))} className="pkg-iconbtn pkg-iconbtn--ink"><Plus size={15} strokeWidth={2} aria-hidden /></button>
      </div>
    </div>
  );
}

/** The tick of a checkbox-like card; the card itself carries role="checkbox". */
export function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={on ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 21, height: 21, borderRadius: 6, borderColor: on ? undefined : "var(--color-field-border)" }}>
      {on && <Check size={13} strokeWidth={2.5} />}
    </span>
  );
}

/** Keyboard for a card that acts like a checkbox / button but holds block
 *  content (role="checkbox" + tabIndex 0): Space and Enter press it, as on a
 *  native control. Keys from a control inside the card are left alone. */
export function pressKeys(onPress: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    onPress();
  };
}

/** Status pill: a neutral chip with a coloured dot (design: סטטוס המארז). */
export function DotPill({ label, dot, size = 12 }: { label: string; dot: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: size, fontWeight: 600, background: "var(--color-canvas-parchment)", border: "1px solid var(--color-hairline)", borderRadius: 9999, padding: "4px 10px", whiteSpace: "nowrap", color: "var(--color-ink)" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
      {label}
    </span>
  );
}

/** A strip of small blocks, one per member, coloured by its state. The
 *  colours alone say nothing to a screen reader (or to someone who can't tell
 *  amber from green), so the strip is one image named by every block's title. */
export function MiniItems({ items, width = 20, height = 9 }: { items: { color: string; title: string }[]; width?: number; height?: number }) {
  return (
    <div role="img" aria-label={items.map((m) => m.title).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {items.map((m, i) => (
        <span key={i} title={m.title} style={{ width, height, borderRadius: 3, background: m.color, display: "inline-block" }} />
      ))}
    </div>
  );
}
