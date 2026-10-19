"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Snackbar, Alert, Button } from "@/components/ui";
import { QrCode, Package, FlaskConical, List, Check, Pencil, Plus, RefreshCw } from "lucide-react";
import ItemsToolbar from "@/components/ItemsToolbar";
import DataTable, { StatusPill, ProgressCell, RowActions, IconAction, type Column } from "@/components/DataTable";
import { SummaryStrip, SummaryTile, SummaryStripSkeleton } from "@/components/SummaryStrip";
import ItemDialog from "./ItemDialog";
import PackageScanIntakeDialog from "./packages/PackageScanIntakeDialog";
import EditItemDialog from "@/components/EditItemDialog";
import BarcodeDialog from "./BarcodeDialog";
import { ItemRow, StatusOption, ItemTypeOption, Customers, Shipment } from "@/types";
import { apiFetch } from "@/lib/api/client";
import { toneOfStatus } from "@/app/lib/status-tones";
import { formatDay } from "@/app/items/format";
import "@/components/items.css";

/** current_status of a finished item — hidden from the default view. */
const FINISHED_STATUS = 3;

export default function ItemTable() {
  // Command-palette deep links: ?q=<serial|מק״ט|דגם> seeds the search box, and
  // ?status= pins the status filter — needed because a finished item (status 3)
  // is hidden by default, so a link to one would otherwise land on an empty
  // table. Read once as initial state; the user owns the filters after that.
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const initialStatus = searchParams.get("status") ?? "";

  const [rows, setRows] = React.useState<ItemRow[]>([]);
  const [statuses, setStatuses] = React.useState<StatusOption[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [customers, setCustomers] = React.useState<Customers[]>([]);
  const [shipments, setShipments] = React.useState<Shipment[]>([]);

  const [loading, setLoading] = React.useState(true);
  // A failed load is not an empty result: the table shows an error with a
  // retry instead of "no items". reloadKey re-runs the initial load as is.
  const [loadError, setLoadError] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [selected, setSelected] = React.useState<ItemRow | null>(null);
  const [editingItem, setEditingItem] = React.useState<ItemRow | null>(null);
  // ?new=1 opens the package intake directly. Items are only ever created
  // inside a box (docs/packages/PLAN.md §9), so the old add-item form is gone
  // and "הוסף" here means "קליטת מארז".
  const [insertOpen, setInsertOpen] = React.useState(searchParams.get("new") === "1");

  // snackbar
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState("");
  const [snackbarSeverity, setSnackbarSeverity] = React.useState<"success" | "error">("success");

  // filters (string ids — "" = none)
  const [search, setSearch] = React.useState(initialSearch);
  const [statusFilter, setStatusFilter] = React.useState(initialStatus);
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
      const r = await apiFetch("/api/items");
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      const items = await r.json();
      setRows(Array.isArray(items) ? items : []);
      setLoadError(false);
    } catch (e) {
      console.error("Failed to load items", e);
      setRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r1, r2, r3, r4, r5] = await Promise.all([
          apiFetch("/api/items"),
          apiFetch("/api/statuses"),
          apiFetch("/api/customers"),
          apiFetch("/api/itemTypes"),
          apiFetch("/api/shipments"),
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
        // The lookups degrade quietly; the item list failing is what makes
        // the screen wrong, so only that one is surfaced.
        setLoadError(!r1.ok);
        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        if (!cancelled) { setRows([]); setStatuses([]); setCustomers([]); setItemTypes([]); setShipments([]); setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retryLoad = () => {
    setLoadError(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  // filter option lists for the toolbar
  const statusOpts = React.useMemo(() => statuses.map((s) => ({ value: String(s.id), label: s.label })), [statuses]);
  const typeOpts = React.useMemo(() => itemTypes.map((t) => ({ value: String(t.item_type_id), label: t.item_type_desc })), [itemTypes]);
  const shipOpts = React.useMemo(
    () => shipments.map((s) => ({ value: String(s.id), label: `${s.shipment_code} · ${s.customer_name}` })),
    [shipments]
  );

  // option lists for the edit-item dialog (full, unfiltered — the item's
  // current customer and type must always be selectable). The shipment is not
  // editable from here: it is set at intake and the ledger freezes it onto
  // every run, so moving an item between shipments is a transfer, not a typo
  // fix, and needs its own path.
  const editCustomerOptions = React.useMemo(
    () => customers.map((c) => ({ value: String(c.id), label: c.customer_code ? `${c.name} (${c.customer_code})` : c.name })),
    [customers]
  );
  const editItemTypeOptions = React.useMemo(
    () => itemTypes.map((t) => ({ value: String(t.item_type_id), label: t.item_type_desc })),
    [itemTypes]
  );

  // Every filter except status: search, item type, shipment. Shared by the
  // table and by the "finished items hidden" count, so the two never disagree.
  const matchesNonStatus = React.useCallback(
    (row: ItemRow) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const name = `${row.model ?? ""} ${row.customer_code ?? ""} ${row.makat ?? ""}`.toLowerCase();
        const serial = (row.serial_no ?? "").toString().toLowerCase();
        if (!name.includes(q) && !serial.includes(q)) return false;
      }
      if (typeFilter && row.item_type_id !== Number(typeFilter)) return false;
      // /api/items serializes shipment_id as a string (BigInt-safe) — compare as strings
      if (shipFilter && String(row.shipment_id) !== shipFilter) return false;
      return true;
    },
    [search, typeFilter, shipFilter]
  );

  const filteredRows = React.useMemo(() => {
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => {
      if (!matchesNonStatus(row)) return false;
      if (statusFilter) return row.current_status === Number(statusFilter);
      // Default: hide finished items unless explicitly filtered.
      return row.current_status !== FINISHED_STATUS;
    });
  }, [rows, matchesNonStatus, statusFilter]);

  // Finished items the default view is hiding right now (they still count in
  // the KPI totals above, so the screen says where they went).
  const hiddenFinished = React.useMemo(() => {
    if (statusFilter || !Array.isArray(rows)) return 0;
    return rows.filter((r) => r.current_status === FINISHED_STATUS && matchesNonStatus(r)).length;
  }, [rows, matchesNonStatus, statusFilter]);

  // KPI counters — derived from the full list (not filtered), by current_status:
  // 1 = בבדיקה, 2 = בתור, 3 (or is_finished) = הושלם.
  const kpis = React.useMemo(() => {
    let inTest = 0, inQueue = 0, done = 0;
    for (const r of rows) {
      if (r.current_status === 1) inTest++;
      else if (r.current_status === 2) inQueue++;
      if (r.current_status === 3 || r.is_finished) done++;
    }
    return { total: rows.length, inTest, inQueue, done };
  }, [rows]);

  const anyFilter = search.trim() !== "" || statusFilter !== "" || typeFilter !== "" || shipFilter !== "";
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setTypeFilter("");
    setShipFilter("");
  };
  // "Show finished" is the status filter the command palette already uses
  // for a finished item (?status=3) — no second mechanism.
  const showFinished = () => setStatusFilter(String(FINISHED_STATUS));
  const hideFinished = () => setStatusFilter("");

  const onEditResult = (success: boolean, message?: string) => {
    setSnackbarMessage(success ? "הפריט עודכן בהצלחה" : (message || "עדכון הפריט נכשל"));
    setSnackbarSeverity(success ? "success" : "error");
    setSnackbarOpen(true);
    if (success) loadItems();
  };

  const onDeleteResult = (success: boolean, message?: string) => {
    setSnackbarMessage(success ? "הפריט נמחק בהצלחה" : (message || "מחיקת הפריט נכשלה"));
    setSnackbarSeverity(success ? "success" : "error");
    setSnackbarOpen(true);
    if (success) loadItems();
  };

  const progressOf = (row: ItemRow): { pct: number; text: string; sub: boolean } => {
    if (row.package_id !== null && row.package_id !== undefined) return { pct: 0, text: "—", sub: true };
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
      // A quiet ghost icon button: the row itself is the primary target.
      cell: (r) => (
        <IconAction title="הצג ברקוד" onClick={(e) => openBarcode(e, r)}>
          <QrCode size={18} strokeWidth={1.75} aria-hidden />
        </IconAction>
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
      // One status palette for every screen (status-tones).
      cell: (r) => (r.item_status_desc ? <StatusPill label={r.item_status_desc} tone={toneOfStatus(r.current_status)} /> : "—"),
    },
    {
      key: "progress", header: "התקדמות", width: 180,
      cell: (r) => {
        const p = progressOf(r);
        return p.sub ? <span style={{ color: "var(--color-ink-muted-48)" }}>—</span> : <ProgressCell pct={p.pct} text={p.text} />;
      },
    },
    {
      key: "date", header: "תאריך קליטה", width: 140, muted: true, nums: true, nowrap: true,
      cell: (r) => formatDay(r.created_at),
    },
    {
      key: "actions", header: "פעולות", align: "center", width: 70,
      cell: (r) => (
        <RowActions>
          <IconAction title="ערוך פריט" onClick={() => setEditingItem(r)}>
            <Pencil size={16} strokeWidth={1.75} aria-hidden />
          </IconAction>
        </RowActions>
      ),
    },
  ];

  // Empty states say why the table is empty and offer the way out.
  let empty: React.ReactNode;
  if (rows.length === 0) {
    empty = (
      <EmptyState
        title="עדיין אין פריטים במערכת"
        body="פריטים נוצרים בקליטת מארז."
        action={
          <Button variant="outlined" onClick={() => setInsertOpen(true)} startIcon={<Plus size={18} strokeWidth={2} aria-hidden />}>
            קליטת מארז
          </Button>
        }
      />
    );
  } else if (hiddenFinished > 0) {
    empty = (
      <EmptyState
        title={anyFilter ? "כל הפריטים שתואמים לסינון כבר הושלמו" : "כל הפריטים במערכת כבר הושלמו"}
        body="פריטים שהושלמו מוסתרים כברירת מחדל."
        action={<Button variant="outlined" onClick={showFinished}>הצג פריטים שהושלמו</Button>}
      />
    );
  } else {
    empty = (
      <EmptyState
        title="אין פריטים שתואמים לסינון"
        body="נסה חיפוש אחר, או נקה את הסינון כדי לראות את כל הפריטים."
        action={anyFilter ? <Button variant="outlined" onClick={clearFilters}>נקה סינון</Button> : undefined}
      />
    );
  }

  // KPI values: "—" when the list failed to load — never a fake 0.
  const kpi = (n: number) => (loadError ? "—" : n);

  const summary = loading ? (
    <SummaryStripSkeleton count={4} />
  ) : (
    <SummaryStrip>
      <SummaryTile icon={<Package size={20} strokeWidth={1.75} />} tone="neutral" value={kpi(kpis.total)} label="סה״כ פריטים" />
      <SummaryTile icon={<FlaskConical size={20} strokeWidth={1.75} />} tone={toneOfStatus(1)} value={kpi(kpis.inTest)} label="בבדיקה" />
      <SummaryTile icon={<List size={20} strokeWidth={1.75} />} tone={toneOfStatus(2)} value={kpi(kpis.inQueue)} label="בתור" />
      <SummaryTile icon={<Check size={20} strokeWidth={1.75} />} tone={toneOfStatus(FINISHED_STATUS)} value={kpi(kpis.done)} label="הושלמו" />
    </SummaryStrip>
  );

  // The quiet "where did the finished items go" line (only when the table
  // has rows — an empty table says it in its own empty state).
  const showHint = !loading && !loadError && filteredRows.length > 0 && (hiddenFinished > 0 || statusFilter === String(FINISHED_STATUS));

  return (
    <>
      <div className="items-page">
        <ItemsToolbar
          search={search}
          onSearch={setSearch}
          onAdd={() => setInsertOpen(true)}
          addLabel="קליטת מארז"
          summary={summary}
          filters={[
            { key: "status", placeholder: "סטטוס", value: statusFilter, options: statusOpts, onChange: setStatusFilter },
            { key: "type", placeholder: "סוג פריט", value: typeFilter, options: typeOpts, onChange: setTypeFilter, width: 190 },
            { key: "ship", placeholder: "משלוח", value: shipFilter, options: shipOpts, onChange: setShipFilter, width: 220 },
          ]}
        />

        {showHint && (
          // Tucked toward its neighbours (the link button is 32px tall for
          // touch) so a one-line note doesn't open a 64px gap above the table.
          <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", marginBlock: "calc(-1 * var(--space-xs))" }}>
            {hiddenFinished > 0 ? (
              <>
                {hiddenFinished === 1 ? "פריט אחד שהושלם מוסתר" : `${hiddenFinished} פריטים שהושלמו מוסתרים`}
                {" · "}
                <button type="button" className="items-link-btn" onClick={showFinished}>הצג</button>
              </>
            ) : (
              <>
                מוצגים רק פריטים שהושלמו
                {" · "}
                <button type="button" className="items-link-btn" onClick={hideFinished}>הסתר</button>
              </>
            )}
          </div>
        )}

        <div className="items-table-slot">
          {loadError && !loading ? (
            <Alert
              severity="error"
              action={
                <Button size="small" variant="outlined" color="inherit" onClick={retryLoad} startIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden />}>
                  נסה שוב
                </Button>
              }
            >
              טעינת הפריטים נכשלה. ייתכן שהשרת אינו זמין כרגע — נסה שוב בעוד רגע.
            </Alert>
          ) : (
            <DataTable<ItemRow>
              columns={columns}
              rows={filteredRows}
              getRowKey={(r) => r.item_id}
              onRowClick={setSelected}
              minWidth={1100}
              // Fills the slot and scrolls inside it, so the header stays pinned.
              maxHeight="100%"
              loading={loading}
              empty={empty}
            />
          )}
        </div>
      </div>

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

      <PackageScanIntakeDialog open={insertOpen} onClose={() => setInsertOpen(false)} onChanged={() => loadItems()} />

      <EditItemDialog
        open={!!editingItem}
        item={editingItem}
        customerOptions={editCustomerOptions}
        itemTypeOptions={editItemTypeOptions}
        onClose={() => setEditingItem(null)}
        onSaved={onEditResult}
        onDeleted={onDeleteResult}
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
    </>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-xxs)", paddingInline: "var(--space-md)" }}>
      <div style={{ fontSize: "var(--text-lead)", fontWeight: 600, color: "var(--color-ink)" }}>{title}</div>
      <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>{body}</div>
      {action && <div style={{ marginTop: "var(--space-sm)" }}>{action}</div>}
    </div>
  );
}
