"use client";
import React from "react";
import { FieldGrid, ReportPage, ReportSection, REPORT_COLORS } from "@/app/components/reports/ReportKit";
import { formatReportDate } from "@/app/components/reports/reportTheme";

type ShipmentDeliveryFormProps = {
    /** The outgoing shipment code (קוד משלוח יוצא). */
    sentCode: string;
    /** YYYY-MM-DD, as the return dialog holds it. */
    sentDate: string;
    sourceShipmentCode: string;
    customerCode: string;
    /** The items in the boxes sent: each box type's contents × its boxes. */
    itemsTotal: number;
};

/**
 * טופס מסירת משלוח — printed from the return dialog (ShipmentSendPopup), to go
 * with the boxes. On the unified report template, one full page: the shipment's
 * details, the number of items alone (no names, no lines), and at the bottom of
 * the page one empty box for the receiver to sign by hand.
 */
export const ShipmentDeliveryForm = React.forwardRef<HTMLDivElement, ShipmentDeliveryFormProps>(
    ({ sentCode, sentDate, sourceShipmentCode, customerCode, itemsTotal }, ref) => (
        <ReportPage ref={ref} titleHe="טופס מסירת משלוח" titleEn="SHIPMENT DELIVERY FORM" documentNumber={sentCode} fillPage>
            <ReportSection title="פרטי משלוח">
                <FieldGrid large fields={[
                    { label: "משלוח יוצא", value: sentCode || "—", mono: true },
                    { label: "תאריך שליחה", value: formatReportDate(sentDate) },
                    { label: "משלוח מקור", value: sourceShipmentCode || "—", mono: true },
                    { label: "קוד לקוח", value: customerCode || "—", mono: true },
                ]} />
                <div className="ts-keep" style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                    border: `1.5px solid ${REPORT_COLORS.navy}`, borderRadius: 6, background: REPORT_COLORS.labelBg,
                    padding: "14px 20px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
                }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: REPORT_COLORS.label }}>סה״כ פריטים</span>
                    <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: REPORT_COLORS.navy }}>{itemsTotal}</span>
                </div>
            </ReportSection>

            {/* One box, left empty for the receiver's hand; marginTop auto drops it (and the footer) to the page bottom. */}
            <div className="ts-keep" style={{ marginTop: "auto", border: `1px solid ${REPORT_COLORS.border}`, borderRadius: 6, padding: "14px 18px", maxWidth: 380 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: REPORT_COLORS.navy }}>חתימת המקבל</span>
                <div style={{ height: 80, borderBottom: `1px solid ${REPORT_COLORS.ink}` }} />
            </div>
        </ReportPage>
    ),
);

ShipmentDeliveryForm.displayName = "ShipmentDeliveryForm";
