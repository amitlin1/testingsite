"use client";
import React from "react";
import { formatId } from "@/app/lib/packages/ids";
import { BLUE, MUTED } from "@/components/ui/colors";

/**
 * A box / item id the way every screen shows it (design §0): its head grouped
 * (formatId), the two-digit position separate and bold, wrapped in
 * `direction:ltr; unicode-bidi:isolate` so it never flips inside RTL text.
 */
export default function IdText({
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
  const { head, suffix } = formatId(id);
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
