"use client";
import React, { useEffect, useState, useMemo } from "react";
import {
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Box,
    Toolbar,
    Stack,
    IconButton,
    Button,
    Fab,
    Snackbar,
    Alert,
    Skeleton,
    Chip,
    useTheme,
    alpha,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Typography
} from "@mui/material";
import SearchableCombobox from "../common/SearchableCombobox";
import { Add as AddIcon } from "@/components/ui/icons";
import { Search as SearchIcon } from "@/components/ui/icons";
import { Clear as ClearIcon } from "@/components/ui/icons";
import { TableVirtuoso } from "react-virtuoso";
import { Shipment } from "@/types";
import ShipmentInsertPopup from "./ShipmentInsertPopup";
import ShipmentUpdatePopup from "./ShipmentUpdatePopup";
import ShipmentSendPopup from "./ShipmentSendPopup";
import ShipmentHistoryPopup from "./ShipmentHistoryPopup";
import {
    Send as SendIcon,
    History as HistoryIcon,
    PictureAsPdf as PictureAsPdfIcon,
    CheckCircle as CheckCircleIcon,
    QrCode2 as QrCode2Icon,
    Delete as DeleteIcon,
    Edit as EditIcon
} from "@/components/ui/icons";
import Tooltip from "@mui/material/Tooltip";
import { useReactToPrint } from 'react-to-print';
import { ShipmentPDFDocument } from './ShipmentPDFDocument';
import ShipmentBarcodesDialog from './ShipmentBarcodesDialog';

export default function ShipmentTable() {
    const theme = useTheme();
    const [rows, setRows] = useState<Shipment[]>([]);
    const [customers, setCustomers] = useState<{ id: number; customer_code: string }[]>([]);
    const [loading, setLoading] = useState(true);

    // Filtering
    const [search, setSearch] = useState("");
    const [customerFilter, setCustomerFilter] = useState<string | null>(null);
    const [shipmentCodeFilter, setShipmentCodeFilter] = useState("");
    const [makatFilter, setMakatFilter] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    // Popups
    // Popups
    const [insertOpen, setInsertOpen] = useState(false);
    const [updateOpen, setUpdateOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [barcodesOpen, setBarcodesOpen] = useState(false);
    const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [shipmentToDelete, setShipmentToDelete] = useState<Shipment | null>(null);

    // PDF printing
    const pdfRef = React.useRef<HTMLDivElement>(null);
    const [pdfData, setPdfData] = useState<{ shipment: Shipment | any; type: 'received' | 'sent'; historyGroup?: any } | null>(null);

    const handlePrint = useReactToPrint({
        contentRef: pdfRef,
    });

    const handlePDFClick = (shipment: Shipment) => {
        setPdfData({ shipment, type: 'received' });
        setTimeout(() => handlePrint(), 100);
    };

    // Snackbar
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState("");
    const [snackbarSeverity, setSnackbarSeverity] = useState<"success" | "error">("success");

    const loadShipments = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/shipments");
            const data = await res.json();
            setRows(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to load shipments", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadShipments();
        // Load customers for filter
        (async () => {
            try {
                const res = await fetch("/api/customers");
                const data = await res.json();
                setCustomers(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error("Failed to load customers", error);
            }
        })();
    }, []);

    // Customer options for filter from database
    const customerOptions = useMemo(() => {
        return customers.map(c => c.customer_code).sort();
    }, [customers]);

    const filteredRows = useMemo(() => {
        if (!Array.isArray(rows)) return [];
        return rows.filter((row) => {
            // Search filter (general search)
            if (search.trim()) {
                const q = search.toLowerCase();
                const matchesSearch =
                    row.shipment_code.toLowerCase().includes(q) ||
                    row.customer_code.toLowerCase().includes(q) ||
                    row.makat?.toString().includes(q) ||
                    row.source_desc?.toLowerCase().includes(q);
                if (!matchesSearch) return false;
            }
            // Customer filter
            if (customerFilter) {
                if (row.customer_code !== customerFilter) return false;
            }
            // Shipment code filter
            if (shipmentCodeFilter.trim()) {
                if (!row.shipment_code.toLowerCase().includes(shipmentCodeFilter.toLowerCase())) return false;
            }
            // Makat filter
            if (makatFilter.trim()) {
                if (!row.makat?.toString().includes(makatFilter)) return false;
            }

            // Date Range filter
            if (startDate) {
                if (new Date(row.shipment_date) < new Date(startDate)) return false;
            }
            if (endDate) {
                if (new Date(row.shipment_date) > new Date(endDate)) return false;
            }
            return true;
        });
    }, [rows, search, customerFilter, shipmentCodeFilter, makatFilter, startDate, endDate]);

    const clearFilters = () => {
        setSearch("");
        setCustomerFilter(null);
        setShipmentCodeFilter("");
        setMakatFilter("");
        setStartDate("");
        setEndDate("");
    };

    const handleInsertResult = (success: boolean) => {
        if (success) {
            setSnackbarMessage("המשלוח נוצר בהצלחה");
            setSnackbarSeverity("success");
            loadShipments();
        } else {
            setSnackbarMessage("שגיאה ביצירת המשלוח");
            setSnackbarSeverity("error");
        }
        setSnackbarOpen(true);
    };

    const handleUpdateResult = (success: boolean) => {
        if (success) {
            setSnackbarMessage("המשלוח עודכן בהצלחה");
            setSnackbarSeverity("success");
            loadShipments();
        } else {
            setSnackbarMessage("שגיאה בעדכון המשלוח");
            setSnackbarSeverity("error");
        }
        setSnackbarOpen(true);
    };

    const handleRowClick = (row: Shipment) => {
        setSelectedShipment(row);
        setUpdateOpen(true);
    };
    if (loading) {
        return (
            <Paper sx={{ height: 600, p: 2 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} variant="rectangular" height={50} sx={{ my: 1 }} />
                ))}
            </Paper>
        );
    }

    const handleDelete = async () => {
        if (!shipmentToDelete) return;
        try {
            const res = await fetch(`/api/shipments/${shipmentToDelete.id}`, { method: 'DELETE' });
            if (res.ok) {
                setSnackbarMessage("המשלוח נמחק בהצלחה");
                setSnackbarSeverity("success");
                loadShipments();
            } else {
                const data = await res.json();
                setSnackbarMessage(data.error || "שגיאה במחיקת המשלוח");
                setSnackbarSeverity("error");
            }
        } catch {
            setSnackbarMessage("שגיאת תקשורת");
            setSnackbarSeverity("error");
        } finally {
            setSnackbarOpen(true);
            setDeleteDialogOpen(false);
            setShipmentToDelete(null);
        }
    };
    // בדיקה לפני פתיחת דיאלוג
    const initiateDelete = (row: Shipment) => {
        // התנאי שביקשת
        const isRestricted = row.is_sent || (row.valid_amount ?? 0) > 0 || (row.sampled_amount ?? 0) > 0;
        if (isRestricted) {
            setSnackbarMessage("לא ניתן למחוק משלוח שכבר נכנס לניהול פריטים או שנשלח");
            setSnackbarSeverity("error");
            setSnackbarOpen(true);
        } else {
            setShipmentToDelete(row);
            setDeleteDialogOpen(true);
        }
    };

    return (
        <>
            {/* Filter Bar */}
            <Paper
                elevation={0}
                sx={{
                    p: 2,
                    mb: 3,
                    borderRadius: `${theme.tokens.radius.card}px`,
                    bgcolor: "#fff",
                    border: `1px solid ${theme.palette.divider}`,
                }}
            >
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: '100%' }} alignItems={{ md: 'center' }}>
                        <TextField
                            placeholder="חפש לפי קוד, לקוח, תיאור..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            size="small"
                            sx={{ flex: 2 }}
                            InputProps={{
                                startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />,
                            }}
                        />
                        <Box sx={{ flex: 1, minWidth: 180 }}>
                            <SearchableCombobox<string>
                                options={customerOptions}
                                getOptionLabel={(o) => o}
                                value={customerFilter}
                                onChange={(v) => setCustomerFilter(v)}
                                placeholder="סנן לפי לקוח"
                            />
                        </Box>
                        <TextField
                            type="date"
                            label="מתאריך"
                            size="small"
                            InputLabelProps={{ shrink: true }}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            sx={{ flex: 0.5, minWidth: 160 }}
                        />
                        <TextField
                            type="date"
                            label="עד תאריך"
                            size="small"
                            InputLabelProps={{ shrink: true }}
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            sx={{ flex: 0.5, minWidth: 160 }}
                        />
                        <Button
                            onClick={clearFilters}
                            variant="outlined"
                            color="inherit"
                            startIcon={<ClearIcon sx={{ ml: 1 }} />}
                            sx={{ borderColor: 'rgba(0,0,0,0.12)', color: 'text.secondary', whiteSpace: 'nowrap' }}
                        >
                            נקה
                        </Button>
                    </Stack>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon sx={{ ml: 1 }} />}
                        onClick={() => setInsertOpen(true)}
                        sx={{
                            px: 4,
                            py: 1.2,
                            borderRadius: 9999,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        משלוח חדש
                    </Button>
                </Stack>

                {/* Active filter chips — each ✕ clears that one filter */}
                {(search || customerFilter || startDate || endDate) && (
                    <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
                        {search && (
                            <Chip label={`חיפוש: ${search}`} onDelete={() => setSearch("")} size="small" sx={{ borderRadius: 9999 }} />
                        )}
                        {customerFilter && (
                            <Chip label={`לקוח: ${customerFilter}`} onDelete={() => setCustomerFilter(null)} size="small" color="primary" variant="outlined" sx={{ borderRadius: 9999 }} />
                        )}
                        {startDate && (
                            <Chip label={`מתאריך: ${startDate}`} onDelete={() => setStartDate("")} size="small" sx={{ borderRadius: 9999 }} />
                        )}
                        {endDate && (
                            <Chip label={`עד תאריך: ${endDate}`} onDelete={() => setEndDate("")} size="small" sx={{ borderRadius: 9999 }} />
                        )}
                    </Stack>
                )}
            </Paper>

            {/* Table Container */}
            <Paper
                elevation={0}
                sx={{
                    height: "70vh",
                    borderRadius: `${theme.tokens.radius.card}px`,
                    overflow: 'hidden',
                    bgcolor: "#fff",
                    border: `1px solid ${theme.palette.divider}`,
                }}
            >
                <TableVirtuoso
                    data={filteredRows}
                    components={{
                        Scroller: TableContainer,
                        Table: (props) => <Table {...props} stickyHeader sx={{ borderCollapse: 'collapse' }} />,
                        TableHead: React.forwardRef((props, ref) => <TableHead {...props} ref={ref} sx={{ "& th": { bgcolor: "#f5f5f7", borderBottom: `1px solid ${theme.palette.divider}`, zIndex: 10 } }} />),
                        // Dense rows with zebra striping + hover highlight.
                        TableRow: ({ item, ...props }) => <TableRow {...props} sx={{ cursor: "pointer", bgcolor: "#fff", "&:nth-of-type(even) td": { bgcolor: theme.tokens.surface.subtle }, "&:hover td": { bgcolor: `${alpha(theme.palette.primary.main, 0.06)} !important` } }} />,
                        TableBody: React.forwardRef((props, ref) => <TableBody {...props} ref={ref} />),
                    }}
                    fixedHeaderContent={() => (
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>מקור</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>מס׳ משלוח</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>קוד לקוח</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>תאריך קבלה</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>עובד מקבל</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>כמות כוללת</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>כמות מדגם</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>תת פריטים</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>כמות תקינה</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary', borderBottom: '2px solid rgba(0,0,0,0.05)' }}>פעולות</TableCell>
                        </TableRow>
                    )}
                    itemContent={(_, row) => (
                        <>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>{row.source_desc || '-'}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)', fontWeight: 600 }}>{row.shipment_code}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>
                                <Box sx={{ px: 1, py: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main, borderRadius: 2, display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: '0.875rem', fontWeight: 500 }}>
                                    {row.customer_code}
                                    {row.is_sent && (
                                        <Tooltip title={`הסתיים ב: ${new Date(row.finished_at!).toLocaleDateString("he-IL")}`}>
                                            <CheckCircleIcon color="success" fontSize="small" />
                                        </Tooltip>
                                    )}
                                </Box>
                            </TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>
                                {new Date(row.shipment_date).toLocaleDateString("he-IL")}
                            </TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>{row.recieving_worker_name || '-'}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)', fontWeight: 700 }}>{row.amount}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>{row.sampled_amount || 0}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>{row.sub_items_sampled_amount || 0}</TableCell>
                            <TableCell onClick={() => handleRowClick(row)} sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>{row.valid_amount || 0}</TableCell>
                            <TableCell sx={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>
                                <Stack direction="row" spacing={1.5} justifyContent="space-between">
                                    <Tooltip title="מחיקת משלוח">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); initiateDelete(row); }}
                                            sx={{
                                                color: theme.palette.error.main,
                                                bgcolor: alpha(theme.palette.error.main, 0.1),
                                                '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) }
                                            }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {/* <Tooltip title="מחיקת משלוח">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); initiateDelete(row); }}
                                            sx={{
                                                color: theme.palette.error.main,
                                                bgcolor: alpha(theme.palette.error.main, 0.1),
                                                '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) }
                                            }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip> */}
                                    {/* <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} slotProps={{
                                        backdrop: {
                                            sx: {
                                                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                                backdropFilter: 'blur',
                                            },
                                        },
                                    }}>
                                        <DialogTitle>מחיקת משלוח</DialogTitle>
                                        <DialogContent>
                                            האם אתה בטוח שברצונך למחוק את משלוח {shipmentToDelete?.shipment_code}? פעולה זו אינה הפיכה.
                                        </DialogContent>
                                        <DialogActions>
                                            <Button onClick={() => setDeleteDialogOpen(false)}>ביטול</Button>
                                            <Button onClick={handleDelete} color="error" variant="contained">מחק</Button>
                                        </DialogActions>
                                    </Dialog> */}
                                    <Tooltip title="עריכת משלוח">
                                        <IconButton onClick={(e) => { e.stopPropagation(); handleRowClick(row); }} size="small" sx={{ color: theme.palette.text.secondary, bgcolor: alpha(theme.palette.text.primary, 0.06), '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.12) } }}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="החזר משלוח">
                                        <IconButton onClick={(e) => { e.stopPropagation(); setSelectedShipment(row); setSendOpen(true); }} size="small" sx={{ color: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.1), '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) } }}>
                                            <SendIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="היסטוריה">
                                        <IconButton onClick={(e) => { e.stopPropagation(); setSelectedShipment(row); setHistoryOpen(true); }} size="small" sx={{ color: theme.palette.info.main, bgcolor: alpha(theme.palette.info.main, 0.1), '&:hover': { bgcolor: alpha(theme.palette.info.main, 0.2) } }}>
                                            <HistoryIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="הורד PDF">
                                        <IconButton onClick={(e) => { e.stopPropagation(); handlePDFClick(row); }} size="small" sx={{ color: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.1), '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) } }}>
                                            <PictureAsPdfIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="הדפס ברקודים לכל הפריטים">
                                        <IconButton onClick={(e) => { e.stopPropagation(); setSelectedShipment(row); setBarcodesOpen(true); }} size="small" sx={{ color: theme.palette.success.main, bgcolor: alpha(theme.palette.success.main, 0.1), '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.2) } }}>
                                            <QrCode2Icon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>
                            </TableCell>
                        </>
                    )}
                />
            </Paper>
            {/* Delete Confirmation Dialog - ממוקם פעם אחת בלבד מחוץ לטבלה */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                PaperProps={{ sx: { borderRadius: 3 } }}
            >
                <DialogTitle>מחיקת משלוח</DialogTitle>
                <DialogContent>
                    <Typography>
                        האם אתה בטוח שברצונך למחוק את משלוח <strong>{shipmentToDelete?.shipment_code}</strong>?
                        פעולה זו אינה הפיכה.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setDeleteDialogOpen(false)}>ביטול</Button>
                    <Button onClick={handleDelete} color="error" variant="contained">מחק</Button>
                </DialogActions>
            </Dialog>

            <ShipmentInsertPopup
                open={insertOpen}
                onClose={() => setInsertOpen(false)}
                onCreate={handleInsertResult}
                existingShipments={rows}
            />

            <ShipmentUpdatePopup
                open={updateOpen}
                onClose={() => setUpdateOpen(false)}
                onUpdate={handleUpdateResult}
                shipment={selectedShipment}
            />

            <ShipmentSendPopup
                open={sendOpen}
                onClose={() => setSendOpen(false)}
                onSend={(success) => {
                    if (success) {
                        setSnackbarMessage("המשלוח נשלח בהצלחה");
                        setSnackbarSeverity("success");
                        loadShipments();
                    } else {
                        setSnackbarMessage("שגיאה בשליחת המשלוח");
                        setSnackbarSeverity("error");
                    }
                    setSnackbarOpen(true);
                }}
                shipment={selectedShipment}
            />

            <ShipmentHistoryPopup
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                shipment={selectedShipment}
            />

            <ShipmentBarcodesDialog
                open={barcodesOpen}
                onClose={() => setBarcodesOpen(false)}
                shipment={selectedShipment}
            />

            <Snackbar
                open={snackbarOpen}
                autoHideDuration={4000}
                onClose={() => setSnackbarOpen(false)}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert onClose={() => setSnackbarOpen(false)} severity={snackbarSeverity} sx={{ width: "100%" }}>
                    {snackbarMessage}
                </Alert>
            </Snackbar>

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
        </>
    );
}
