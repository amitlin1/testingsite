"use client";
import * as React from "react";
import { CircleAlert, Lightbulb, TriangleAlert } from "lucide-react";
import type { FailItem } from "@/app/lib/station-fields/evaluate";
import type { Field, FieldId } from "@/app/lib/station-fields/schema";

/**
 * "מוצע: לא תקין — '<field>' = <value> · …" under the popup's verdict question (route-fields spec
 * §4.9): a recommendation only — the worker decides, and nothing is preselected. Drawn only while
 * at least one field fails; there is never a "מוצע: תקין" line.
 *
 * Each artboard words and draws it its own way, and each popup keeps its own (spec §4.4):
 *
 * | artboard     | prefix                | tail                        | icon     | size | colour                  |
 * |--------------|-----------------------|-----------------------------|----------|------|-------------------------|
 * | 12, 15, 16   | SUGGEST_PREFIX        | —                           | circle   | 13   | blue once ok is "fail"  |
 * | 13           | SUGGEST_PREFIX        | SUGGEST_TAIL_WORKER_DECIDES | triangle | 13   | warning                 |
 * | 14           | SUGGEST_PREFIX_DIALOG | —                           | bulb     | 12.5 | warning                 |
 * | 17, 18       | SUGGEST_PREFIX        | —                           | circle   | 12.5 | warning                 |
 *
 * (prefixes and tail: src/app/lib/station-fields/labels.ts). The space around it differs too
 * (margin-top 10 in 12, 13, 15, 16; 8 in 14; 9 in 18; padding 8px 2px 0 in 17) — the host
 * passes it in `style`.
 *
 * The text is evaluate.ts suggestionText(prefix, fails), drawn in parts: each label and value is
 * isolated, and a number's value with its unit ("0.25 Ω", "-7 °C") reads left to right (spec §0.3,
 * §8.11) — as one plain string, the RTL line drew it "Ω 0.25".
 *
 * The role="status" region is always in the page, empty while nothing fails: a live region speaks
 * only for what is added to it, so the first suggestion is announced too (spec §4.13).
 */

export type SuggestionIcon = "circle" | "triangle" | "bulb";

export interface SuggestionLineProps {
  /** evaluateFields().fails — every failing field, in field order. */
  fails: readonly FailItem[];
  /** The fields `fails` was evaluated from: a number field's value is set left to right. */
  defs: readonly Field[];
  prefix: string;
  /** Muted, after the suggestion (artboard 13). */
  tail?: string;
  icon?: SuggestionIcon;
  /** The worker's own verdict, in the popups whose suggestion turns blue once the worker chose
   *  "לא תקין" (artboards 12, 15, 16 `suggestColor`). Leave it out everywhere else. */
  decided?: "pass" | "fail" | "" | null;
  size?: "13" | "12.5";
  id?: string;
  className?: string;
  /** The artboard's spacing around the line (applied only while it is drawn). */
  style?: React.CSSProperties;
}

/** suggestionText's pieces (evaluate.ts): "'" + label + "' = " + value, joined " · ". */
const QUOTE = "'";
const EQUALS = "' = ";
const JOIN = " · ";

/** A number with its unit: one left-to-right run that never wraps between them. */
const NUMBER_STYLE: React.CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

export function SuggestionLine({
  fails, defs, prefix, tail, icon = "circle", decided, size = "13", id, className, style,
}: SuggestionLineProps) {
  if (fails.length === 0) return <div role="status" id={id} className={className} />;
  const numbers = new Set<FieldId>(defs.flatMap((d) => (d.type === "number" ? [d.id] : [])));
  // Artboards 13 and 14 let a long line wrap with the icon on its first line; the others centre it.
  const top = icon !== "circle";
  const iconStyle: React.CSSProperties = { flex: "none", marginTop: top ? 2 : undefined };
  return (
    <div role="status" id={id} className={className}>
      <div
        style={{
          display: "flex", alignItems: top ? "flex-start" : "center", gap: 6,
          fontSize: size === "12.5" ? 12.5 : "var(--text-small)",
          lineHeight: icon === "triangle" ? 1.45 : icon === "bulb" ? 1.4 : undefined,
          color: decided === "fail" ? "var(--color-primary)" : "var(--color-warning-ink)",
          ...style,
        }}>
        {icon === "triangle" ? <TriangleAlert size={15} strokeWidth={1.75} aria-hidden style={iconStyle} />
          : icon === "bulb" ? <Lightbulb size={14} strokeWidth={1.75} aria-hidden style={iconStyle} />
            : <CircleAlert size={14} strokeWidth={1.75} aria-hidden style={iconStyle} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>
            {prefix}
            {fails.map((f, i) => (
              <React.Fragment key={f.field_id}>
                {i > 0 && JOIN}
                {QUOTE}<bdi>{f.label}</bdi>{EQUALS}
                {numbers.has(f.field_id)
                  ? <bdi dir="ltr" style={NUMBER_STYLE}>{f.valueText}</bdi>
                  : <bdi>{f.valueText}</bdi>}
              </React.Fragment>
            ))}
          </span>
          {tail && <span style={{ color: "var(--color-ink-muted-48)" }}>{tail}</span>}
        </span>
      </div>
    </div>
  );
}

export default SuggestionLine;
