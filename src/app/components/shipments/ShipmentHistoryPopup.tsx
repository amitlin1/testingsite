"use client";
import React, { useEffect, useState, useMemo } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Box,
    CircularProgress,
    IconButton
} from "@/components/ui";
import { PictureAsPdf as PictureAsPdfIcon } from "@/components/ui/icons";
import { useReactToPrint } from 'react-to-print';
import { ShipmentPDFDocument } from './ShipmentPDFDocument';
import { Shipment } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";
import { apiFetch } from "@/lib/api/client";

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
    // instead of one render behind.
    const [loaded, setLoaded] = useState<{ shipmentId: number; rows: HistoryLog[] } | null>(null);
    const loading = open && shipment != null && loaded?.shipmentId !== shipment.id;
    const history = loaded && shipment && loaded.shipmentId === shipment.id ? loaded.rows : NO_HISTORY;

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
                setLoaded({ shipmentId, rows: Array.isArray(data) ? data : NO_HISTORY });
            })
            .catch(err => {
                if (cancelled) return;
                console.error(err);
                setLoaded({ shipmentId, rows: NO_HISTORY });
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
                    sending_worker_name: log.sending_worker_name || 'Unknown',
                    items: [],
                    totalSentInGroup: 0,
                    signature_path: log.signature_path
                };
            }

            groups[key].items.push({
                item_type_desc: log.item_type_desc || 'Unknown',
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

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle>היסטוריית שליחות - {shipment.shipment_code}</DialogTitle>
            <DialogContent>
                {loading ? <CircularProgress /> : (
                    <>
                        {/* Summary Section */}
                        <Box sx={{ mb: 3, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                            <Typography variant="h6" gutterBottom>סיכום</Typography>
                            <Typography variant="subtitle1" fontWeight="bold">
                                כמות התקבלה:  {progressStats.totalReceived}
                            </Typography>
                            <Typography variant="subtitle1" fontWeight="bold">
                                כמות נשלחה: {progressStats.totalSent}
                            </Typography>
                            <Box sx={{ mt: 1, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {progressStats.items.map((stat, idx) => (
                                    <Typography key={idx} variant="body2">
                                        {stat.desc} (מקט: {stat.makat || '-'}): {stat.sent} / {stat.received}
                                    </Typography>
                                ))}
                            </Box>
                        </Box>

                        {/* History Table */}
                        <TableContainer component={Paper}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>תאריך</TableCell>
                                        <TableCell>מס׳ משלוח</TableCell>
                                        <TableCell>עובד שולח</TableCell>
                                        <TableCell>תיאור פריט</TableCell>
                                        <TableCell>כמות נשלחה</TableCell>
                                        <TableCell>PDF</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {groupedHistory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center">No history found</TableCell>
                                        </TableRow>
                                    ) : (
                                        groupedHistory.map((group) => (
                                            <TableRow key={group.groupKey}>
                                                <TableCell>
                                                    {new Date(group.sent_date).toLocaleDateString('en-GB')}
                                                </TableCell>
                                                <TableCell>{group.sent_shipment_code}</TableCell>
                                                <TableCell>{group.sending_worker_name}</TableCell>
                                                <TableCell>
                                                    {group.items.map((item, idx) => (
                                                        <div key={idx}>
                                                            {item.item_type_desc} (Makat: {item.makat || '-'}) - <b>{item.amount}</b>
                                                        </div>
                                                    ))}
                                                </TableCell>
                                                <TableCell>{group.totalSentInGroup}</TableCell>
                                                <TableCell>
                                                    <IconButton onClick={() => handlePDFClick(group)}>
                                                        <PictureAsPdfIcon />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>סגור</Button>
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
