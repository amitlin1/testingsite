"use client";
import React from "react";
import { Skeleton } from "@/components/ui";
import { TONE_DOT, type StatusTone } from "@/app/lib/status-tones";
import "./items.css";

/*
 * SummaryStrip — shared KPI strip used under the page title (Items /
 * Shipments / item history). Quiet on purpose: the page title outranks it.
 * Values are ink at the KPI size with tabular figures; the icon is a neutral
 * glyph (blue is for things you can press); a status is shown the way every
 * other screen shows one — a small dot in the one status palette
 * (status-tones), never a tinted tile.
 */

/**
 * A tile's status tone. The status-tones names are preferred ("waiting" /
 * "active" / "done" / "neutral" — no dot). The older colour names still work
 * and map onto them: blue → active, amber → waiting, green → done.
 */
export type SummaryTone = StatusTone | "blue" | "amber" | "green";

const LEGACY_TONE: Record<"blue" | "amber" | "green", StatusTone> = {
    blue: "active",
    amber: "waiting",
    green: "done",
};

function statusToneOf(tone: SummaryTone): StatusTone {
    return tone === "blue" || tone === "amber" || tone === "green" ? LEGACY_TONE[tone] : tone;
}

const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "var(--space-sm)",
};

const iconBox: React.CSSProperties = {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: "var(--r-md)",
    background: "var(--color-canvas-parchment)",
    color: "var(--color-ink-muted-48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
    const st = statusToneOf(tone);
    const content = (
        <>
            <span style={iconBox} aria-hidden>
                {icon}
            </span>
            <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span
                    style={{
                        fontSize: "var(--text-kpi)",
                        fontWeight: 700,
                        letterSpacing: "var(--ls-display)",
                        lineHeight: 1.1,
                        color: "var(--color-ink)",
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    {value}
                </span>
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: "var(--space-xxs)",
                        fontSize: "var(--text-small)",
                        color: "var(--color-ink-muted-48)",
                    }}
                >
                    {st !== "neutral" && (
                        <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: TONE_DOT[st], flexShrink: 0 }} />
                    )}
                    {label}
                </span>
            </span>
        </>
    );
    if (onClick) {
        return (
            <button type="button" className="summary-tile" onClick={onClick} aria-pressed={active}>
                {content}
            </button>
        );
    }
    return <div className="summary-tile">{content}</div>;
}

/* Loading state — same grid and tile frame, skeleton bars (never a fake "0"). */
export function SummaryStripSkeleton({ count = 4, style }: { count?: number; style?: React.CSSProperties }) {
    return (
        <div style={{ ...gridStyle, ...style }} aria-hidden>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="summary-tile">
                    <Skeleton variant="rounded" width={40} height={40} style={{ flexShrink: 0, borderRadius: "var(--r-md)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Skeleton width="55%" height={22} />
                        <Skeleton width="75%" height={12} style={{ marginTop: "var(--space-xs)" }} />
                    </div>
                </div>
            ))}
        </div>
    );
}
