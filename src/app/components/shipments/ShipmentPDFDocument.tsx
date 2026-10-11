"use client";
import React from 'react';
import Barcode from 'react-barcode';
import { Shipment } from '@/types';
import {
    FieldGrid,
    ReportPage,
    ReportSection,
    ReportTable,
    SignatureBlock,
    REPORT_COLORS,
} from '@/app/components/reports/ReportKit';
import { formatReportDate } from '@/app/components/reports/reportTheme';

type ShipmentPDFProps = {
    shipment: Shipment | any;
    type: 'received' | 'sent';
    historyGroup?: any;
};

/** Shipment certificate (received / sent) on the unified report template. */
export const ShipmentPDFDocument = React.forwardRef<HTMLDivElement, ShipmentPDFProps>(
    ({ shipment, type, historyGroup }, ref) => {
        const isReceived = type === 'received';

        const titleHe = isReceived ? 'תעודת קבלת משלוח' : 'תעודת משלוח';
        const titleEn = isReceived ? 'SHIPMENT RECEIPT CERTIFICATE' : 'SHIPMENT CERTIFICATE';
        const shipmentCode: string | undefined = isReceived ? shipment.shipment_code : historyGroup?.sent_shipment_code;
        const date = formatReportDate(isReceived ? shipment.shipment_date : historyGroup?.sent_date);
        const workerName: string | undefined = isReceived
            ? shipment.recieving_worker_name
            : historyGroup?.sending_worker_name;
        const items: any[] = isReceived ? (shipment.shipment_items || []) : (historyGroup?.items || []);
        const signaturePath: string | undefined = isReceived ? shipment.signature_path : historyGroup?.signature_path;
        const qty = (it: any) => Number(it.quantity ?? it.amount ?? 0);
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
                            { header: 'סוג מארז', render: (r: any) => r.item_type_desc || 'לא צוין' },
                            { header: 'מק״ט', width: '160px', mono: true, render: (r: any) => r.makat || '—' },
                            { header: 'כמות', width: '80px', align: 'center', render: (r: any) => qty(r) },
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
