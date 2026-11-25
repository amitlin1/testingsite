"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, useToast } from "@/components/ui";
import { QrCode, Package, FlaskConical, List, Check, Pencil, Plus, RefreshCw } from "lucide-react";
import DataTable, { StatusPill, ProgressCell, RowActions, IconAction, type Column } from "@/components/DataTable";
import { SummaryStrip, SummaryTile, SummaryStripSkeleton } from "@/components/SummaryStrip";
import ItemsToolbar from "./ItemsToolbar";
import ItemDialog from "./ItemDialog";
import EditItemDialog from "./EditItemDialog";
import PackageScanIntakeDialog from "@/app/components/packages/PackageScanIntakeDialog";
import { useCanIntake } from "@/app/components/packages/useCanIntake";
import BarcodeDialog from "@/app/components/BarcodeDialog";
import { customerLabel, useCustomers, useItemTypes, useShipments } from "@/app/components/lookups";
import type { ItemListRow, StatusOption } from "@/app/lib/items/contract";
import { itemProgress } from "@/app/lib/items/progress";
import { failureText } from "@/app/components/failureText";
import { READ_PER_VISIT } from "@/app/components/screenQuery";
import { getArray } from "@/lib/api/client";
import { ItemStatus, toneOfStatus } from "@/lib/item-status";
import { formatDay } from "@/app/lib/datetime";
import "@/components/items.css";

const NO_ROWS: never[] = [];

export default function ItemTable() {
  const toast = useToast();
  // Read on every visit; "נסה שוב", a save and an intake read again.
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => getArray<ItemListRow>("/api/items"), ...READ_PER_VISIT });
  const rows = itemsQ.data ?? NO_ROWS;
  const loading = itemsQ.isFetching;
  // A failed load is not an empty result: the table shows an error with a
  // retry instead of "no items".
  const loadError = itemsQ.isError;
  const reload = () => void itemsQ.refetch();
  // The lookups degrade quietly; the item list failing is what makes the
  // screen wrong, so only that one is surfaced.
  const statuses = useQuery({ queryKey: ["statuses"], staleTime: 5 * 60_000, queryFn: () => getArray<StatusOption>("/api/statuses") }).data ?? NO_ROWS;
  const customers = useCustomers().data ?? NO_ROWS;
  const itemTypes = useItemTypes().data ?? NO_ROWS;
  const shipments = useShipments().data ?? NO_ROWS;

  const [selected, setSelected] = React.useState<ItemListRow | null>(null);
  const [editingItem, setEditingItem] = React.useState<ItemListRow | null>(null);
  // Items are only ever created inside a box (docs/packages/PLAN.md §9), so
  // "הוסף" here means "קליטת מארז".
  const canIntake = useCanIntake();
  const [insertOpen, setInsertOpen] = React.useState(false);

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [shipFilter, setShipFilter] = React.useState("");

  const [barcode, setBarcode] = React.useState<{ id: string; open: boolean } | null>(null);

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
    () => customers.map((c) => ({ value: String(c.id), label: customerLabel(c) })),
    [customers]
  );
  const editItemTypeOptions = React.useMemo(
    () => itemTypes.map((t) => ({ value: String(t.item_type_id), label: t.item_type_desc })),
    [itemTypes]
  );

  // Every filter except status: search, item type, shipment. Shared by the
  // table and by the "finished items hidden" count, so the two never disagree.
  const matchesNonStatus = React.useCallback(
    (row: ItemListRow) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const name = `${row.model ?? ""} ${row.customer_code ?? ""} ${row.makat ?? ""}`.toLowerCase();
        const serial = (row.serial_no ?? "").toString().toLowerCase();
        if (!name.includes(q) && !serial.includes(q)) return false;
      }
      if (typeFilter && row.item_type_id !== Number(typeFilter)) return false;
      if (shipFilter && row.shipment_id !== shipFilter) return false;
      return true;
    },
    [search, typeFilter, shipFilter]
  );

  const filteredRows = React.useMemo(
    () => rows.filter((row) => {
      if (!matchesNonStatus(row)) return false;
      if (statusFilter) return row.current_status === Number(statusFilter);
      return row.current_status !== ItemStatus.Done;
    }),
    [rows, matchesNonStatus, statusFilter],
  );

  // Finished items the default view is hiding right now (they still count in
  // the KPI totals above, so the screen says where they went).
  const hiddenFinished = React.useMemo(() => {
    if (statusFilter) return 0;
    return rows.filter((r) => r.current_status === ItemStatus.Done && matchesNonStatus(r)).length;
  }, [rows, matchesNonStatus, statusFilter]);

  const kpis = React.useMemo(() => {
    let inTest = 0, inQueue = 0, done = 0;
    for (const r of rows) {
      if (r.current_status === ItemStatus.InTest) inTest++;
      else if (r.current_status === ItemStatus.Queued) inQueue++;
      if (r.current_status === ItemStatus.Done || r.is_finished) done++;
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
  const showFinished = () => setStatusFilter(String(ItemStatus.Done));
  const hideFinished = () => setStatusFilter("");

  const onEditResult = (success: boolean, error?: unknown) => {
    toast.show(success ? "הפריט עודכן בהצלחה" : failureText(error, "עדכון הפריט נכשל"), success ? "success" : "error");
    if (success) reload();
  };

  const onDeleteResult = (success: boolean, error?: unknown) => {
    toast.show(success ? "הפריט נמחק בהצלחה" : failureText(error, "מחיקת הפריט נכשלה"), success ? "success" : "error");
    if (success) reload();
  };

  const columns: Column<ItemListRow>[] = [
    {
      key: "barcode", header: "ברקוד", align: "center", width: 56,
      // A quiet ghost icon button: the row itself is the primary target.
      cell: (r) => (
        <IconAction title="הצג ברקוד" onClick={() => setBarcode({ id: r.item_id, open: true })}>
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
      cell: (r) => (r.item_status_desc ? <StatusPill label={r.item_status_desc} tone={toneOfStatus(r.current_status)} /> : "—"),
    },
    {
      key: "progress", header: "התקדמות", width: 180,
      cell: (r) => {
        const p = itemProgress(r);
        return p.inBox ? <span style={{ color: "var(--color-ink-muted-48)" }}>—</span> : <ProgressCell pct={p.pct} text={p.text} />;
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

  let empty: React.ReactNode;
  if (rows.length === 0) {
    empty = (
      <EmptyState
        title="עדיין אין פריטים במערכת"
        body="פריטים נוצרים בקליטת מארז."
        action={canIntake &&
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
      <SummaryTile icon={<FlaskConical size={20} strokeWidth={1.75} />} tone={toneOfStatus(ItemStatus.InTest)} value={kpi(kpis.inTest)} label="בבדיקה" />
      <SummaryTile icon={<List size={20} strokeWidth={1.75} />} tone={toneOfStatus(ItemStatus.Queued)} value={kpi(kpis.inQueue)} label="בתור" />
      <SummaryTile icon={<Check size={20} strokeWidth={1.75} />} tone={toneOfStatus(ItemStatus.Done)} value={kpi(kpis.done)} label="הושלמו" />
    </SummaryStrip>
  );

  // The quiet "where did the finished items go" line (only when the table
  // has rows — an empty table says it in its own empty state).
  const showHint = !loading && !loadError && filteredRows.length > 0 && (hiddenFinished > 0 || statusFilter === String(ItemStatus.Done));

  return (
    <>
      <div className="items-page">
        <ItemsToolbar
          search={search}
          onSearch={setSearch}
          onAdd={canIntake ? () => setInsertOpen(true) : undefined}
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
                <Button size="small" variant="outlined" color="inherit" onClick={reload} startIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden />}>
                  נסה שוב
                </Button>
              }
            >
              טעינת הפריטים נכשלה. ייתכן שהשרת אינו זמין כרגע — נסה שוב בעוד רגע.
            </Alert>
          ) : (
            <DataTable<ItemListRow>
              columns={columns}
              rows={filteredRows}
              getRowKey={(r) => r.item_id}
              onRowClick={setSelected}
              minWidth={1100}
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

      {barcode && <BarcodeDialog open={barcode.open} onClose={() => setBarcode({ ...barcode, open: false })} itemId={barcode.id} />}

      <PackageScanIntakeDialog open={canIntake && insertOpen} onClose={() => setInsertOpen(false)} onChanged={reload} />

      <EditItemDialog
        open={!!editingItem}
        item={editingItem}
        customerOptions={editCustomerOptions}
        itemTypeOptions={editItemTypeOptions}
        onClose={() => setEditingItem(null)}
        onSaved={onEditResult}
        onDeleted={onDeleteResult}
      />
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
