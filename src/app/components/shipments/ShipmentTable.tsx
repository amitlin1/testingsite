"use client";
import React, { useEffect, useState, useMemo } from "react";
import { Snackbar, Alert } from "@/components/ui";
import { Search, Plus, X, Pencil, Send, History, FileText, Barcode, Truck, Hourglass, Layers, PackageCheck, Percent, Inbox, FlaskConical } from "lucide-react";
import DataTable, { StatusPill, RowActions, IconAction, ProgressCell, type Column } from "@/components/DataTable";
import { SummaryStrip, SummaryTile, SummaryStripSkeleton } from "@/components/SummaryStrip";
import SearchableCombobox from "../common/SearchableCombobox";
import { Shipment } from "@/types";
import ShipmentInsertPopup from "./ShipmentInsertPopup";
import ShipmentUpdatePopup from "./ShipmentUpdatePopup";
import ShipmentSendPopup from "./ShipmentSendPopup";
import ShipmentHistoryPopup from "./ShipmentHistoryPopup";
import { useReactToPrint } from "react-to-print";
import { ShipmentPDFDocument } from "./ShipmentPDFDocument";
import ShipmentBarcodesDialog from "./ShipmentBarcodesDialog";
import { apiFetch } from "@/lib/api/client";

/* Shifthouse field label — sits above each filter control (matches Items). */
const fieldLabel: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#7a7a7a",
    marginBottom: 5,
};

/* --- KPI filters ---------------------------------------------------------
 * Testing "started" for a shipment = at least one sampled item is past the
 * untouched state (in work / finished / research, or passed a station —
 * current_route_step is 1-based, so > 1 means a station was completed).
 * The unsent bucket ("במערכת") splits into waitingStart + inProcess.
 */
type KpiKey = "total" | "pending" | "sent" | "inProcess" | "waitingStart" | "readyToSend";

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

/* Active-filter chip — soft blue pill with an ✕ that clears that one filter. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#e6efff", color: "#0a4a99", border: "1px solid #b9d4ff", borderRadius: 9999, padding: "5px 12px", fontSize: 13, fontWeight: 600 }}>
            {label}
            <button onClick={onRemove} aria-label="הסר סינון" style={{ display: "flex", border: 0, background: "transparent", color: "#0a4a99", cursor: "pointer", padding: 0 }}>
                <X size={14} strokeWidth={2} />
            </button>
        </span>
    );
}

export default function ShipmentTable() {
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
    const [kpiFilter, setKpiFilter] = useState<KpiKey | null>(null);

    // Popups
    const [insertOpen, setInsertOpen] = useState(false);
    const [updateOpen, setUpdateOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [barcodesOpen, setBarcodesOpen] = useState(false);
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
            const res = await apiFetch("/api/shipments");
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
        const donePct = sampledTotal > 0 ? Math.round((finishedTotal / sampledTotal) * 100) : 0;
        return { total: baseFilteredRows.length, pending, sent, inProcess, waitingStart, sampledTotal, sampleDone, donePct };
    }, [baseFilteredRows]);

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

    const handleRowClick = (row: Shipment) => {
        setSelectedShipment(row);
        setUpdateOpen(true);
    };

    const columns: Column<Shipment>[] = [
        { key: "source", header: "מקור", cell: (r) => <span style={{ color: "#444" }}>{r.source_desc || "—"}</span> },
        { key: "code", header: "מס׳ משלוח", nums: true, bold: true, nowrap: true, cell: (r) => r.shipment_code },
        {
            key: "customer", header: "קוד לקוח", nowrap: true,
            cell: (r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#444" }}>
                    {r.customer_code}
                    {r.is_sent && <StatusPill label="נשלח" active />}
                </span>
            ),
        },
        { key: "date", header: "תאריך קבלה", nums: true, nowrap: true, cell: (r) => <span style={{ color: "#444" }}>{new Date(r.shipment_date).toLocaleDateString("he-IL")}</span> },
        { key: "worker", header: "עובד מקבל", cell: (r) => <span style={{ color: "#444" }}>{r.recieving_worker_name || "—"}</span> },
        { key: "amount", header: "כמות כוללת", align: "center", nums: true, cell: (r) => <span style={{ fontWeight: 700 }}>{r.amount}</span> },
        { key: "sampled", header: "כמות מדגם", align: "center", nums: true, cell: (r) => r.sampled_amount || 0 },
        { key: "subItems", header: "תת פריטים", align: "center", nums: true, cell: (r) => r.sub_items_sampled_amount || 0 },
        { key: "valid", header: "כמות תקינה", align: "center", nums: true, cell: (r) => <span style={{ fontWeight: 600 }}>{r.valid_amount || 0}</span> },
        {
            key: "invalid", header: "כמות לא תקינה", align: "center", nums: true,
            cell: (r) => {
                const invalid = Math.max(0, (r.sampled_amount || 0) - (r.valid_amount || 0));
                return <span style={{ fontWeight: 600, color: invalid > 0 ? "#bf3535" : "#1d1d1f" }}>{invalid}</span>;
            },
        },
        {
            key: "routeDone", header: "סיימו את המסלול", width: 170,
            cell: (r) => {
                const sampled = r.sampled_amount || 0;
                const pct = sampled > 0 ? Math.round(((r.finished_sampled_amount || 0) / sampled) * 100) : 0;
                return <ProgressCell pct={pct} text={`${pct}%`} />;
            },
        },
        {
            key: "actions", header: "פעולות", align: "center", width: 192,
            cell: (r) => (
                <RowActions>
                    <IconAction title="עריכת משלוח" onClick={() => handleRowClick(r)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="החזר משלוח" onClick={() => { setSelectedShipment(r); setSendOpen(true); }}><Send size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="היסטוריה" onClick={() => { setSelectedShipment(r); setHistoryOpen(true); }}><History size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="הורד PDF" onClick={() => handlePDFClick(r)}><FileText size={16} strokeWidth={1.75} /></IconAction>
                    <IconAction title="הדפס ברקודים לכל הפריטים" onClick={() => { setSelectedShipment(r); setBarcodesOpen(true); }}><Barcode size={16} strokeWidth={1.75} /></IconAction>
                </RowActions>
            ),
        },
    ];

    return (
        <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* header: title + count pill + subtitle + primary action */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}>משלוחים נכנסים</h1>
                        <span style={{ fontSize: 13, color: "#7a7a7a", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "3px 11px", fontVariantNumeric: "tabular-nums" }}>
                            {filteredRows.length} משלוחים
                        </span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 16, color: "#444", lineHeight: 1.5 }}>
                        משלוחי פריטים שהתקבלו לבדיקה, כמויות מדגם וסטטוס טיפול.
                    </p>
                </div>
                <button className="shx-btn shx-btn-primary" onClick={() => setInsertOpen(true)}>
                    <Plus size={18} strokeWidth={2} />
                    משלוח חדש
                </button>
            </div>

            {/* KPI summary strip — sits above the toolbar/filters.
                Shipment-count tiles are clickable and filter the table. */}
            {loading ? (
                <SummaryStripSkeleton count={8} />
            ) : (
                <SummaryStrip>
                    <SummaryTile icon={<Truck size={22} strokeWidth={1.85} />} tone="blue" value={kpis.total} label={KPI_LABELS.total}
                        onClick={() => toggleKpi("total")} active={kpiFilter === "total"} />
                    <SummaryTile icon={<Inbox size={22} strokeWidth={1.85} />} tone="blue" value={kpis.pending} label={KPI_LABELS.pending}
                        onClick={() => toggleKpi("pending")} active={kpiFilter === "pending"} />
                    <SummaryTile icon={<Hourglass size={22} strokeWidth={1.85} />} tone="amber" value={kpis.waitingStart} label={KPI_LABELS.waitingStart}
                        onClick={() => toggleKpi("waitingStart")} active={kpiFilter === "waitingStart"} />
                    <SummaryTile icon={<FlaskConical size={22} strokeWidth={1.85} />} tone="blue" value={kpis.inProcess} label={KPI_LABELS.inProcess}
                        onClick={() => toggleKpi("inProcess")} active={kpiFilter === "inProcess"} />
                    <SummaryTile icon={<PackageCheck size={22} strokeWidth={1.85} />} tone="amber" value={kpis.sampleDone} label={KPI_LABELS.readyToSend}
                        onClick={() => toggleKpi("readyToSend")} active={kpiFilter === "readyToSend"} />
                    <SummaryTile icon={<Send size={22} strokeWidth={1.85} />} tone="green" value={kpis.sent} label={KPI_LABELS.sent}
                        onClick={() => toggleKpi("sent")} active={kpiFilter === "sent"} />
                    <SummaryTile icon={<Layers size={22} strokeWidth={1.85} />} tone="blue" value={kpis.sampledTotal} label="כמות מדגם כוללת" />
                    <SummaryTile icon={<Percent size={22} strokeWidth={1.85} />} tone="green" value={`${kpis.donePct}%`} label="פריטים שהושלמו מתוך המדגם" />
                </SummaryStrip>
            )}

            {/* filters + active chips */}
            <div>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {/* search */}
                    <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                        <label style={fieldLabel}>חיפוש</label>
                        <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", insetInlineStart: 13, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex" }}>
                                <Search size={16} strokeWidth={1.75} />
                            </span>
                            <input
                                className="shx-input"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="קוד, לקוח, מקור או מק״ט"
                                style={{ height: 40, borderRadius: 9, paddingInlineStart: 38, paddingInlineEnd: 12, fontSize: 14 }}
                            />
                        </div>
                    </div>

                    {/* customer */}
                    <div style={{ minWidth: 170 }}>
                        <label style={fieldLabel}>לקוח</label>
                        <SearchableCombobox<string>
                            options={customerOptions}
                            getOptionLabel={(o) => o}
                            value={customerFilter}
                            onChange={(v) => setCustomerFilter(v)}
                            placeholder="כל הלקוחות"
                            width={170}
                            inputSx={{ height: 42 }}
                        />
                    </div>

                    {/* date range */}
                    <div style={{ minWidth: 150 }}>
                        <label style={fieldLabel}>מתאריך</label>
                        <input
                            type="date"
                            className="shx-input"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            style={{ height: 40, borderRadius: 9, fontSize: 14, fontVariantNumeric: "tabular-nums" }}
                        />
                    </div>
                    <div style={{ minWidth: 150 }}>
                        <label style={fieldLabel}>עד תאריך</label>
                        <input
                            type="date"
                            className="shx-input"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            style={{ height: 40, borderRadius: 9, fontSize: 14, fontVariantNumeric: "tabular-nums" }}
                        />
                    </div>

                    {anyFilter && (
                        <button
                            className="shx-btn shx-btn-secondary"
                            onClick={clearFilters}
                            style={{ height: 40, padding: "0 14px", fontSize: 14, borderRadius: 9 }}
                        >
                            <X size={15} strokeWidth={1.85} />
                            נקה
                        </button>
                    )}
                </div>

                {anyFilter && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                        {search.trim() && <FilterChip label={`חיפוש: ${search}`} onRemove={() => setSearch("")} />}
                        {customerFilter && <FilterChip label={`לקוח: ${customerFilter}`} onRemove={() => setCustomerFilter(null)} />}
                        {startDate && <FilterChip label={`מתאריך: ${startDate}`} onRemove={() => setStartDate("")} />}
                        {endDate && <FilterChip label={`עד תאריך: ${endDate}`} onRemove={() => setEndDate("")} />}
                        {kpiFilter && <FilterChip label={KPI_LABELS[kpiFilter]} onRemove={() => setKpiFilter(null)} />}
                    </div>
                )}
            </div>

            {/* table — contained scroll, sticky header */}
            <DataTable<Shipment>
                columns={columns}
                rows={filteredRows}
                getRowKey={(r) => r.id}
                onRowClick={handleRowClick}
                loading={loading}
                minWidth={1360}
                maxHeight="calc(100vh - 240px)"
                empty={<div style={{ fontSize: 16, color: "#1d1d1f", fontWeight: 600 }}>לא נמצאו משלוחים תואמים.</div>}
            />

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
