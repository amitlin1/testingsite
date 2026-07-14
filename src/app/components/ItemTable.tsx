"use client";
import * as React from "react";
import { Snackbar, Alert } from "@/components/ui";
import { QrCode } from "lucide-react";
import ItemsToolbar from "@/components/ItemsToolbar";
import DataTable, { StatusPill, ProgressCell, type Column } from "@/components/DataTable";
import ItemDialog from "./ItemDialog";
import InsertPopup from "./insertPopup";
import BarcodeDialog from "./BarcodeDialog";
import { ItemRow, StatusOption, NewItem, ItemTypeOption, Customers, Shipment } from "@/types";

export default function ItemTable() {
  const [rows, setRows] = React.useState<ItemRow[]>([]);
  const [statuses, setStatuses] = React.useState<StatusOption[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [customers, setCustomers] = React.useState<Customers[]>([]);
  const [shipments, setShipments] = React.useState<Shipment[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<ItemRow | null>(null);
  const [insertOpen, setInsertOpen] = React.useState(false);

  // snackbar
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState("");
  const [snackbarSeverity, setSnackbarSeverity] = React.useState<"success" | "error">("success");

  // filters (string ids — "" = none)
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [shipFilter, setShipFilter] = React.useState("");

  // barcode dialog
  const [barcodeOpen, setBarcodeOpen] = React.useState(false);
  const [barcodeItem, setBarcodeItem] = React.useState<{ id: number; sourceId?: number | null; serial?: string } | null>(null);

  const openBarcode = (e: React.MouseEvent, row: ItemRow) => {
    e.stopPropagation();
    setBarcodeItem({ id: row.item_id, sourceId: row.source_id || null, serial: row.serial_no || undefined });
    setBarcodeOpen(true);
  };

  const loadItems = React.useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/items");
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      const items = await r.json();
      setRows(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error("Failed to load items", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r1, r2, r3, r4, r5] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/statuses"),
          fetch("/api/customers"),
          fetch("/api/itemTypes"),
          fetch("/api/shipments"),
        ]);
        const items = r1.ok ? await r1.json() : [];
        const stats = r2.ok ? await r2.json() : [];
        const custs = r3.ok ? await r3.json() : [];
        const types = r4.ok ? await r4.json() : [];
        const ships = r5.ok ? await r5.json() : [];
        if (cancelled) return;
        setRows(Array.isArray(items) ? items : []);
        setStatuses(Array.isArray(stats) ? stats : []);
        setCustomers(Array.isArray(custs) ? custs : []);
        setItemTypes(Array.isArray(types) ? types : []);
        setShipments(Array.isArray(ships) ? ships : []);
        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        if (!cancelled) { setRows([]); setStatuses([]); setCustomers([]); setItemTypes([]); setShipments([]); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // filter option lists for the toolbar
  const statusOpts = React.useMemo(() => statuses.map((s) => ({ value: String(s.id), label: s.label })), [statuses]);
  const typeOpts = React.useMemo(() => itemTypes.map((t) => ({ value: String(t.item_type_id), label: t.item_type_desc })), [itemTypes]);
  const shipOpts = React.useMemo(
    () => shipments.map((s) => ({ value: String(s.id), label: `${s.shipment_code} · ${s.customer_name}` })),
    [shipments]
  );

  const filteredRows = React.useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const name = `${row.model ?? ""} ${row.customer_code ?? ""} ${row.makat ?? ""}`.toLowerCase();
        const serial = (row.serial_no ?? "").toString().toLowerCase();
        if (!name.includes(q) && !serial.includes(q)) return false;
      }
      if (statusFilter) {
        if (row.current_status !== Number(statusFilter)) return false;
      } else if (row.current_status === 3) {
        // Default: hide finished items unless explicitly filtered.
        return false;
      }
      if (typeFilter && row.item_type_id !== Number(typeFilter)) return false;
      if (shipFilter && row.shipment_id !== Number(shipFilter)) return false;
      return true;
    });
  }, [rows, search, statusFilter, typeFilter, shipFilter]);

  const onCreateResult = (_data: NewItem, success: boolean) => {
    setSnackbarMessage(success ? "הפריט נוצר בהצלחה" : "יצירת הפריט נכשלה");
    setSnackbarSeverity(success ? "success" : "error");
    setSnackbarOpen(true);
  };

  const closeInsertPopup = () => {
    setInsertOpen(false);
    loadItems();
  };

  const progressOf = (row: ItemRow): { pct: number; text: string; sub: boolean } => {
    if (row.parent_item_id !== null && row.parent_item_id !== undefined) return { pct: 0, text: "—", sub: true };
    const currentStep = row.current_route_step || 0;
    const totalSteps = row.total_steps || 0;
    if (row.current_status === 3 || row.is_finished) {
      return { pct: 100, text: totalSteps > 0 ? `${totalSteps}/${totalSteps}` : "הושלם", sub: false };
    }
    if (totalSteps > 0) return { pct: Math.min((currentStep / totalSteps) * 100, 100), text: `${currentStep}/${totalSteps}`, sub: false };
    return { pct: 0, text: "—", sub: false };
  };

  const columns: Column<ItemRow>[] = [
    {
      key: "barcode", header: "ברקוד", align: "center", width: 56,
      cell: (r) => (
        <button className="shx-icon-btn" onClick={(e) => openBarcode(e, r)} aria-label="ברקוד" title="הצג ברקוד">
          <QrCode size={18} strokeWidth={1.75} />
        </button>
      ),
    },
    { key: "type", header: "סוג", nowrap: true, muted: true, cell: (r) => r.item_type_desc ?? "—" },
    { key: "serial", header: "מס׳ סיריאלי", nums: true, bold: true, nowrap: true, cell: (r) => r.serial_no ?? "—" },
    { key: "makat", header: "מק״ט", nums: true, cell: (r) => r.makat ?? "—" },
    { key: "model", header: "דגם", nowrap: true, cell: (r) => r.model ?? "—" },
    { key: "manufacturer", header: "יצרן", nowrap: true, muted: true, cell: (r) => r.manufacturer_name ?? "—" },
    { key: "man_no", header: "מס׳ יצרן", nums: true, muted: true, cell: (r) => r.manufacturer_no ?? "—" },
    { key: "shipment", header: "מס׳ משלוח", nowrap: true, cell: (r) => r.shipment_code ?? "—" },
    { key: "customer", header: "לקוח", nowrap: true, cell: (r) => r.customer_code ?? "—" },
    {
      key: "status", header: "סטטוס",
      cell: (r) => (r.item_status_desc ? <StatusPill label={r.item_status_desc} active={r.current_status === 2} /> : "—"),
    },
    {
      key: "progress", header: "התקדמות", width: 180,
      cell: (r) => {
        const p = progressOf(r);
        return p.sub ? <span style={{ color: "#7a7a7a" }}>—</span> : <ProgressCell pct={p.pct} text={p.text} />;
      },
    },
    {
      key: "date", header: "תאריך קליטה", width: 140, muted: true, nums: true, nowrap: true,
      cell: (r) => (r.created_at ? new Date(r.created_at).toLocaleDateString("he-IL") : "—"),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <ItemsToolbar
        search={search}
        onSearch={setSearch}
        onAdd={() => setInsertOpen(true)}
        filters={[
          { key: "status", placeholder: "סטטוס", value: statusFilter, options: statusOpts, onChange: setStatusFilter },
          { key: "type", placeholder: "סוג פריט", value: typeFilter, options: typeOpts, onChange: setTypeFilter, width: 190 },
          { key: "ship", placeholder: "משלוח", value: shipFilter, options: shipOpts, onChange: setShipFilter, width: 220 },
        ]}
      />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 48, borderRadius: 10, background: "linear-gradient(90deg,#eee,#f5f5f7,#eee)", backgroundSize: "200% 100%", animation: "shx-shimmer 1.4s infinite" }} />
          ))}
          <style>{`@keyframes shx-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }`}</style>
        </div>
      ) : (
        <DataTable<ItemRow>
          columns={columns}
          rows={filteredRows}
          getRowKey={(r) => r.item_id}
          onRowClick={setSelected}
          minWidth={1100}
          empty={<div style={{ fontSize: 15 }}>לא נמצאו פריטים תואמים.</div>}
        />
      )}

      {selected && (
        <ItemDialog
          itemId={selected.item_id}
          statusLabel={selected.item_status_desc ?? ""}
          onClose={() => setSelected(null)}
        />
      )}

      {barcodeItem && (
        <BarcodeDialog
          open={barcodeOpen}
          onClose={() => setBarcodeOpen(false)}
          itemId={barcodeItem.id}
          sourceId={barcodeItem.sourceId}
          itemSerial={barcodeItem.serial}
        />
      )}

      <InsertPopup open={insertOpen} onClose={closeInsertPopup} onCreate={onCreateResult} />

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
    </div>
  );
}
