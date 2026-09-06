"use client";

// The white card shell every widget sits in (§9): 1px hairline, 14px radius,
// no shadow, no gradient. Three optional bands under the title, in this order:
//
//   note   — the sentence that explains a column whose meaning changed. §5 of
//            the build guide: these lines are part of the design, not
//            decoration, and are never dropped to save space.
//   error  — an endpoint that answered 4xx/5xx. It sits ABOVE the body and the
//            last good rows stay visible underneath (§11).
//
// `right` is the slot the legends, segmented controls and the ignored-filter
// pill live in.

import * as React from "react";

import { Info } from "@/components/ui/icons";

export interface DataCardProps {
  title?: React.ReactNode;
  /** Muted line next to the title — the on-screen explanation of a column. */
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  /** Full-width band under the header, amber-tinted, with an info glyph. */
  note?: React.ReactNode;
  error?: string | null;
  onRetry?: () => void;
  /** A table card: header is fixed, the body scrolls inside the card. */
  panel?: boolean;
  /** A chart card: 12/16 padding and a min-height floor below 1100px. */
  chart?: boolean;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}

export default function DataCard({
  title,
  subtitle,
  right,
  note,
  error,
  onRetry,
  panel = false,
  chart = false,
  style,
  className,
  children,
}: DataCardProps) {
  const classes = ["dash-card"];
  if (panel) classes.push("dash-panel");
  if (chart) classes.push("dash-chart-card");
  if (className) classes.push(className);

  return (
    <div
      className={classes.join(" ")}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...(chart ? { padding: "12px 16px" } : null),
        ...style,
      }}
    >
      {(title || right) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexShrink: 0,
            ...(chart
              ? null
              : {
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--color-hairline)",
                }),
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
            {title && (
              <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</div>
            )}
            {subtitle && (
              <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>{subtitle}</div>
            )}
          </div>
          {right && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{right}</div>
          )}
        </div>
      )}

      {note && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 16px",
            background: "var(--color-canvas-parchment)",
            borderBottom: "1px solid var(--color-hairline)",
            fontSize: 11.5,
            color: "var(--color-ink-muted-48)",
            flexShrink: 0,
          }}
        >
          <span className="dash-icon" style={{ color: "var(--dash-amber-ink)" }}>
            <Info fontSize={13} strokeWidth={2} />
          </span>
          {note}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            background: "rgba(191,53,53,.06)",
            borderBottom: "1px solid var(--color-hairline)",
            fontSize: 12.5,
            color: "var(--color-destructive)",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="dash-press"
              style={{
                border: "1px solid var(--color-destructive)",
                background: "transparent",
                color: "var(--color-destructive)",
                borderRadius: 8,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              נסה שוב
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * The amber pill of §16.3. A filter an endpoint cannot honour is NAMED on
 * screen — a silently dropped filter is the failure class the metrics rewrite
 * exists to kill, and hiding it in a tooltip is the same failure with extra
 * steps.
 */
export function IgnoredFiltersPill({ text }: { text: string }) {
  return (
    <span
      style={{
        background: "var(--dash-amber-tint)",
        color: "var(--dash-amber-ink)",
        borderRadius: 9999,
        padding: "3px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/** A neutral statement of fact, not a warning — `המסך אינו תלוי בטווח התאריכים`. */
export function NeutralPill({ text }: { text: string }) {
  return (
    <span
      style={{
        background: "var(--color-canvas-parchment)",
        color: "var(--color-ink-muted-48)",
        borderRadius: 9999,
        padding: "3px 10px",
        fontSize: 11.5,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/** The hand-built legend that keeps recharts' plot area full height (§10). */
export function Legend({
  items,
}: {
  items: Array<{ color: string; label: string; line?: boolean; dashed?: boolean }>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        fontSize: 11.5,
        color: "var(--color-ink-muted-48)",
        flexWrap: "wrap",
      }}
    >
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={
              item.line
                ? item.dashed
                  ? { width: 14, height: 0, borderTop: `2px dashed ${item.color}` }
                  : { width: 14, height: 2, background: item.color }
                : { width: 9, height: 9, borderRadius: 2, background: item.color }
            }
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}
