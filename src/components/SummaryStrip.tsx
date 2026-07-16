"use client";
import React from "react";

/*
 * SummaryStrip — shared KPI strip used above tables (Items / Shipments),
 * matching the summary tiles on the Testing screen.
 * Design-system palette only: blue / amber / green tints, ink values.
 */

export type SummaryTone = "blue" | "amber" | "green";

const TONES: Record<SummaryTone, { color: string; bg: string }> = {
    blue: { color: "#0066cc", bg: "rgba(0,102,204,0.10)" },
    amber: { color: "#d97706", bg: "rgba(217,118,6,0.10)" },
    green: { color: "#1f8a5b", bg: "rgba(31,138,91,0.10)" },
};

const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 14,
};

const cardStyle: React.CSSProperties = {
    background: "#fff",
    // Longhand border props (not the `border` shorthand) — the active state
    // overrides borderColor, and React warns when shorthand + longhand mix.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e0e0e0",
    borderRadius: 16,
    padding: "16px 18px",
    display: "flex",
    alignItems: "center",
    gap: 14,
};

export function SummaryStrip({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return <div style={{ ...gridStyle, ...style }}>{children}</div>;
}

export function SummaryTile({
    icon,
    tone,
    value,
    label,
    onClick,
    active = false,
}: {
    icon: React.ReactNode;
    tone: SummaryTone;
    value: React.ReactNode;
    label: string;
    /** When provided, the tile becomes a toggle button (used to filter the table). */
    onClick?: () => void;
    active?: boolean;
}) {
    const t = TONES[tone];
    const interactive: React.CSSProperties = onClick
        ? {
              cursor: "pointer",
              font: "inherit",
              textAlign: "start",
              width: "100%",
              transition: "border-color 120ms ease, box-shadow 120ms ease",
              ...(active ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}` } : undefined),
          }
        : {};
    const Tag: any = onClick ? "button" : "div";
    return (
        <Tag
            type={onClick ? "button" : undefined}
            onClick={onClick}
            aria-pressed={onClick ? active : undefined}
            style={{ ...cardStyle, ...interactive }}
        >
            <div
                style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: 12,
                    background: t.bg,
                    color: t.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {icon}
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1, color: "#1d1d1f", fontVariantNumeric: "tabular-nums" }}>
                    {value}
                </div>
                <div style={{ fontSize: 13, color: "#7a7a7a", marginTop: 5 }}>{label}</div>
            </div>
        </Tag>
    );
}

/* Skeleton state — same grid, shimmering placeholder tiles. */
export function SummaryStripSkeleton({ count = 4, style }: { count?: number; style?: React.CSSProperties }) {
    const shimmer: React.CSSProperties = {
        background: "linear-gradient(90deg,#eee,#f5f5f7,#eee)",
        backgroundSize: "200% 100%",
        animation: "shx-strip-shimmer 1.4s infinite",
    };
    return (
        <div style={{ ...gridStyle, ...style }}>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} style={cardStyle}>
                    <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, ...shimmer }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ height: 22, width: "55%", borderRadius: 6, ...shimmer }} />
                        <div style={{ height: 12, width: "75%", borderRadius: 6, marginTop: 8, ...shimmer }} />
                    </div>
                </div>
            ))}
            <style>{`@keyframes shx-strip-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }`}</style>
        </div>
    );
}
