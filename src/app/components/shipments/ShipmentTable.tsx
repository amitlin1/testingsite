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
    Autocomplete,
    FormControl,
    InputLabel,
    MenuItem,
    useTheme,
    alpha
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
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
    QrCode2 as QrCode2Icon
} from "@mui/icons-material";
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
            setSnackbarMessage("Shipment created successfully");
            setSnackbarSeverity("success");
            loadShipments();
        } else {
            setSnackbarMessage("Failed to create shipment");
            setSnackbarSeverity("error");
        }
        setSnackbarOpen(true);
    };

    const handleUpdateResult = (success: boolean) => {
        if (success) {
            setSnackbarMessage("Shipment updated successfully");
            setSnackbarSeverity("success");
            loadShipments();
        } else {
            setSnackbarMessage("Failed to update shipment");
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

    return (
        <>
            {/* Filter Bar */}
            <Paper
                elevation={3}
                sx={{
                    p: 2,
                    mb: 3,
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.8)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.15)"
                }}
            >
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: '100%' }}>
                        <TextField
                            placeholder="חפש לפי קוד, לקוח, תיאור..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            sx={{ flex: 2, bgcolor: 'rgba(255,255,255,0.5)', borderRadius: 2 }}
                            InputProps={{
                                startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />,
                                sx: { borderRadius: 2 }
                            }}
                        />
                        <Autocomplete
                            options={customerOptions}
                            value={customerFilter}
                            onChange={(_, v) => setCustomerFilter(v)}
                            sx={{ flex: 1, bgcolor: 'rgba(255,255,255,0.5)', borderRadius: 2 }}
                            renderInput={(params) => <TextField {...params} label="סנן לפי לקוח" sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />}
                        />
                        <TextField
                            type="date"
                            label="מתאריך"
                            InputLabelProps={{ shrink: true }}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            sx={{ flex: 0.5, bgcolor: 'rgba(255,255,255,0.5)', borderRadius: 2 }}
                            InputProps={{ sx: { borderRadius: 2 } }}
                        />
                        <TextField
                            type="date"
                            label="עד תאריך"
                            InputLabelProps={{ shrink: true }}
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            sx={{ flex: 0.5, bgcolor: 'rgba(255,255,255,0.5)', borderRadius: 2 }}
                            InputProps={{ sx: { borderRadius: 2 } }}
                        />
                        <Button
                            onClick={clearFilters}
                            variant="outlined"
                            color="inherit"
                            startIcon={<ClearIcon />}
                            sx={{ borderRadius: 2, borderColor: 'rgba(0,0,0,0.12)' }}
                        >
                            נקה
                        </Button>
                    </Stack>

                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setInsertOpen(true)}
                        sx={{
                            px: 4,
                            py: 1.5,
                            borderRadius: 3,
                            fontWeight: 700,
                            boxShadow: "0 8px 16px rgba(25, 118, 210, 0.2)",
                            background: "linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)",
                            whiteSpace: 'nowrap',
                            "&:hover": { transform: "translateY(-1px)", boxShadow: "0 12px 20px rgba(25, 118, 210, 0.3)" }
                        }}
                    >
                        משלוח חדש
                    </Button>
                </Stack>
            </Paper>

            {/* Table Container */}
            <Paper
                sx={{
                    height: "70vh",
                    borderRadius: 4,
                    overflow: 'hidden',
                    background: "rgba(255, 255, 255, 0.8)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.15)"
                }}
            >
                <TableVirtuoso
                    data={filteredRows}
                    components={{
                        Scroller: TableContainer,
                        Table: (props) => <Table {...props} stickyHeader sx={{ borderCollapse: 'separate', borderSpacing: '0 8px' }} />,
                        TableHead: React.forwardRef((props, ref) => <TableHead {...props} ref={ref} sx={{ "& th": { bgcolor: "rgba(255, 255, 255, 0.9)", backdropFilter: "blur(10px)", borderBottom: 'none', zIndex: 10 } }} />),
                        TableRow: ({ item, ...props }) => <TableRow {...props} sx={{ "&:hover td": { bgcolor: "rgba(25, 118, 210, 0.08) !important" }, cursor: "pointer", bgcolor: "rgba(255,255,255,0.4)" }} />,
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
                                <Stack direction="row" spacing={2} justifyContent="space-between">
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
