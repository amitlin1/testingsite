"use client";
import React from "react";
import Barcode from "react-barcode";
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
 * with the boxes. On the unified report template: the shipment's details, the
 * number of items alone (no names, no lines), and one empty box for the
 * receiver to sign by hand.
 */
export const ShipmentDeliveryForm = React.forwardRef<HTMLDivElement, ShipmentDeliveryFormProps>(
    ({ sentCode, sentDate, sourceShipmentCode, customerCode, itemsTotal }, ref) => (
        <ReportPage ref={ref} titleHe="טופס מסירת משלוח" titleEn="SHIPMENT DELIVERY FORM" documentNumber={sentCode}>
            <ReportSection title="פרטי משלוח">
                <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                    <FieldGrid fields={[
                        { label: "מס׳ משלוח יוצא", value: sentCode || "—", mono: true },
                        { label: "תאריך שליחה", value: formatReportDate(sentDate) },
                        { label: "משלוח מקור", value: sourceShipmentCode || "—", mono: true },
                        { label: "קוד לקוח", value: customerCode || "—", mono: true },
                        { label: "סה״כ פריטים", value: itemsTotal, strong: true },
                    ]} />
                    {sentCode && (
                        <div style={{
                            flex: "0 0 180px", border: `1px solid ${REPORT_COLORS.border}`, borderRadius: 5,
                            display: "flex", alignItems: "center", justifyContent: "center", padding: 6, overflow: "hidden",
                        }}>
                            <Barcode value={sentCode} width={1.4} height={56} fontSize={11} margin={0} />
                        </div>
                    )}
                </div>
            </ReportSection>

            {/* One box, left empty for the receiver's hand. */}
            <div className="ts-keep" style={{ marginTop: 8, border: `1px solid ${REPORT_COLORS.border}`, borderRadius: 6, padding: "12px 14px", maxWidth: 340 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: REPORT_COLORS.navy }}>חתימת המקבל</span>
                <div style={{ height: 70, borderBottom: `1px solid ${REPORT_COLORS.ink}` }} />
            </div>
        </ReportPage>
    ),
);

ShipmentDeliveryForm.displayName = "ShipmentDeliveryForm";
