"use client";
import React from 'react';
import Barcode from 'react-barcode';
import { Shipment } from '@/app/lib/shipments/contract';
import {
    FieldGrid,
    ReportPage,
    ReportSection,
    ReportTable,
    SignatureBlock,
} from '@/app/components/reports/ReportKit';
import { REPORT_COLORS } from '@/app/components/reports/reportTheme';
import { formatDocDate } from '@/app/lib/datetime';

/** One outgoing certificate: the sends ShipmentHistoryPopup groups under one sent code. */
export type SentGroup = {
    sent_shipment_code: string;
    sent_date: string;
    sending_worker_name: string;
    items: { item_type_desc: string | null; makat: string | null; amount: number }[];
    signature_path?: string | null;
};

/** A row of the certificate's table: a received line (quantity) or a sent one (amount). */
type CertificateRow = { item_type_desc?: string | null; makat?: string | null; quantity?: number; amount?: number };

/** What ShipmentTable / ShipmentHistoryPopup print: the shipment, and for a sent one, its group. */
export type ShipmentPdfData = { shipment: Shipment; type: 'received' | 'sent'; historyGroup?: SentGroup };

type ShipmentPDFProps = ShipmentPdfData;

/** Shipment certificate (received / sent) on the unified report template. */
export const ShipmentPDFDocument = React.forwardRef<HTMLDivElement, ShipmentPDFProps>(
    ({ shipment, type, historyGroup }, ref) => {
        const isReceived = type === 'received';

        const titleHe = isReceived ? 'תעודת קבלת משלוח' : 'תעודת משלוח';
        const titleEn = isReceived ? 'SHIPMENT RECEIPT CERTIFICATE' : 'SHIPMENT CERTIFICATE';
        const shipmentCode: string | undefined = isReceived ? shipment.shipment_code : historyGroup?.sent_shipment_code;
        const date = formatDocDate(isReceived ? shipment.shipment_date : historyGroup?.sent_date);
        const workerName: string | undefined = isReceived
            ? (shipment.recieving_worker_name ?? undefined)
            : historyGroup?.sending_worker_name;
        const items: CertificateRow[] = isReceived ? (shipment.shipment_items || []) : (historyGroup?.items || []);
        const signaturePath: string | undefined = (isReceived ? shipment.signature_path : historyGroup?.signature_path) ?? undefined;
        const qty = (it: CertificateRow) => Number(it.quantity ?? it.amount ?? 0);
        const total = items.reduce((n, it) => n + qty(it), 0);

        const workerSlot = { name: workerName, date, signatureSrc: signaturePath };

        return (
            <ReportPage ref={ref} titleHe={titleHe} titleEn={titleEn} documentNumber={shipmentCode}>
                <ReportSection title="פרטי משלוח">
                    <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
                        <FieldGrid fields={[
                            { label: 'מס׳ משלוח', value: shipmentCode || '—', mono: true },
                            { label: 'תאריך משלוח', value: date },
                            { label: isReceived ? 'עובד מקבל' : 'עובד שולח', value: workerName || 'לא צוין' },
                            { label: 'קוד לקוח', value: shipment.customer_code || '—', mono: true },
                            { label: 'סוג תעודה', value: isReceived ? 'משלוח נכנס' : 'משלוח יוצא' },
                            { label: 'סה״כ מארזים', value: total, strong: true },
                        ]} />
                        {shipmentCode && (
                            <div style={{
                                flex: '0 0 180px', border: `1px solid ${REPORT_COLORS.border}`, borderRadius: 5,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, overflow: 'hidden',
                            }}>
                                <Barcode value={shipmentCode} width={1.4} height={56} fontSize={11} margin={0} />
                            </div>
                        )}
                    </div>
                </ReportSection>

                <ReportSection title="פירוט מארזים">
                    <ReportTable
                        columns={[
                            { header: '#', width: '44px', align: 'center', render: (_r, i) => i + 1 },
                            { header: 'סוג מארז', render: (r: CertificateRow) => r.item_type_desc || 'לא צוין' },
                            { header: 'מק״ט', width: '160px', mono: true, render: (r: CertificateRow) => r.makat || '—' },
                            { header: 'כמות', width: '80px', align: 'center', render: (r: CertificateRow) => qty(r) },
                        ]}
                        rows={items}
                        totals={['', 'סה״כ', '', total]}
                        emptyText="אין מארזים במשלוח"
                    />
                </ReportSection>

                <SignatureBlock slots={isReceived
                    ? [{ role: 'מוסר (לקוח)' }, { role: 'מקבל', ...workerSlot }]
                    : [{ role: 'מוסר', ...workerSlot }, { role: 'מקבל' }]}
                />
            </ReportPage>
        );
    }
);

ShipmentPDFDocument.displayName = 'ShipmentPDFDocument';
