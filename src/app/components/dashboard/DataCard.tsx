"use client";

// The white card shell every widget sits in (§9): 1px hairline, the card
// radius, no shadow, no gradient. Two optional bands under the title, in this
// order:
//
//   note   — the sentence that explains a column whose meaning changed. §5 of
//            the build guide: these lines are part of the design, not
//            decoration, and are never dropped to save space.
//   error  — an endpoint that answered 4xx/5xx. It sits ABOVE the body and the
//            last good rows stay visible underneath (§11). With `onRetry` it
//            carries the one action that helps: run the fetch again.
//
// `right` is the slot the legends, segmented controls and the ignored-filter
// pill live in.

import * as React from "react";

import { Tag } from "@/components/ui";
import { Info } from "@/components/ui/icons";

export interface DataCardProps {
  title?: React.ReactNode;
  /** Muted line next to the title — the on-screen explanation of a column. */
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  /** Full-width band under the header, with an info glyph. */
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
              <h2 style={{ margin: 0, fontSize: "var(--text-body-sm)", fontWeight: 600, whiteSpace: "nowrap" }}>{title}</h2>
            )}
            {subtitle && (
              <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>{subtitle}</div>
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
            fontSize: "var(--text-fine)",
            color: "var(--color-ink-muted-48)",
            flexShrink: 0,
          }}
        >
          <span className="dash-icon" style={{ color: "var(--dash-amber-ink)" }}>
            <Info fontSize={13} strokeWidth={2} aria-hidden />
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
            padding: "6px 16px",
            background: "var(--color-danger-bg)",
            borderBottom: "1px solid var(--color-hairline)",
            fontSize: "var(--text-small)",
            color: "var(--color-destructive)",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="dash-btn dash-btn--danger">
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
 * steps. The app's one small label pill, in its warning tone.
 */
export function IgnoredFiltersPill({ text }: { text: string }) {
  return <Tag tone="warning">{text}</Tag>;
}

/** A neutral statement of fact, not a warning — `המסך אינו תלוי בטווח התאריכים`. */
export function NeutralPill({ text }: { text: string }) {
  return <Tag tone="neutral">{text}</Tag>;
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
        fontSize: "var(--text-fine)",
        color: "var(--color-ink-muted-48)",
        flexWrap: "wrap",
      }}
    >
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            aria-hidden
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
