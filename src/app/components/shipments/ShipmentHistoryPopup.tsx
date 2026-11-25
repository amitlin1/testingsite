"use client";
import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ShipmentPDFDocument, type SentGroup, type ShipmentPdfData } from './ShipmentPDFDocument';
import { Shipment, type ShipmentSend } from "@/app/lib/shipments/contract";
import { sendProgress } from "@/app/lib/shipments/send";
import { formatDate } from "@/app/lib/datetime";
import { dateInputValue } from "@/app/lib/shipments/form";
import { getArray } from "@/lib/api/client";
import { usePrintWhenReady } from "@/lib/hooks/usePrintWhenReady";

const EM_DASH = "—";

type ShipmentHistoryPopupProps = {
    open: boolean;
    onClose: () => void;
    shipment: Shipment | null;
};

/** The sends under one outgoing code and day: one row of the table, one certificate. */
type GroupedHistory = SentGroup & { groupKey: string; totalSentInGroup: number };

/** Stable empty array, so the memos below don't see a new reference each render. */
const NO_HISTORY: ShipmentSend[] = [];

/** A shipment's returns (GET /api/shipment-history/[id]) — read by this popup, made stale by a send. */
export const shipmentSendsKey = (shipmentId: number | undefined) => ["shipment-history", shipmentId] as const;

export default function ShipmentHistoryPopup({
    open,
    onClose,
    shipment,
}: ShipmentHistoryPopupProps) {
    // Read once per shipment (its returns, by id); a send marks it stale (shipmentSendsKey). `failed`
    // keeps a failed load apart from a shipment that simply has no returns yet.
    const historyQ = useQuery({
        queryKey: shipmentSendsKey(shipment?.id),
        enabled: open && shipment != null,
        queryFn: () => getArray<ShipmentSend>(`/api/shipment-history/${shipment!.id}`),
        staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    });
    const loading = historyQ.isFetching && historyQ.data === undefined;
    const history = historyQ.data ?? NO_HISTORY;
    const failed = historyQ.isError && !historyQ.isFetching;

    const pdfRef = React.useRef<HTMLDivElement>(null);
    const [pdfData, setPdfData] = useState<ShipmentPdfData | null>(null);
    const handlePrint = useReactToPrint({ contentRef: pdfRef });
    const printPdf = usePrintWhenReady(handlePrint);

    const handlePDFClick = (group: GroupedHistory) => {
        if (!shipment) return;
        setPdfData({ shipment, type: 'sent', historyGroup: group });
        printPdf();
    };

    const groupedHistory = useMemo(() => {
        const groups: Record<string, GroupedHistory> = {};

        history.forEach(log => {
            const dateStr = dateInputValue(log.sent_date);
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

        return Object.values(groups).sort((a, b) => new Date(b.sent_date).getTime() - new Date(a.sent_date).getTime());
    }, [history]);

    const progressStats = useMemo(() => {
        if (!shipment) return { totalSent: 0, totalReceived: 0, items: [] };
        return {
            totalSent: history.reduce((n, h) => n + h.amount, 0),
            totalReceived: shipment.amount || 0,
            items: sendProgress(shipment.shipment_items || [], history),
        };
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
                        action={<Button variant="text" size="small" onClick={() => void historyQ.refetch()}>נסה שוב</Button>}
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

            {/* What the printer gets; on screen it stays hidden. */}
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
