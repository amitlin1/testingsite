"use client";
/* eslint-disable @next/next/no-img-element -- rendered into the react-to-print
   pipeline, where next/image's lazy loading and srcset never resolve. */
/**
 * Building blocks of the unified TESTINGSITE print template. Every printed
 * document is a <ReportPage> holding <ReportSection>s; see
 * docs/REPORT_TEMPLATE.md for the layout rules.
 */
import React from "react";
import {
    REPORT_CLASSIFICATION,
    REPORT_COLORS as C,
    REPORT_FONT,
    REPORT_LOGOS,
    REPORT_MONO,
    REPORT_ORG_NAME,
    STATUS_STYLE,
    ReportStatus,
    formatReportDate,
} from "./reportTheme";

const printExact: React.CSSProperties = {
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
};

/* A4 page box + page counter in the bottom margin of every printed page. */
const PAGE_CSS = `
@page {
  size: A4 portrait;
  margin: 10mm 12mm 14mm;
  @bottom-center {
    content: "עמוד " counter(page) " מתוך " counter(pages);
    font-family: Arial, sans-serif;
    font-size: 8pt;
    color: ${C.muted};
  }
}
@page landscape-report { size: A4 landscape; }
.ts-report table { break-inside: auto; }
.ts-report tr, .ts-report .ts-keep { break-inside: avoid; }
.ts-report thead { display: table-header-group; }
`;

export type ReportMetaItem = { label: string; value: React.ReactNode; mono?: boolean };

type ReportPageProps = {
    titleHe: string;
    titleEn: string;
    /** Operational variant: red badge under the title. */
    operational?: boolean;
    /** Document number, printed first in the meta row. */
    documentNumber?: string;
    generatedBy?: string | null;
    generatedAt?: Date;
    /** Extra meta cells after מס׳ מסמך / תאריך הפקה / הופק ע״י. */
    meta?: ReportMetaItem[];
    landscape?: boolean;
    children: React.ReactNode;
};

/** The page frame: classification, emblem header, meta row, body, footer. */
export const ReportPage = React.forwardRef<HTMLDivElement, ReportPageProps>(
    ({ titleHe, titleEn, operational, documentNumber, generatedBy, generatedAt, meta = [], landscape, children }, ref) => {
        const generated = generatedAt ?? new Date();
        const metaItems: ReportMetaItem[] = [
            ...(documentNumber ? [{ label: "מס׳ מסמך", value: documentNumber, mono: true }] : []),
            { label: "תאריך הפקה", value: formatReportDate(generated, true) },
            ...(generatedBy ? [{ label: "הופק ע״י", value: generatedBy }] : []),
            ...meta,
        ];

        return (
            <div
                ref={ref}
                className="ts-report"
                dir="rtl"
                lang="he"
                style={{
                    ...printExact,
                    page: landscape ? "landscape-report" : undefined,
                    background: "#FFFFFF",
                    color: C.ink,
                    fontFamily: REPORT_FONT,
                    fontSize: 12,
                    lineHeight: 1.45,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                } as React.CSSProperties}
            >
                <style>{PAGE_CSS}</style>

                {REPORT_CLASSIFICATION && <ClassificationMark />}

                {/* Header */}
                <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 12 }}>
                        <LogoPair srcs={REPORT_LOGOS.right} align="flex-start" />
                        <div style={{ flex: 1, textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
                            {REPORT_ORG_NAME && (
                                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{REPORT_ORG_NAME}</div>
                            )}
                            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.navy }}>{titleHe}</h1>
                            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 3, color: C.muted }}>{titleEn}</div>
                            {operational && (
                                <div style={{
                                    alignSelf: "center", marginTop: 6, padding: "2px 14px", borderRadius: 999,
                                    background: C.red, color: "#FFFFFF", fontSize: 10, fontWeight: 700, letterSpacing: 1,
                                }}>
                                    תעודה מבצעית
                                </div>
                            )}
                        </div>
                        <LogoPair srcs={REPORT_LOGOS.left} align="flex-end" />
                    </div>
                    <EmblemStrip height={5} />
                </div>

                {/* Meta row */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${metaItems.length}, minmax(0, 1fr))`,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    overflow: "hidden",
                }}>
                    {metaItems.map((m, i) => (
                        <div key={i} style={{
                            padding: "6px 12px",
                            borderLeft: i < metaItems.length - 1 ? `1px solid ${C.border}` : undefined,
                            display: "flex", flexDirection: "column", gap: 1,
                        }}>
                            <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{m.label}</span>
                            <span style={{ fontWeight: 600, fontFamily: m.mono ? REPORT_MONO : undefined }}>{m.value}</span>
                        </div>
                    ))}
                </div>

                {children}

                {/* Footer (end of document; page numbers come from @page) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    <EmblemStrip height={2} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9.5, color: C.muted }}>
                        <span>מסמך זה הופק אוטומטית ממערכת TESTINGSITE</span>
                        {REPORT_CLASSIFICATION && (
                            <span style={{ fontWeight: 700, letterSpacing: 2, color: C.ink }}>{REPORT_CLASSIFICATION}</span>
                        )}
                        <span>{formatReportDate(generated, true)}</span>
                    </div>
                </div>
            </div>
        );
    }
);
ReportPage.displayName = "ReportPage";

function ClassificationMark() {
    return (
        <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>
            {REPORT_CLASSIFICATION}
        </div>
    );
}

function LogoPair({ srcs, align }: { srcs: readonly string[]; align: "flex-start" | "flex-end" }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: align, gap: 10, flex: "0 0 130px" }}>
            {srcs.map((src) => (
                <img key={src} src={src} alt="" style={{ height: 56, width: "auto", maxWidth: 60, objectFit: "contain" }} />
            ))}
        </div>
    );
}

/** The four-color band taken from the emblems (6:2:1:1). */
export function EmblemStrip({ height }: { height: number }) {
    return (
        <div style={{ display: "flex", height, ...printExact }}>
            <div style={{ flex: 6, background: C.navy }} />
            <div style={{ flex: 2, background: C.red }} />
            <div style={{ flex: 1, background: C.yellow }} />
            <div style={{ flex: 1, background: C.sky }} />
        </div>
    );
}

export function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="ts-keep" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 4, height: 16, background: C.navy, borderRadius: 1, ...printExact }} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.navy }}>{title}</h2>
            </div>
            {children}
        </section>
    );
}

export type ReportField = { label: string; value: React.ReactNode; mono?: boolean; strong?: boolean };

/** Label / value cells in a grid (2 columns by default). */
export function FieldGrid({ fields, columns = 2 }: { fields: ReportField[]; columns?: number }) {
    return (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }}>
            {fields.map((f, i) => (
                <div key={i} className="ts-keep" style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 5, overflow: "hidden" }}>
                    <span style={{
                        flex: "0 0 96px", padding: "7px 10px", background: C.labelBg, borderLeft: `1px solid ${C.border}`,
                        fontWeight: 600, fontSize: 11, color: C.label, ...printExact,
                    }}>
                        {f.label}
                    </span>
                    <span style={{
                        flex: 1, padding: "7px 10px", minWidth: 0, overflowWrap: "anywhere",
                        fontFamily: f.mono ? REPORT_MONO : undefined,
                        fontWeight: f.strong ? 700 : f.mono ? 600 : 500,
                        color: f.strong ? C.navy : undefined,
                    }}>
                        {f.value ?? "—"}
                    </span>
                </div>
            ))}
        </div>
    );
}

export type ReportColumn<T> = {
    header: string;
    width?: string;
    align?: "right" | "center" | "left";
    mono?: boolean;
    render: (row: T, index: number) => React.ReactNode;
};

/** Navy-header table with zebra rows and an optional totals row. thead repeats on every printed page. */
export function ReportTable<T>({ columns, rows, totals, emptyText = "אין נתונים" }: {
    columns: ReportColumn<T>[];
    rows: T[];
    totals?: React.ReactNode[];
    emptyText?: string;
}) {
    const cell: React.CSSProperties = { padding: "7px 10px", textAlign: "right" };
    return (
        <table style={{
            width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed",
            border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", fontSize: 12, ...printExact,
        }}>
            <colgroup>
                {columns.map((c, i) => <col key={i} style={{ width: c.width }} />)}
            </colgroup>
            <thead>
                <tr style={{ background: C.navy, color: "#FFFFFF" }}>
                    {columns.map((c, i) => (
                        <th key={i} style={{ ...cell, fontSize: 11.5, fontWeight: 700, textAlign: c.align ?? "right" }}>{c.header}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length === 0 && (
                    <tr><td colSpan={columns.length} style={{ ...cell, textAlign: "center", color: C.muted }}>{emptyText}</td></tr>
                )}
                {rows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 ? C.zebra : "#FFFFFF" }}>
                        {columns.map((c, ci) => (
                            <td key={ci} style={{
                                ...cell,
                                borderTop: `1px solid ${C.rowLine}`,
                                textAlign: c.align ?? "right",
                                fontFamily: c.mono ? REPORT_MONO : undefined,
                                overflowWrap: "anywhere",
                            }}>
                                {c.render(row, ri)}
                            </td>
                        ))}
                    </tr>
                ))}
                {totals && (
                    <tr style={{ background: C.labelBg, fontWeight: 700, color: C.navy }}>
                        {totals.map((t, i) => (
                            <td key={i} style={{ ...cell, borderTop: `1.5px solid ${C.navy}`, textAlign: columns[i]?.align ?? "right" }}>{t}</td>
                        ))}
                    </tr>
                )}
            </tbody>
        </table>
    );
}

const STATUS_LABEL: Record<ReportStatus, string> = { pass: "✓ עבר", fail: "✕ נכשל", pending: "ממתין", none: "—" };

/** Status pill — always a mark plus a word, never color alone. */
export function StatusChip({ status, label }: { status: ReportStatus; label?: string }) {
    const s = STATUS_STYLE[status];
    return (
        <span style={{
            display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
            background: s.bg, color: s.fg, whiteSpace: "nowrap", ...printExact,
        }}>
            {label ?? STATUS_LABEL[status]}
        </span>
    );
}

export type SignatureSlot = { role: string; name?: string | null; date?: string | null; signatureSrc?: string | null };

/** Signature boxes side by side; an empty slot leaves lines to sign by hand. */
export function SignatureBlock({ slots }: { slots: SignatureSlot[] }) {
    return (
        <div className="ts-keep" style={{ display: "grid", gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, gap: 16, marginTop: 8 }}>
            {slots.map((s, i) => (
                <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.navy }}>{s.role}</span>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
                        <span>שם: {s.name || "____________"}</span>
                        <span>תאריך: {s.date || "________"}</span>
                    </div>
                    <div style={{ height: 60, borderBottom: `1px solid ${C.ink}`, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                        {s.signatureSrc
                            ? <img src={s.signatureSrc} alt="חתימה" style={{ maxHeight: 56, maxWidth: "80%", objectFit: "contain" }} />
                            : <span style={{ fontSize: 10, color: "#8A93A8", paddingBottom: 4 }}>חתימה</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}

export { REPORT_COLORS, REPORT_MONO } from "./reportTheme";
