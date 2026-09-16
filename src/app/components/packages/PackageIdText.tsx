"use client";
import React from "react";
import { BLUE, INK, MUTED, fmtId } from "./packageUi";

/**
 * A package / item id the way every package screen shows it (design §0):
 * grouped in fours, the two-digit position separate and bold, wrapped in
 * `direction:ltr; unicode-bidi:isolate` so it never flips inside RTL text.
 */
export default function PackageIdText({
  id,
  size = 13.5,
  headColor = MUTED,
  suffixColor = BLUE,
  weight = 400,
  letterSpacing = ".3px",
  style,
}: {
  id: string | number | bigint;
  size?: number;
  headColor?: string;
  suffixColor?: string;
  weight?: number;
  letterSpacing?: string;
  style?: React.CSSProperties;
}) {
  const { head, suffix } = fmtId(id);
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "baseline", gap: 4, fontVariantNumeric: "tabular-nums",
        direction: "ltr", unicodeBidi: "isolate", whiteSpace: "nowrap", ...style,
      }}
    >
      <span style={{ fontSize: size, color: headColor, letterSpacing, fontWeight: weight }}>{head}</span>
      {suffix && <span style={{ fontSize: size, fontWeight: 700, color: suffixColor }}>{suffix}</span>}
    </span>
  );
}

/** Status pill: neutral chip with a coloured dot (design: סטטוס המארז). */
export function StatusPill({ label, dot, size = 12 }: { label: string; dot: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: size, fontWeight: 600, background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "4px 10px", whiteSpace: "nowrap", color: INK }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
      {label}
    </span>
  );
}

/** The mini-items strip: one 20×9 block per item, coloured by state. */
export function MiniItems({ items, width = 20, height = 9 }: { items: { color: string; title: string }[]; width?: number; height?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {items.map((m, i) => (
        <span key={i} title={m.title} style={{ width, height, borderRadius: 3, background: m.color, display: "inline-block" }} />
      ))}
    </div>
  );
}
