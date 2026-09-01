"use client";
/* eslint-disable @next/next/no-img-element -- this tree is rendered into the
   react-to-print / PDF pipeline, where next/image's lazy loading and srcset
   never resolve. Plain <img> is required here. */
import React from 'react';
import { Shipment } from '@/types';

type ShipmentPDFProps = {
    shipment: Shipment | any;
    type: 'received' | 'sent';
    historyGroup?: any;
};

export const ShipmentPDFDocument = React.forwardRef<HTMLDivElement, ShipmentPDFProps>(
    ({ shipment, type, historyGroup }, ref) => {
        const isReceived = type === 'received';

        const title = isReceived ? 'קבלת משלוח' : 'תעודת משלוח';
        const shipmentCode = isReceived ? shipment.shipment_code : historyGroup?.sent_shipment_code;
        const date = isReceived
            ? new Date(shipment.shipment_date).toLocaleDateString('he-IL')
            : new Date(historyGroup?.sent_date).toLocaleDateString('he-IL');
        const workerName = isReceived
            ? shipment.recieving_worker_name
            : historyGroup?.sending_worker_name;
        const items = isReceived ? (shipment.shipment_items || []) : (historyGroup?.items || []);
        const signaturePath = isReceived ? shipment.signature_path : historyGroup?.signature_path;

        return (
            <div ref={ref} style={{ padding: '40px', fontFamily: 'Arial, sans-serif', direction: 'rtl' }}>
                {/* Title */}
                <h1 style={{ textAlign: 'center', fontSize: '28px', marginBottom: '20px' }}>
                    {title}
                </h1>

                {/* Current Date */}
                <p style={{ textAlign: 'right', marginBottom: '10px' }}>
                    <strong>תאריך הדפסה:</strong> {new Date().toLocaleDateString('he-IL')}
                </p>

                {/* Shipment Details */}
                <div style={{ marginBottom: '20px', lineHeight: '1.8' }}>
                    <p style={{ margin: '5px 0' }}>
                        <strong>מס׳ משלוח:</strong> {shipmentCode}
                    </p>
                    <p style={{ margin: '5px 0' }}>
                        <strong>תאריך משלוח:</strong> {date}
                    </p>
                    <p style={{ margin: '5px 0' }}>
                        <strong>עובד:</strong> {workerName || 'לא צוין'}
                    </p>
                    {isReceived && shipment.customer_code && (
                        <p style={{ margin: '5px 0' }}>
                            <strong>קוד לקוח:</strong> {shipment.customer_code}
                        </p>
                    )}
                </div>

                {/* Items Table */}
                <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    marginTop: '20px',
                    marginBottom: '30px'
                }}>
                    <thead>
                        <tr style={{ backgroundColor: '#4286f4', color: 'white' }}>
                            <th style={{ border: '1px solid #ddd', padding: '12px', textAlign: 'right' }}>
                                תיאור פריט
                            </th>
                            <th style={{ border: '1px solid #ddd', padding: '12px', textAlign: 'right' }}>
                                מקט
                            </th>
                            <th style={{ border: '1px solid #ddd', padding: '12px', textAlign: 'right' }}>
                                כמות
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item: any, idx: number) => (
                            <tr key={idx}>
                                <td style={{ border: '1px solid #ddd', padding: '10px', textAlign: 'right' }}>
                                    {item.item_type_desc || 'לא צוין'}
                                </td>
                                <td style={{ border: '1px solid #ddd', padding: '10px', textAlign: 'right' }}>
                                    {item.makat || '-'}
                                </td>
                                <td style={{ border: '1px solid #ddd', padding: '10px', textAlign: 'right' }}>
                                    {item.quantity || item.amount || 0}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Signature Section */}
                <div style={{ marginTop: '40px' }}>
                    <p style={{ marginBottom: '10px' }}>
                        <strong>חתימה:</strong>
                    </p>
                    {signaturePath ? (
                        <img
                            src={signaturePath}
                            alt="חתימה"
                            style={{
                                maxWidth: '200px',
                                height: 'auto',
                                border: '1px solid #ddd',
                                padding: '5px'
                            }}
                        />
                    ) : (
                        <p style={{ fontStyle: 'italic', color: '#666' }}>
                            (אין חתימה דיגיטלית)
                        </p>
                    )}
                </div>
            </div>
        );
    }
);

ShipmentPDFDocument.displayName = 'ShipmentPDFDocument';
