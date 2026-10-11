"use client";
import React, { useEffect, useState, useMemo } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    Skeleton,
} from "@/components/ui";
import { PictureAsPdf as PdfIcon } from "@/components/ui/icons";
import DataTable, { IconAction, type Column } from "@/components/DataTable";
import { useReactToPrint } from 'react-to-print';
import { ShipmentPDFDocument } from './ShipmentPDFDocument';
import { Shipment } from "@/types";
import { DISPLAY_TIMEZONE, formatDate } from "@/app/lib/datetime";
import { apiFetch } from "@/lib/api/client";

const EM_DASH = "—";

type ShipmentHistoryPopupProps = {
    open: boolean;
    onClose: () => void;
    shipment: Shipment | null;
};

type HistoryLog = {
    log_id: number;
    shipment_id: number;
    sent_shipment_code: string;
    sent_date: string;
    sending_worker_id: number | null;
    sending_worker_name: string | null;
    item_type_id: number;
    item_type_desc: string | null;
    makat: number | null;
    amount: number;
    signature_path: string | null;
};

type GroupedHistory = {
    groupKey: string;
    sent_shipment_code: string;
    sent_date: string;
    sending_worker_name: string;
    items: {
        item_type_desc: string;
        makat: number | null;
        amount: number;
    }[];
    totalSentInGroup: number;
    signature_path?: string | null;
};

/** Stable empty array, so the memos below don't see a new reference each render. */
const NO_HISTORY: HistoryLog[] = [];

export default function ShipmentHistoryPopup({
    open,
    onClose,
    shipment,
}: ShipmentHistoryPopupProps) {
    // One piece of state describing what we hold and who it belongs to. `loading`
    // and `history` are derived from it, so they are correct on the first render
    // instead of one render behind. `failed` keeps a failed load apart from a
    // shipment that simply has no returns yet.
    const [loaded, setLoaded] = useState<{ shipmentId: number; rows: HistoryLog[]; failed?: boolean } | null>(null);
    const loading = open && shipment != null && loaded?.shipmentId !== shipment.id;
    const current = loaded && shipment && loaded.shipmentId === shipment.id ? loaded : null;
    const history = current ? current.rows : NO_HISTORY;
    const failed = current?.failed === true;

    // PDF printing
    const pdfRef = React.useRef<HTMLDivElement>(null);
    const [pdfData, setPdfData] = useState<{ shipment: Shipment | any; type: 'received' | 'sent'; historyGroup?: any } | null>(null);

    const handlePrint = useReactToPrint({
        contentRef: pdfRef,
    });

    const handlePDFClick = (group: GroupedHistory) => {
        setPdfData({ shipment, type: 'sent', historyGroup: group });
        setTimeout(() => handlePrint(), 100);
    };

    useEffect(() => {
        if (!open || !shipment) return;
        if (loaded?.shipmentId === shipment.id) return; // already have this one

        const shipmentId = shipment.id;
        let cancelled = false;
        apiFetch(`/api/shipment-history/${shipmentId}`)
            .then(res => res.json())
            .then(data => {
                if (cancelled) return;
                if (!Array.isArray(data)) console.error("Failed to load history", data);
                setLoaded({ shipmentId, rows: Array.isArray(data) ? data : NO_HISTORY, failed: !Array.isArray(data) });
            })
            .catch(err => {
                if (cancelled) return;
                console.error(err);
                setLoaded({ shipmentId, rows: NO_HISTORY, failed: true });
            });
        // Discard a response that arrives after the popup moved to another
        // shipment, which previously could render 42's history under 43's title.
        return () => { cancelled = true; };
    }, [open, shipment, loaded]);

    // Grouping Logic
    const groupedHistory = useMemo(() => {
        const groups: Record<string, GroupedHistory> = {};

        history.forEach(log => {
            const dateStr = new Date(log.sent_date).toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
            const key = `${log.sent_shipment_code}_${dateStr}`;

            if (!groups[key]) {
                groups[key] = {
                    groupKey: key,
                    sent_shipment_code: log.sent_shipment_code,
                    sent_date: log.sent_date,
                    // An unknown name is shown as "—", like every missing value.
                    sending_worker_name: log.sending_worker_name || EM_DASH,
                    items: [],
                    totalSentInGroup: 0,
                    signature_path: log.signature_path
                };
            }

            groups[key].items.push({
                item_type_desc: log.item_type_desc || EM_DASH,
                makat: log.makat,
                amount: log.amount
            });
            groups[key].totalSentInGroup += log.amount;
        });

        // Convert to array and sort desc by date (keys might not sort correctly)
        return Object.values(groups).sort((a, b) => new Date(b.sent_date).getTime() - new Date(a.sent_date).getTime());
    }, [history]);

    // Progress Calculations
    const progressStats = useMemo(() => {
        if (!shipment) return { totalSent: 0, totalReceived: 0, items: [] };

        const totalReceived = shipment.amount || 0;
        let totalSent = 0;

        // Map item_type_id + makat -> sent amount
        const sentMap = new Map<string, number>(); // key: typeId_makat, val: sentAmount

        history.forEach(h => {
            totalSent += h.amount;
            const key = `${h.item_type_id}_${h.makat || 'null'}`;
            sentMap.set(key, (sentMap.get(key) || 0) + h.amount);
        });

        // Map received items
        const itemStats = (shipment.shipment_items || []).map(item => {
            const key = `${item.item_type_id}_${item.makat || 'null'}`;
            const sent = sentMap.get(key) || 0;
            return {
                desc: item.item_type_desc,
                makat: item.makat,
                sent: sent,
                received: item.quantity
            };
        });

        return { totalSent, totalReceived, items: itemStats };
    }, [shipment, history]);

    if (!shipment) return null;

    const columns: Column<GroupedHistory>[] = [
        { key: "date", header: "תאריך", nums: true, nowrap: true, cell: (g) => formatDate(g.sent_date) },
        { key: "code", header: "מס׳ משלוח", nums: true, bold: true, nowrap: true, cell: (g) => g.sent_shipment_code },
        { key: "worker", header: "עובד שולח", cell: (g) => g.sending_worker_name },
        {
            key: "items", header: "סוג מארז",
            cell: (g) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {g.items.map((item, idx) => (
                        <div key={idx}>
                            {item.item_type_desc} <span style={{ color: "var(--color-ink-muted-48)" }}>(מק״ט {item.makat || EM_DASH})</span> · <b style={{ fontVariantNumeric: "tabular-nums" }}>{item.amount}</b> מארזים
                        </div>
                    ))}
                </div>
            ),
        },
        { key: "total", header: "כמות נשלחה", align: "center", nums: true, bold: true, cell: (g) => g.totalSentInGroup },
        {
            key: "pdf", header: "PDF", align: "center", width: 56,
            cell: (g) => (
                <IconAction title="הורד PDF" onClick={() => handlePDFClick(g)}>
                    <PdfIcon fontSize={16} aria-hidden />
                </IconAction>
            ),
        },
    ];

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle onClose={onClose}>היסטוריית שליחות — {shipment.shipment_code}</DialogTitle>
            <DialogContent>
                {failed ? (
                    <Alert
                        severity="error"
                        action={<Button variant="text" size="small" onClick={() => setLoaded(null)}>נסה שוב</Button>}
                    >
                        לא הצלחנו לטעון את היסטוריית השליחות של המשלוח. נסה שוב.
                    </Alert>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                        {/* Summary: what came in against what went out, per package type */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                            <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
                                <span>כמות התקבלה <strong style={{ color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{progressStats.totalReceived}</strong></span>
                                <span>
                                    כמות נשלחה{" "}
                                    <strong style={{ color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>
                                        {loading ? <Skeleton variant="text" width={24} height={14} style={{ display: "inline-block", verticalAlign: "middle" }} /> : progressStats.totalSent}
                                    </strong>
                                </span>
                            </div>
                            {!loading && progressStats.items.length > 0 && (
                                <div style={{ display: "flex", gap: "var(--space-xs) var(--space-lg)", flexWrap: "wrap", fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
                                    {progressStats.items.map((stat, idx) => (
                                        <span key={idx}>
                                            {stat.desc} (מק״ט {stat.makat || EM_DASH}):{" "}
                                            <bdi dir="ltr" style={{ color: "var(--color-ink)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{stat.sent} / {stat.received}</bdi>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* History table — skeleton rows while loading */}
                        <DataTable<GroupedHistory>
                            columns={columns}
                            rows={groupedHistory}
                            getRowKey={(g) => g.groupKey}
                            loading={loading}
                            loadingRows={3}
                            minWidth={720}
                            // No frame of its own: the dialog is the surface (no box in a box).
                            plain
                            empty={<div style={{ fontSize: "var(--text-body-sm)" }}>עדיין לא נשלחו מארזים מהמשלוח הזה.</div>}
                        />
                    </div>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>
            </DialogActions>

            {/* Hidden PDF Component for Printing */}
            <div style={{ display: 'none' }}>
                {pdfData && (
                    <ShipmentPDFDocument
                        ref={pdfRef}
                        shipment={pdfData.shipment}
                        type={pdfData.type}
                        historyGroup={pdfData.historyGroup}
                    />
                )}
            </div>
        </Dialog>
    );
}
