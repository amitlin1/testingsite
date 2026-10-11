"use client";
/**
 * דוח תוצאות בדיקה — item details, overall verdict, a step summary table and
 * a block per test with its fields (test_results.details, see testDetails.ts).
 * Render it off-screen and print with react-to-print, like ShipmentPDFDocument.
 */
import React from "react";
import {
    FieldGrid,
    ReportPage,
    ReportSection,
    ReportTable,
    SignatureBlock,
    StatusChip,
    REPORT_COLORS as C,
    REPORT_MONO,
} from "./ReportKit";
import { ReportStatus, STATUS_STYLE, formatReportDate } from "./reportTheme";
import { normalizeTestDetails } from "./testDetails";

export type TestReportItem = {
    itemTypeDesc?: string | null;
    makat?: string | null;
    serialNumber?: string | null;
    shipmentCode?: string | null;
    customerName?: string | null;
    routeNumber?: number | null;
};

export type TestReportStep = {
    step: number;
    testTypeDesc?: string | null;
    stationDesc?: string | null;
    workerName?: string | null;
    createdAt?: string | Date | null;
    /** null / undefined = not done yet */
    passed?: boolean | null;
    comments?: string | null;
    details?: unknown;
};

type Props = {
    item: TestReportItem;
    steps: TestReportStep[];
    documentNumber?: string;
    generatedBy?: string | null;
    notes?: string | null;
};

const stepStatus = (s: TestReportStep): ReportStatus =>
    s.passed === true ? "pass" : s.passed === false ? "fail" : "pending";

const FIELD_STATUS_LABEL: Record<ReportStatus, string> = { pass: "✓ תקין", fail: "✕ חריגה", pending: "ממתין", none: "—" };

export const TestResultsReportDocument = React.forwardRef<HTMLDivElement, Props>(
    ({ item, steps, documentNumber, generatedBy, notes }, ref) => {
        const sorted = [...steps].sort((a, b) => a.step - b.step);
        const passedCount = sorted.filter((s) => s.passed === true).length;
        const anyFail = sorted.some((s) => s.passed === false);
        const allDone = sorted.length > 0 && sorted.every((s) => s.passed != null);
        const verdict: ReportStatus = anyFail ? "fail" : allDone ? "pass" : "pending";
        const verdictText = anyFail ? "נכשל" : allDone ? "עבר" : "בתהליך";
        const verdictColor = STATUS_STYLE[verdict].fg;
        const withFields = sorted.map((s) => ({ s, fields: normalizeTestDetails(s.details) }))
            .filter((x) => x.fields.length > 0 || x.s.comments);

        return (
            <ReportPage ref={ref} titleHe="דוח תוצאות בדיקה" titleEn="TEST RESULTS REPORT"
                documentNumber={documentNumber} generatedBy={generatedBy}>

                <ReportSection title="פרטי הפריט">
                    <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                        <FieldGrid fields={[
                            { label: "סוג פריט", value: item.itemTypeDesc || "—" },
                            { label: "מק״ט", value: item.makat || "—", mono: true },
                            { label: "מס׳ סריאלי", value: item.serialNumber || "—", mono: true },
                            { label: "משלוח", value: item.shipmentCode || "—", mono: true },
                            { label: "לקוח", value: item.customerName || "—" },
                            { label: "מסלול בדיקה", value: `מסלול ${item.routeNumber ?? 1} · ${sorted.length} שלבים` },
                        ]} />
                        <div className="ts-keep" style={{
                            flex: "0 0 150px", borderRadius: 6, border: `2px solid ${verdictColor}`,
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            gap: 4, padding: 10, textAlign: "center",
                        }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: C.muted }}>פסיקה כוללת</span>
                            <span style={{ fontSize: 26, fontWeight: 800, color: verdictColor }}>{verdictText}</span>
                            <span style={{ fontSize: 10, color: C.muted }}>{passedCount} מתוך {sorted.length} שלבים עברו</span>
                        </div>
                    </div>
                </ReportSection>

                <ReportSection title="תוצאות לפי שלב">
                    <ReportTable
                        columns={[
                            { header: "שלב", width: "44px", align: "center", render: (s: TestReportStep) => s.step },
                            { header: "סוג בדיקה", width: "22%", render: (s: TestReportStep) => s.testTypeDesc || "—" },
                            { header: "עמדה", width: "16%", render: (s: TestReportStep) => s.stationDesc || "—" },
                            { header: "בודק", width: "15%", render: (s: TestReportStep) => s.workerName || "—" },
                            { header: "תוצאה", width: "84px", align: "center", render: (s: TestReportStep) => <StatusChip status={stepStatus(s)} /> },
                            { header: "תאריך", width: "84px", render: (s: TestReportStep) => formatReportDate(s.createdAt) },
                            { header: "הערות", render: (s: TestReportStep) => s.comments || "—" },
                        ]}
                        rows={sorted}
                        emptyText="אין תוצאות בדיקה לפריט"
                    />
                </ReportSection>

                {withFields.length > 0 && (
                    <ReportSection title="פירוט שדות לפי בדיקה">
                        {withFields.map(({ s, fields }) => (
                            <div key={s.step} className="ts-keep" style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
                                <div style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
                                    background: C.labelBg, borderBottom: `1px solid ${C.border}`,
                                    WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
                                }}>
                                    <span style={{
                                        flex: "0 0 26px", height: 26, borderRadius: "50%", background: C.navy, color: "#FFFFFF",
                                        fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>{s.step}</span>
                                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{s.testTypeDesc || "—"}</span>
                                        <span style={{ fontSize: 10.5, color: C.muted }}>
                                            {[s.stationDesc, s.workerName, formatReportDate(s.createdAt)].filter(Boolean).join(" · ")}
                                        </span>
                                    </div>
                                    <StatusChip status={stepStatus(s)} />
                                </div>
                                {fields.length > 0 && (
                                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11.5 }}>
                                        <colgroup>
                                            <col /><col style={{ width: 130 }} /><col style={{ width: 58 }} />
                                            <col style={{ width: 140 }} /><col style={{ width: 76 }} />
                                        </colgroup>
                                        <thead>
                                            <tr style={{ color: C.muted, fontSize: 10.5 }}>
                                                {["שדה", "ערך", "יחידה", "דרישה / טווח", "תוצאה"].map((h, i) => (
                                                    <th key={h} style={{ padding: "6px 10px", textAlign: i === 4 ? "center" : "right", fontWeight: 700, borderBottom: `1px solid ${C.rowLine}` }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fields.map((f, i) => (
                                                <tr key={i} style={{ background: i % 2 ? C.zebra : "#FFFFFF" }}>
                                                    <td style={{ padding: "6px 10px", fontWeight: 500 }}>{f.label}</td>
                                                    <td dir="ltr" style={{ padding: "6px 10px", textAlign: "right", fontFamily: REPORT_MONO, fontWeight: 600, color: f.status === "fail" ? C.failFg : undefined, overflowWrap: "anywhere" }}>{f.value}</td>
                                                    <td style={{ padding: "6px 10px", color: C.muted }}>{f.unit}</td>
                                                    <td dir="ltr" style={{ padding: "6px 10px", textAlign: "right", fontFamily: REPORT_MONO, fontSize: 11 }}>{f.spec}</td>
                                                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                                                        <StatusChip status={f.status} label={FIELD_STATUS_LABEL[f.status]} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                {s.comments && (
                                    <div style={{ display: "flex", gap: 8, padding: "7px 12px", borderTop: `1px solid ${C.rowLine}`, fontSize: 11 }}>
                                        <span style={{ fontWeight: 700, color: C.label }}>הערת בודק:</span>
                                        <span style={{ color: C.label }}>{s.comments}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </ReportSection>
                )}

                {notes && (
                    <ReportSection title="הערות">
                        <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 14px", whiteSpace: "pre-wrap" }}>{notes}</div>
                    </ReportSection>
                )}

                <SignatureBlock slots={[{ role: "בודק אחראי" }, { role: "מאשר" }]} />
            </ReportPage>
        );
    }
);

TestResultsReportDocument.displayName = "TestResultsReportDocument";
