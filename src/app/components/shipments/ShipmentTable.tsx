"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Snackbar, Alert, ConfirmDialog, Button, Chip, TextField } from "@/components/ui";
import { Search, Plus, X, Pencil, Trash2, Send, History, FileText, Barcode, Boxes } from "lucide-react";
import DataTable, { StatusPill, RowActions, IconAction, ProgressCell, type Column } from "@/components/DataTable";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { Shipment } from "@/types";
import { formatDate } from "@/app/lib/datetime";
import ShipmentInsertPopup from "./ShipmentInsertPopup";
import ShipmentUpdatePopup from "./ShipmentUpdatePopup";
import ShipmentSendPopup from "./ShipmentSendPopup";
import ShipmentHistoryPopup from "./ShipmentHistoryPopup";
import { useReactToPrint } from "react-to-print";
import { ShipmentPDFDocument } from "./ShipmentPDFDocument";
import ShipmentBarcodesDialog from "./ShipmentBarcodesDialog";
import { apiFetch } from "@/lib/api/client";

const EM_DASH = "—";

/* --- KPI filters ---------------------------------------------------------
 * Testing "started" for a shipment = at least one sampled item is past the
 * untouched state (in work / finished / research, or passed a station —
 * current_route_step is 1-based, so > 1 means a station was completed).
 * The unsent bucket ("במערכת") splits into waitingStart + inProcess.
 */
type KpiKey = "total" | "pending" | "sent" | "inProcess" | "waitingStart" | "readyToSend";

/** When the shipment entered the system; shipments saved before that was
 *  recorded show the certificate's date. */
const receivedOf = (s: Shipment) => s.received_at ?? s.shipment_date;

const startedTesting = (s: Shipment) => (s.started_sampled_amount || 0) > 0;
const isSampleDone = (s: Shipment) =>
    !s.is_sent && (s.sampled_amount || 0) > 0 && (s.finished_sampled_amount || 0) >= (s.sampled_amount || 0);

const KPI_PREDICATES: Record<KpiKey, (s: Shipment) => boolean> = {
    total: () => true,
    pending: (s) => !s.is_sent,
    sent: (s) => !!s.is_sent,
    inProcess: (s) => !s.is_sent && startedTesting(s),
    waitingStart: (s) => !s.is_sent && !startedTesting(s),
    readyToSend: isSampleDone,
};

const KPI_LABELS: Record<KpiKey, string> = {
    total: "סה״כ משלוחים",
    pending: "במערכת",
    sent: "נשלחו",
    inProcess: "בתהליך בדיקה",
    waitingStart: "מחכים להתחלת התהליך",
    readyToSend: "סיימו מסלול — מוכנים לשליחה",
};

/* The order of the filter row: the lifecycle, start to end. */
const KPI_ORDER: KpiKey[] = ["total", "pending", "waitingStart", "inProcess", "readyToSend", "sent"];

/* A date filter is a `YYYY-MM-DD` input value; its chip reads like every other
   date on the screen. */
const chipDate = (value: string) => formatDate(value);

export default function ShipmentTable() {
    const router = useRouter();
    const [rows, setRows] = useState<Shipment[]>([]);
    const [customers, setCustomers] = useState<{ id: number; customer_code: string }[]>([]);
    const [loading, setLoading] = useState(true);
    // A failed load is not an empty list: it gets its own message and a retry.
    const [loadError, setLoadError] = useState(false);

    // Filtering
    const [search, setSearch] = useState("");
    const [customerFilter, setCustomerFilter] = useState<string | null>(null);
    const [shipmentCodeFilter, setShipmentCodeFilter] = useState("");
    const [makatFilter, setMakatFilter] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [kpiFilter, setKpiFilter] = useState<KpiKey | null>(null);

    // Popups
    const [insertOpen, setInsertOpen] = useState(false);
    const [updateOpen, setUpdateOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [barcodesOpen, setBarcodesOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Shipment | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

    // PDF printing
    const pdfRef = React.useRef<HTMLDivElement>(null);
    const [pdfData, setPdfData] = useState<{ shipment: Shipment | any; type: "received" | "sent"; historyGroup?: any } | null>(null);

    const handlePrint = useReactToPrint({ contentRef: pdfRef });

    const handlePDFClick = (shipment: Shipment) => {
        setPdfData({ shipment, type: "received" });
        setTimeout(() => handlePrint(), 100);
    };

    // Snackbar
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState("");
    const [snackbarSeverity, setSnackbarSeverity] = useState<"success" | "error">("success");

    const loadShipments = async () => {
        try {
            setLoading(true);
            setLoadError(false);
            const res = await apiFetch("/api/shipments");
            const data = await res.json();
            // A 4xx/5xx answers with an error object, not a list — say so
            // instead of drawing "no shipments".
            if (!res.ok || !Array.isArray(data)) setLoadError(true);
            setRows(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to load shipments", error);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadShipments();
        // Load customers for filter
        (async () => {
            try {
                const res = await apiFetch("/api/customers");
                const data = await res.json();
                setCustomers(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error("Failed to load customers", error);
            }
        })();
    }, []);

    // Customer options for filter from database
    const customerOptions = useMemo(() => {
        return customers.map((c) => c.customer_code).sort();
    }, [customers]);

    // Rows after the toolbar filters (search/customer/dates) — KPIs are computed
    // from these, so the counters follow the selected filters.
    const baseFilteredRows = useMemo(() => {
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
            // Date Range filter — on the receipt date the table shows.
            if (startDate) {
                if (new Date(receivedOf(row)) < new Date(startDate)) return false;
            }
            if (endDate) {
                if (new Date(receivedOf(row)) > new Date(endDate)) return false;
            }
            return true;
        });
    }, [rows, search, customerFilter, shipmentCodeFilter, makatFilter, startDate, endDate]);

    // Clicking a shipment-count KPI narrows the table on top of the toolbar filters.
    const filteredRows = useMemo(
        () => (kpiFilter ? baseFilteredRows.filter(KPI_PREDICATES[kpiFilter]) : baseFilteredRows),
        [baseFilteredRows, kpiFilter]
    );

    // KPI counters — follow the toolbar filters (but not the KPI selection itself,
    // so the numbers stay stable while toggling tiles).
    const kpis = useMemo(() => {
        let pending = 0, sent = 0, inProcess = 0, waitingStart = 0, sampledTotal = 0, finishedTotal = 0, sampleDone = 0;
        for (const s of baseFilteredRows) {
            if (s.is_sent) sent++;
            else {
                pending++;
                if (startedTesting(s)) inProcess++;
                else waitingStart++;
            }
            sampledTotal += s.sampled_amount || 0;
            finishedTotal += s.finished_sampled_amount || 0;
            if (isSampleDone(s)) sampleDone++;
        }
        // No boxes received → no share to report: "—", never "0%".
        const donePct = sampledTotal > 0 ? Math.round((finishedTotal / sampledTotal) * 100) : null;
        return { total: baseFilteredRows.length, pending, sent, inProcess, waitingStart, sampledTotal, sampleDone, donePct };
    }, [baseFilteredRows]);

    const kpiCount: Record<KpiKey, number> = {
        total: kpis.total,
        pending: kpis.pending,
        waitingStart: kpis.waitingStart,
        inProcess: kpis.inProcess,
        readyToSend: kpis.sampleDone,
        sent: kpis.sent,
    };
    // While loading (or after a failed load) the counts are unknown, not zero.
    const countsKnown = !loading && !loadError;

    const toggleKpi = (key: KpiKey) => setKpiFilter((cur) => (cur === key ? null : key));

    const anyFilter = !!(search.trim() || customerFilter || startDate || endDate || kpiFilter);

    const clearFilters = () => {
        setSearch("");
        setCustomerFilter(null);
        setShipmentCodeFilter("");
        setMakatFilter("");
        setStartDate("");
        setEndDate("");
        setKpiFilter(null);
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

    // The server refuses a shipment that was sent or already has boxes
    // (DELETE /api/shipments/[id]); the row says so before anyone tries.
    const deleteBlockedReason = (s: Shipment): string | null =>
        s.is_sent ? "לא ניתן למחוק משלוח שנשלח"
            : (s.sampled_amount || 0) > 0 ? "לא ניתן למחוק משלוח שנקלטו בו מארזים"
                : null;

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            const res = await apiFetch(`/api/shipments/${deleteTarget.id}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setSnackbarMessage(`משלוח ${deleteTarget.shipment_code} נמחק`);
                setSnackbarSeverity("success");
                setDeleteTarget(null);
                loadShipments();
            } else {
                setSnackbarMessage(data?.error || "שגיאה במחיקת המשלוח");
                setSnackbarSeverity("error");
            }
        } catch {
            setSnackbarMessage("שגיאה בתקשורת");
            setSnackbarSeverity("error");
        } finally {
            setDeleting(false);
            setSnackbarOpen(true);
        }
    };

    // A sent shipment is closed: no editing and no further returns
    // (PUT /api/shipments/[id] and POST /api/shipment-history refuse it too).
    const handleRowClick = (row: Shipment) => {
        if (row.is_sent) return;
        setSelectedShipment(row);
        setUpdateOpen(true);
    };

    const columns: Column<Shipment>[] = [
        { key: "source", header: "מקור", cell: (r) => <span style={{ color: "var(--color-ink-muted-70)" }}>{r.source_desc || EM_DASH}</span> },
        { key: "code", header: "מס׳ משלוח", nums: true, bold: true, nowrap: true, cell: (r) => r.shipment_code },
        {
            key: "customer", header: "קוד לקוח", nowrap: true,
            cell: (r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--color-ink-muted-70)" }}>
                    {r.customer_code}
                    {r.is_sent && <StatusPill label="נשלח" active />}
                </span>
            ),
        },
        { key: "date", header: "תאריך קבלה", nums: true, nowrap: true, cell: (r) => <span style={{ color: "var(--color-ink-muted-70)" }}>{formatDate(receivedOf(r))}</span> },
        { key: "worker", header: "עובד מקבל", cell: (r) => <span style={{ color: "var(--color-ink-muted-70)" }}>{r.recieving_worker_name || EM_DASH}</span> },
        // Package model (docs/packages/PLAN.md §9.10): every count is boxes.
        { key: "amount", header: "מארזים שהוצהרו", align: "center", nums: true, cell: (r) => <span style={{ fontWeight: 700 }}>{r.amount}</span> },
        { key: "sampled", header: "נקלטו", align: "center", nums: true, cell: (r) => r.sampled_amount || 0 },
        { key: "started", header: "התחילו", align: "center", nums: true, cell: (r) => r.started_sampled_amount || 0 },
        { key: "finished", header: "סיימו", align: "center", nums: true, cell: (r) => <span style={{ fontWeight: 600 }}>{r.finished_sampled_amount || 0}</span> },
        {
            key: "sent", header: "נשלחו", align: "center", nums: true,
            cell: (r) => {
                const sent = r.sent_amount || 0;
                // Text in a status colour uses its *-ink token (AA).
                return <span style={{ fontWeight: 600, color: sent > 0 ? "var(--color-success-ink)" : "var(--color-ink)" }}>{sent}</span>;
            },
        },
        {
            key: "routeDone", header: "התקדמות המארזים", width: 170,
            cell: (r) => {
                const sampled = r.sampled_amount || 0;
                // Nothing received yet → no percentage: an empty bar and "—".
                if (sampled === 0) return <ProgressCell pct={null} text={EM_DASH} />;
                const pct = Math.round(((r.finished_sampled_amount || 0) / sampled) * 100);
                return <ProgressCell pct={pct} text={`${pct}%`} />;
            },
        },
        {
            // Seven 32px actions and their gaps.
            key: "actions", header: "פעולות", align: "center", width: 250,
            cell: (r) => (
                <RowActions>
                    {/* Shortcut to the packages screen narrowed to this shipment. A sent
                        shipment's boxes are not on that screen otherwise; through this
                        link they show for their history. */}
                    <IconAction title={r.is_sent ? "מארזי המשלוח (יצא — לצפייה בהיסטוריה)" : "מארזי המשלוח"} onClick={() => router.push(`/packages?shipment=${r.id}`)}><Boxes size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title={r.is_sent ? "המשלוח נשלח — לא ניתן לערוך" : "עריכת משלוח"} disabled={!!r.is_sent} onClick={() => handleRowClick(r)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title={deleteBlockedReason(r) ?? "מחיקת משלוח"} danger disabled={deleteBlockedReason(r) != null} onClick={() => setDeleteTarget(r)}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title={r.is_sent ? "המשלוח כבר נשלח" : "החזר משלוח"} disabled={!!r.is_sent} onClick={() => { setSelectedShipment(r); setSendOpen(true); }}><Send size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="היסטוריה" onClick={() => { setSelectedShipment(r); setHistoryOpen(true); }}><History size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="הורד PDF" onClick={() => handlePDFClick(r)}><FileText size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="הדפס מדבקות למארזי המשלוח" onClick={() => { setSelectedShipment(r); setBarcodesOpen(true); }}><Barcode size={16} strokeWidth={1.75} /></IconAction>
                </RowActions>
            ),
        },
    ];

    // Empty means two different things: the filters exclude everything, or
    // there is nothing yet. Each says what to do next.
    const emptyState = anyFilter ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: "var(--text-body)", color: "var(--color-ink)", fontWeight: 600 }}>לא נמצאו משלוחים תואמים.</div>
            <Button variant="outlined" color="inherit" size="small" onClick={clearFilters}>נקה סינון</Button>
        </div>
    ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: "var(--text-body)", color: "var(--color-ink)", fontWeight: 600 }}>עדיין אין משלוחים במערכת.</div>
            <Button size="small" startIcon={<Plus size={16} strokeWidth={2} />} onClick={() => setInsertOpen(true)}>משלוח חדש</Button>
        </div>
    );

    return (
        <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
            {/* header: title + count pill + subtitle + primary action */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-ml)", flexWrap: "wrap" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                        <h1 style={{ margin: 0, fontSize: "var(--text-page)", fontWeight: 700, letterSpacing: "var(--ls-display)", lineHeight: 1.1 }}>משלוחים נכנסים</h1>
                        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-pill)", padding: "3px 11px", fontVariantNumeric: "tabular-nums" }}>
                            {countsKnown ? `${filteredRows.length} משלוחים` : `${EM_DASH} משלוחים`}
                        </span>
                    </div>
                    <p style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-body)", color: "var(--color-ink-muted-70)", lineHeight: 1.5 }}>
                        משלוחי מארזים שהתקבלו לבדיקה, מה הוצהר על כל משלוח וסטטוס הטיפול.
                    </p>
                </div>
                <Button startIcon={<Plus size={18} strokeWidth={2} />} onClick={() => setInsertOpen(true)}>
                    משלוח חדש
                </Button>
            </div>

            {/* Status filters: six counts that narrow the table (toggles), then
                the two figures that only summarise. Counts follow the toolbar
                filters below. */}
            <div className="shp-kpis">
                <div className="shp-kpis" role="group" aria-label="סינון לפי מצב המשלוח">
                    {KPI_ORDER.map((key) => (
                        <button
                            key={key}
                            type="button"
                            className="shp-kpi"
                            aria-pressed={kpiFilter === key}
                            onClick={() => toggleKpi(key)}
                        >
                            {KPI_LABELS[key]}
                            <span className="shp-kpi__count">{countsKnown ? kpiCount[key] : EM_DASH}</span>
                        </button>
                    ))}
                </div>
                <div className="shp-stats">
                    <span>מארזים שנקלטו <strong>{countsKnown ? kpis.sampledTotal : EM_DASH}</strong></span>
                    <span>מארזים שסיימו מתוך שנקלטו <strong>{countsKnown && kpis.donePct !== null ? `${kpis.donePct}%` : EM_DASH}</strong></span>
                </div>
            </div>

            {/* filters + active chips */}
            <div>
                <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end", flexWrap: "wrap" }}>
                    {/* search */}
                    <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                        <FieldLabel htmlFor="shipments-search">חיפוש</FieldLabel>
                        <TextField
                            id="shipments-search"
                            fullWidth
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="קוד, לקוח, מקור או מק״ט"
                            InputProps={{ startAdornment: <Search size={16} strokeWidth={1.75} aria-hidden /> }}
                        />
                    </div>

                    {/* customer — the combobox names its input from its label */}
                    <div style={{ minWidth: 170 }}>
                        <SearchableCombobox<string>
                            label="לקוח"
                            options={customerOptions}
                            getOptionLabel={(o) => o}
                            value={customerFilter}
                            onChange={(v) => setCustomerFilter(v)}
                            placeholder="כל הלקוחות"
                            width={170}
                        />
                    </div>

                    {/* date range */}
                    <div style={{ minWidth: 150 }}>
                        <FieldLabel htmlFor="shipments-from">מתאריך</FieldLabel>
                        <TextField
                            id="shipments-from"
                            type="date"
                            fullWidth
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            inputProps={{ style: { fontVariantNumeric: "tabular-nums" } }}
                        />
                    </div>
                    <div style={{ minWidth: 150 }}>
                        <FieldLabel htmlFor="shipments-to">עד תאריך</FieldLabel>
                        <TextField
                            id="shipments-to"
                            type="date"
                            fullWidth
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            inputProps={{ style: { fontVariantNumeric: "tabular-nums" } }}
                        />
                    </div>

                    {anyFilter && (
                        <Button variant="outlined" color="inherit" startIcon={<X size={15} strokeWidth={1.85} />} onClick={clearFilters}>
                            נקה
                        </Button>
                    )}
                </div>

                {/* One removable chip per active filter — the same Chip the
                    dashboard header uses, with its own named × button. */}
                {anyFilter && (
                    <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center", marginTop: "var(--space-sm)" }}>
                        {search.trim() && <Chip size="small" color="primary" label={`חיפוש: ${search}`} onDelete={() => setSearch("")} />}
                        {customerFilter && <Chip size="small" color="primary" label={`לקוח: ${customerFilter}`} onDelete={() => setCustomerFilter(null)} />}
                        {startDate && <Chip size="small" color="primary" label={`מתאריך: ${chipDate(startDate)}`} onDelete={() => setStartDate("")} />}
                        {endDate && <Chip size="small" color="primary" label={`עד תאריך: ${chipDate(endDate)}`} onDelete={() => setEndDate("")} />}
                        {kpiFilter && <Chip size="small" color="primary" label={KPI_LABELS[kpiFilter]} onDelete={() => setKpiFilter(null)} />}
                    </div>
                )}
            </div>

            {/* table — contained scroll, sticky header. A failed load replaces
                it with the error and a retry; it is never shown as "no rows". */}
            {loadError && !loading ? (
                <Alert
                    severity="error"
                    action={<Button variant="text" size="small" onClick={loadShipments}>נסה שוב</Button>}
                >
                    לא הצלחנו לטעון את רשימת המשלוחים. בדוק את החיבור ונסה שוב.
                </Alert>
            ) : (
                <DataTable<Shipment>
                    columns={columns}
                    rows={filteredRows}
                    getRowKey={(r) => r.id}
                    onRowClick={handleRowClick}
                    // A sent shipment has nothing to open: no pointer, no focus stop.
                    rowClickable={(r) => !r.is_sent}
                    loading={loading}
                    minWidth={1180}
                    maxHeight="calc(100vh - 240px)"
                    empty={emptyState}
                />
            )}

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

            <ConfirmDialog
                draggable={false}
                open={deleteTarget != null}
                title="מחיקת משלוח"
                message={deleteTarget ? `האם למחוק את משלוח ${deleteTarget.shipment_code}? פעולה זו אינה ניתנת לביטול.` : ""}
                confirmText="מחק משלוח"
                destructive
                busy={deleting}
                onConfirm={handleDelete}
                onCancel={() => setDeleteTarget(null)}
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
            <div style={{ display: "none" }}>
                {pdfData && (
                    <ShipmentPDFDocument
                        ref={pdfRef}
                        shipment={pdfData.shipment}
                        type={pdfData.type}
                        historyGroup={pdfData.historyGroup}
                    />
                )}
            </div>
        </div>
    );
}
