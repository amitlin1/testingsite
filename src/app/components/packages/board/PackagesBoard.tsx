"use client";
import React from "react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Plus, ScanLine, X } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { Alert, Skeleton, Snackbar } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageScanIntakeDialog from "@/app/components/packages/PackageScanIntakeDialog";
import PackageDeleteDialog from "@/app/components/packages/PackageDeleteDialog";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import BarcodeDialog from "@/app/components/BarcodeDialog";
import { fmtDate } from "@/app/components/packages/packageUi";
import { useGlobalScanner } from "@/app/testing/useGlobalScanner";
import { useUrlState, useUrlTextField } from "@/lib/hooks/useUrlState";
import PackageRow, { stageOf, type Stage } from "./PackageRow";
import {
  sendJson, useCustomers, useInvalidatePackages, useItemTypes, usePackageTypes, usePackages, useSentLookup, useShipments,
  type Option,
} from "./queries";
import "@/app/packages/packages.css";
import "./board.css";

/**
 * /packages — one screen for boxes and the items inside them
 * (design canvas "מסך מארזים מאוחד"). A box row expands in place to its
 * items; boxes and items are edited inside their rows; intake, labels,
 * history and the jump to the testing screen are on the row itself.
 *
 * Every filter lives in the URL (useUrlState), so the shipments screen can
 * link here narrowed to one shipment and a refresh keeps the view. The data
 * comes through React Query (./queries.ts) and refreshes on focus, on a 30s
 * poll and after every change made here.
 */

type TabKey = Stage | "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "test", label: "בתהליך בדיקות" },
  { key: "pending", label: "טרם נקלטו" },
  { key: "done", label: "הושלמו · ממתינים ליציאה" },
  { key: "all", label: "הכל" },
];

const URL_DEFAULTS = { tab: "test", q: "", customer: "", shipment: "", type: "", step: "" };

/** A scanned label ("<id>" or "<id>-<source>") → the id; anything else → null. */
function scannedId(raw: string): string | null {
  const m = raw.trim().match(/^(\d{6,})(?:-\d+)?$/);
  return m ? m[1] : null;
}

function FilterSelect({ value, onChange, options, allLabel, width = 190 }: { value: string; onChange: (v: string) => void; options: Option[]; allLabel: string; width?: number }) {
  return (
    <SearchableCombobox<Option>
      dense
      width={width}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o ? o.value : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      placeholder={allLabel}
    />
  );
}

/** Where a box or one of its items is being worked: the station-type filter. */
function stepsOf(p: PackageView): string[] {
  const out: string[] = [];
  if (p.status !== "pending" && p.status !== "done" && p.current_step_desc) out.push(p.current_step_desc);
  for (const it of p.items) if ((it.state === "queue" || it.state === "test") && it.step_desc) out.push(it.step_desc);
  return out;
}

export default function PackagesBoard() {
  const sp = useSearchParams();
  const [url, setUrl] = useUrlState(URL_DEFAULTS);
  const invalidate = useInvalidatePackages();

  // The scan field is typed into instantly; the URL follows after a pause.
  const writeQ = React.useCallback((v: string) => setUrl({ q: v }), [setUrl]);
  const [qInput, setQInput] = useUrlTextField(url.q, writeQ);

  const packages = usePackages(url.shipment);
  const customers = useCustomers();
  const shipments = useShipments();
  const packageTypes = usePackageTypes();
  const itemTypes = useItemTypes();

  const all = React.useMemo(() => packages.data ?? [], [packages.data]);
  const shipmentList = React.useMemo(() => shipments.data ?? [], [shipments.data]);
  const shipmentOptions = React.useMemo<Option[]>(
    () => shipmentList.map((s) => ({ value: String(s.id), label: `${s.shipment_code}${s.customer_name ? ` · ${s.customer_name}` : ""}${s.is_sent ? " · יצא" : ""}` })),
    [shipmentList],
  );
  const selectedShipment = shipmentList.find((s) => String(s.id) === url.shipment) ?? null;
  // A shipment that already went out: its boxes are shown for their history only.
  const sentView = !!url.shipment && (selectedShipment?.is_sent === true || (all.length > 0 && all.every((p) => p.shipment_is_sent)));

  // Customer / type / station first: the tab counts are counted after them.
  const base = React.useMemo(
    () => all.filter((p) =>
      (url.customer === "" || String(p.customer_id) === url.customer) &&
      (url.type === "" || String(p.item_type_id) === url.type) &&
      (url.step === "" || stepsOf(p).includes(url.step)),
    ),
    [all, url.customer, url.type, url.step],
  );
  const stepOptions = React.useMemo<Option[]>(
    () => [...new Set(all.flatMap(stepsOf))].sort((a, b) => a.localeCompare(b, "he")).map((s) => ({ value: s, label: s })),
    [all],
  );

  // Search / scan: an exact label match wins; otherwise a contains-match on
  // ids, serials, makat, type, customer and shipment. It runs over every
  // stage — a scanned box is found whatever tab is open.
  const ql = qInput.trim().toLowerCase();
  const searching = ql.length > 0;
  const { list, hitPkgs, hitItems, exact } = React.useMemo(() => {
    const hitPkgs = new Set<string>();
    const hitItems = new Set<string>();
    if (!searching) {
      const tab = url.tab as TabKey;
      return { list: sentView ? base : base.filter((p) => tab === "all" || stageOf(p) === tab), hitPkgs, hitItems, exact: false };
    }
    const id = scannedId(ql);
    if (id) {
      for (const p of base) {
        if (p.item_id === id) hitPkgs.add(p.item_id);
        for (const it of p.items) if (it.item_id === id) { hitPkgs.add(p.item_id); hitItems.add(it.item_id); }
      }
      if (hitPkgs.size > 0) return { list: base.filter((p) => hitPkgs.has(p.item_id)), hitPkgs, hitItems, exact: true };
    }
    const has = (s: string | null | undefined) => (s ?? "").toLowerCase().includes(ql);
    const out = base.filter((p) => {
      const items = p.items.filter((it) => it.item_id.includes(ql) || has(it.serial_no) || has(it.makat));
      items.forEach((it) => hitItems.add(it.item_id));
      const own = p.item_id.includes(ql) || has(p.makat) || has(p.item_type_desc) || has(p.customer_name) || has(p.shipment_code);
      if (items.length > 0) hitPkgs.add(p.item_id);
      return own || items.length > 0;
    });
    return { list: out, hitPkgs, hitItems, exact: false };
  }, [base, ql, searching, url.tab, sentView]);

  const counts = React.useMemo(() => {
    const c: Record<TabKey, number> = { test: 0, pending: 0, done: 0, all: base.length };
    for (const p of base) c[stageOf(p)]++;
    return c;
  }, [base]);

  // Nothing active matched a code: maybe the box already left with its shipment.
  const debouncedQ = url.q.trim();
  const sentLookup = useSentLookup(searching && list.length === 0 && !packages.isLoading && debouncedQ.length >= 4 ? (scannedId(debouncedQ) ?? debouncedQ) : null);

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Dialogs and the one toast.
  const [intakeOpen, setIntakeOpen] = React.useState(sp.get("new") === "1");
  const [labelsFor, setLabelsFor] = React.useState<PackageView | null>(null);
  const [deleteFor, setDeleteFor] = React.useState<PackageView | null>(null);
  const [barcodeFor, setBarcodeFor] = React.useState<{ id: number; sourceId: number | null; serial?: string } | null>(null);
  const [toast, setToast] = React.useState<{ text: string; error?: boolean; undoId?: string } | null>(null);
  const sourceOf = (p: PackageView) => shipmentList.find((s) => s.id === p.shipment_id)?.source_id ?? null;

  const intake = useMutation({
    mutationFn: (id: string) => sendJson<{ package?: PackageView }>("/api/packages/intake", "POST", { barcode: id }),
    onSuccess: (data, id) => {
      invalidate();
      const p = data.package;
      setToast({ text: p ? `${p.item_type_desc} נקלט · ${p.items.length} פריטים · ממתין בעמדת הפתיחה` : "המארז נקלט", undoId: id });
    },
    onError: (e) => setToast({ text: e.message, error: true }),
  });
  const undoIntake = useMutation({
    mutationFn: (id: string) => sendJson(`/api/packages/${id}/intake`, "DELETE"),
    onSuccess: () => { invalidate(); setToast({ text: "הקליטה בוטלה" }); },
    onError: (e) => setToast({ text: e.message, error: true }),
  });

  // A hardware scan with nothing focused lands in the scan field.
  const scanRef = React.useRef<HTMLInputElement>(null);
  const dialogOpen = intakeOpen || !!labelsFor || !!deleteFor || !!barcodeFor;
  useGlobalScanner((code) => { setQInput(code.trim()); scanRef.current?.focus(); }, !dialogOpen);

  const clearFilters = () => { setQInput(""); setUrl({ q: "", customer: "", shipment: "", type: "", step: "" }); };
  const anyFilter = !!(url.customer || url.shipment || url.type || url.step || qInput);
  const firstLoad = packages.isLoading && all.length === 0;
  const single = exact && list.length === 1 ? list[0] : null;
  const singleItem = single ? single.items.find((it) => hitItems.has(it.item_id)) : undefined;

  return (
    <div dir="rtl" className="pb-page">
      <div className="pb-head">
        <div>
          <h1 className="pb-title">מארזים ופריטים</h1>
          <p className="pb-sub">כל מארז והפריטים שבתוכו, איפה כל אחד עומד במסלול, ועריכה במקום.</p>
        </div>
        <button type="button" className="pkg-pill pkg-pill--primary pkg-pill--lg" onClick={() => setIntakeOpen(true)}>
          <Plus size={18} strokeWidth={2} aria-hidden />קליטת מארזים
        </button>
      </div>

      <div className="pb-filters">
        <div className="pb-filter-row">
          <div className="pb-scan">
            <ScanLine size={20} strokeWidth={1.75} className="pb-scan-icon" aria-hidden />
            <input
              ref={scanRef}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setQInput(""); }}
              placeholder="סרוק ברקוד מארז או פריט · או הקלד מזהה, סריאלי, מק״ט"
              aria-label="סריקה או חיפוש של מארז או פריט"
              autoComplete="off"
              autoFocus
            />
            {qInput && (
              <button type="button" className="pkg-iconbtn pb-scan-clear" aria-label="ניקוי החיפוש" onClick={() => { setQInput(""); scanRef.current?.focus(); }}>
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>
          <FilterSelect value={url.customer} onChange={(v) => setUrl({ customer: v })} options={customers.data ?? []} allLabel="כל הלקוחות" />
          <FilterSelect value={url.shipment} onChange={(v) => setUrl({ shipment: v })} options={shipmentOptions} allLabel="כל המשלוחים" width={210} />
          <FilterSelect value={url.type} onChange={(v) => setUrl({ type: v })} options={packageTypes.data ?? []} allLabel="כל סוגי המארז" />
          <FilterSelect value={url.step} onChange={(v) => setUrl({ step: v })} options={stepOptions} allLabel="כל העמדות" />
          {anyFilter && <button type="button" className="pkg-link" onClick={clearFilters}>ניקוי הסינון</button>}
        </div>
        <div className="pb-tabs" role="tablist" aria-label="סינון לפי שלב">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className="pb-tab"
              aria-selected={!searching && !sentView && url.tab === t.key}
              onClick={() => { setQInput(""); setUrl({ tab: t.key, q: "" }); }}>
              {t.label}<span className="pb-tab-count">{firstLoad ? "—" : counts[t.key]}</span>
            </button>
          ))}
          {searching && <span className="pb-note" style={{ marginInlineStart: 8 }}>החיפוש רץ על כל השלבים</span>}
          {packages.isFetching && !firstLoad && <span className="pb-note" role="status" style={{ marginInlineStart: "auto" }}>מתעדכן…</span>}
        </div>
      </div>

      {sentView && (
        <div className="pb-band" role="status">
          <span className="pb-dot" style={{ background: "var(--color-ink-muted-48)" }} aria-hidden />
          המשלוח {selectedShipment?.shipment_code ?? ""} יצא ללקוח{selectedShipment?.shipment_sent_date ? ` ב-${fmtDate(selectedShipment.shipment_sent_date)}` : ""}. המארזים מוצגים לצפייה בהיסטוריה בלבד.
        </div>
      )}

      {searching && !firstLoad && (
        list.length > 0 ? (
          <div className="pb-band pb-band--hit" role="status">
            <span className="pb-dot" style={{ background: "var(--color-primary)" }} aria-hidden />
            {single
              ? <>נמצא: מארז {single.item_id} · {single.item_type_desc}{singleItem ? ` · פריט ${String(singleItem.package_seq ?? "").padStart(2, "0")} מסומן בתוכו` : ""}{single.status === "pending" ? " · אפשר לקלוט אותו ישירות מהשורה" : ""}</>
              : <>{list.length} מארזים תואמים</>}
          </div>
        ) : sentLookup.data && sentLookup.data.length > 0 ? (
          <div className="pb-band" role="status">
            <span className="pb-dot" style={{ background: "var(--color-ink-muted-48)" }} aria-hidden />
            <span style={{ flex: 1 }}>
              מארז {sentLookup.data[0].item_id} יצא ללקוח עם משלוח {sentLookup.data[0].shipment_code ?? "—"}
              {sentLookup.data[0].shipment_sent_at ? ` ב-${fmtDate(sentLookup.data[0].shipment_sent_at)}` : ""} ולכן לא מוצג כאן. ההיסטוריה שלו נשמרת.
            </span>
            <NextLink href={`/packages/${sentLookup.data[0].item_id}`} className="pkg-link" style={{ fontWeight: 600 }}>היסטוריית המארז</NextLink>
          </div>
        ) : (
          <div className="pb-band pb-band--miss" role="status">
            <span className="pb-dot" style={{ background: "var(--color-destructive)" }} aria-hidden />
            {sentLookup.isFetching ? "מחפש גם במשלוחים שיצאו…" : "לא נמצא מארז או פריט עם הקוד הזה."}
          </div>
        )
      )}

      <div className="pb-table">
        <div className="pb-table-inner">
          <div className="pb-grid pb-th" aria-hidden>
            <span /><span>מזהה המארז</span><span>סוג מארז · לקוח · משלוח</span><span>פריטים</span><span>שלב במסלול · עמדה</span><span>סטטוס</span><span style={{ textAlign: "end" }}>פעולות</span>
          </div>

          {firstLoad && Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="pb-grid pb-pkg-row pb-pkg" aria-hidden>
              <span /><div><Skeleton width={150} height={13} /><Skeleton width={80} height={11} style={{ marginTop: 6 }} /></div>
              <div><Skeleton width={140} height={13} /><Skeleton width={110} height={11} style={{ marginTop: 6 }} /></div>
              <Skeleton width={90} height={12} /><Skeleton width={200} height={10} /><Skeleton width={96} height={24} style={{ borderRadius: 9999 }} /><span />
            </div>
          ))}

          {!firstLoad && list.map((p) => (
            <PackageRow
              key={p.item_id}
              pkg={p}
              expanded={expanded.has(p.item_id) || (searching && (hitItems.size > 0 ? hitPkgs.has(p.item_id) : list.length === 1))}
              onToggle={() => toggle(p.item_id)}
              hit={searching && hitPkgs.has(p.item_id)}
              hitItems={hitItems}
              itemTypes={itemTypes.data ?? []}
              onIntake={() => intake.mutate(p.item_id)}
              intakeBusy={intake.isPending && intake.variables === p.item_id}
              onLabels={() => setLabelsFor(p)}
              onDelete={() => setDeleteFor(p)}
              onBarcode={(it) => setBarcodeFor({ id: Number(it.item_id), sourceId: sourceOf(p), serial: it.serial_no ?? undefined })}
            />
          ))}

          {packages.isError && !packages.isFetching && (
            <div style={{ padding: 16 }}>
              <Alert severity="error" action={<button type="button" className="pkg-pill pkg-pill--ghost pkg-pill--sm" onClick={() => packages.refetch()}>נסה שוב</button>}>
                טעינת המארזים נכשלה. בדוק את החיבור ונסה שוב.
              </Alert>
            </div>
          )}

          {/* While searching, the band above already says what happened. */}
          {!firstLoad && !packages.isError && list.length === 0 && !searching && (
            <div className="pb-empty">
              {all.length === 0 ? (
                <>
                  <div style={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>{url.shipment ? "אין מארזים במשלוח הזה." : "אין מארזים פעילים."}</div>
                  <div className="pb-note" style={{ marginTop: 4 }}>מארזים נוצרים מהמשלוח וממתינים כאן לקליטה.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>אין מארזים תואמים.</div>
                  <div className="pb-note" style={{ marginTop: 4 }}>נקה את החיפוש או החלף שלב.</div>
                  {anyFilter && <button type="button" className="pkg-pill pkg-pill--ghost pkg-pill--sm" style={{ marginTop: 14 }} onClick={clearFilters}>ניקוי הסינון</button>}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <PackageScanIntakeDialog open={intakeOpen} onClose={() => setIntakeOpen(false)} onChanged={invalidate} />
      <PackageDeleteDialog open={!!deleteFor} pkg={deleteFor} onClose={() => setDeleteFor(null)} onDeleted={() => { setDeleteFor(null); invalidate(); }} />
      {labelsFor && (
        <PackageLabelsDialog
          open
          onClose={() => setLabelsFor(null)}
          packageId={labelsFor.item_id}
          packageType={labelsFor.item_type_desc}
          customerLine={`${labelsFor.customer_name ?? labelsFor.customer_code ?? ""} · משלוח ${labelsFor.shipment_code ?? ""}`}
          sourceId={sourceOf(labelsFor)}
          items={labelsFor.items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no }))}
        />
      )}
      {barcodeFor && (
        <BarcodeDialog open onClose={() => setBarcodeFor(null)} itemId={barcodeFor.id} sourceId={barcodeFor.sourceId} itemSerial={barcodeFor.serial} />
      )}

      <Snackbar open={!!toast} autoHideDuration={toast?.undoId ? 10000 : 6000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert
          severity={toast?.error ? "error" : "success"}
          action={toast?.undoId ? (
            <button type="button" className="pkg-pill pkg-pill--ghost pkg-pill--sm" disabled={undoIntake.isPending} onClick={() => undoIntake.mutate(toast.undoId!)}>בטל</button>
          ) : undefined}
        >
          {toast?.text}
        </Alert>
      </Snackbar>
    </div>
  );
}
