"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useUrlState, useUrlTextField } from "@/lib/hooks/useUrlState";
import {
  Typography, Box, Button, Skeleton, IconButton, DialogParked, Alert, Snackbar, CircularProgress, SearchableCombobox,
} from "@/components/ui";
import {
  Clear as ClearIcon, History as HistoryIcon, Inventory as InventoryIcon, QrCode as QrCodeIcon, Science as ScienceIcon,
} from "@/components/ui/icons";
import { useGlobalScanner } from "@/lib/hooks/useGlobalScanner";
import { ACCESS, hasAnyRole } from "@/lib/auth/roles";
import { TESTING_PARAMS } from "@/app/lib/links";
import type { QueueRow, StationLite } from "@/app/lib/testing/contract";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { stationPopupOf } from "@/app/lib/testing/popup-kind";
import { StationPopupDialog } from "./tests-popups/mainPopUp";
import StationHistoryDialog from "./StationHistoryDialog";
import TestingDock from "./TestingDock";
import { useActiveWorker } from "./useActiveWorker";
import { useStationQueue } from "./queue/useStationQueue";
import {
  boxItemStepBack, filterQueue, optionsOf, orderQueue, queueItemStepBack, queueRowOfCode, queueSummary,
  type FilterOption, type StepBackRequest,
} from "./queue/queueModel";
import ItemCard from "./queue/ItemCard";
import PackageQueueCard from "./queue/PackageQueueCard";
import BlockedPackagesBanner from "./queue/BlockedPackagesBanner";
import SummaryStrip from "./queue/SummaryStrip";
import { FinishedRouteDialog, LegacyNotice, ScanDialog, useScanLocate } from "./scan";
import { BoxItemStepBackProvider, StepBackDialogs, postStepBack, useStepBack } from "./stepBack";
import { useTestWindow } from "./useTestWindow";
import { NextStationDialog, ResearchDialog } from "./ResultDialogs";
import "./testing.css";

/** Every filter of the screen lives in the URL: a refresh keeps the station
 *  and the filters, and other screens deep link in (/testing?item=<id> from
 *  the packages screen, ?station= from the command palette). */
const URL_DEFAULTS = { [TESTING_PARAMS.station]: "", [TESTING_PARAMS.item]: "", q: "", customer: "", shipment: "", itype: "" };

function TestingPageView() {
  const [url, setUrl] = useUrlState(URL_DEFAULTS);
  const stationId = Number(url.station) || null;
  const queue = useStationQueue(stationId);
  const { station, stationType, stationTypes, packageLevel, items } = queue;

  const worker = useActiveWorker();
  const actor = { workerId: worker.workerId, workerName: worker.workerName };
  // Managers only: the step-back route refuses anyone else (403), so no one else sees the button.
  const isManager = hasAnyRole(useSession().data?.roles ?? [], ACCESS.stepBack);

  // The search / scan field and the three queue filters.
  const writeQ = React.useCallback((v: string) => setUrl({ q: v }), [setUrl]);
  const [filterText, setFilterText] = useUrlTextField(url.q, writeQ);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const customerOptions = React.useMemo(() => optionsOf(items, (it) => it.customer_id, (it) => it.customer_name ?? it.customer_code, url.customer), [items, url.customer]);
  const shipmentOptions = React.useMemo(() => optionsOf(items, (it) => it.shipment_id, (it) => it.shipment_code, url.shipment), [items, url.shipment]);
  const itemTypeOptions = React.useMemo(() => optionsOf(items, (it) => it.item_type_id, (it) => it.item_type_desc, url.itype), [items, url.itype]);
  const anyFilter = !!(filterText || url.customer || url.shipment || url.itype);
  const clearFilters = () => { setFilterText(""); setUrl({ q: "", customer: "", shipment: "", itype: "" }); };

  const [highlightedItemId, setHighlightedItemId] = React.useState<number | null>(null);
  const filteredItems = React.useMemo(
    () => filterQueue(items, { q: filterText, customer: url.customer, shipment: url.shipment, itype: url.itype }),
    [items, filterText, url.customer, url.shipment, url.itype],
  );
  const { orderedItems, priorityItemId } = React.useMemo(
    () => orderQueue(filteredItems, { searching: !!filterText.trim(), highlightedItemId }),
    [filteredItems, filterText, highlightedItemId],
  );
  // Station overview, so from the unfiltered queue.
  const summary = React.useMemo(() => queueSummary(items), [items]);

  // A start-test failure or a failed step back (the page's error toast).
  const [startError, setStartError] = React.useState<string | null>(null);

  const win = useTestWindow({ station, stationType, actor, isManager, onRefresh: queue.refresh, onStartError: setStartError });
  const stepBack = useStepBack({ actor, onRefresh: queue.refresh, onError: setStartError, onClosingStopped: win.closingStopped });
  const askOf = (req: StepBackRequest | null) => (req ? () => stepBack.ask(req) : null);
  // "החזר" on a box item: from the closing queue card, and from inside the closing wizard.
  const boxQueueStepBack = (box: QueueRow) => (it: PackageItemView) => askOf(boxItemStepBack(it, isManager, { box }));
  const wizardStepBack = (it: PackageItemView) => askOf(boxItemStepBack(it, isManager, "wizard"));
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);

  const scan = useScanLocate({
    stationTypes,
    // The station goes into the URL; the queue query follows it. Filters that could hide the
    // scanned item are dropped.
    onLocated: ({ itemId, stationId: at, filterTo }) => {
      setHighlightedItemId(itemId);
      const q = filterTo ? String(itemId) : "";
      setFilterText(q);
      setUrl({ station: String(at), item: "", q, customer: "", shipment: "", itype: "" });
    },
    onFinished: () => setFilterText(""),
  });

  // Deep link ?item=<id> (the packages screen's "למסך הבדיקות"): find the
  // item's station and open it narrowed to that item. With ?station= as well
  // (the command palette) the station is already known: just filter.
  const itemLinkDone = React.useRef(false);
  // The deep link's work, with this render's handlers; the effect below decides when — once, when
  // the item and the station types are known.
  const openItemLink = React.useEffectEvent((item: string, at: string) => {
    if (at) {
      // The field follows the URL's q (useUrlTextField).
      setUrl({ item: "", q: item });
    } else {
      // Off the effect's own tick: the lookup sets loading state.
      void Promise.resolve().then(() => scan.locate(item, { filterTo: true }));
    }
  });
  React.useEffect(() => {
    if (itemLinkDone.current || !url.item || stationTypes.length === 0) return;
    itemLinkDone.current = true;
    openItemLink(url.item, url.station);
  }, [url.item, url.station, stationTypes.length]);

  // Enter in the search field: a code that names an item in this queue
  // highlights it; anything else is treated as a scan and located (it may
  // live at another station). The field is focused on arrival and after every
  // dialog, so a hardware scan needs no button press first.
  const handleFilterEnter = () => {
    const code = filterText.trim();
    if (!code) return;
    const local = queueRowOfCode(items, code);
    if (local) {
      // Like a scan located elsewhere: the field empties, so the code left in
      // it can't hide the item and the next scan starts clean.
      setHighlightedItemId(local.item_id);
      setFilterText("");
      return;
    }
    scan.locate(code);
  };

  // A scan with nothing focused (no field, no dialog) goes to the same handler
  // as the scan dialog — the document-level keyboard-wedge listener. Off while
  // a wizard is open (its overlay is not a role="dialog" the hook can see) and
  // while the scan dialog itself is.
  useGlobalScanner(scan.locate, !win.open && !scan.dialogOpen);

  // One error toast for the page: a start-test failure, or a scan that failed
  // while the scan dialog was closed (a scan from the global listener).
  const toastMessage = startError ?? (!scan.dialogOpen ? scan.error : null);
  const closeToast = () => {
    setStartError(null);
    if (!scan.dialogOpen) scan.clearError();
  };

  // Dock all-stations pick: the station goes into the URL.
  const handlePickAllStation = React.useCallback((picked: StationLite | null) => {
    setHighlightedItemId(null);
    setFilterText("");
    setUrl({ station: picked ? String(picked.id) : "", item: "", q: "" });
  }, [setUrl, setFilterText]);

  const typeNameById = React.useCallback(
    (typeId: number) => stationTypes.find((t) => t.id === typeId)?.name ?? "",
    [stationTypes],
  );

  const itemsStale = queue.stale;

  // Keep the search field ready for the next scan: focus it whenever no
  // dialog is open and nothing else holds the focus — once the closing dialog
  // has handed the focus back.
  const anyDialogOpen = win.open || scan.dialogOpen || scan.finishedOpen || win.next.open || win.research.open || historyDialogOpen
    || stepBack.open;
  React.useEffect(() => {
    if (anyDialogOpen) return;
    const t = setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) filterRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [anyDialogOpen, stationId]);

  const itemCardProps = (item: QueueRow) => ({
    item,
    onBegin: win.begin,
    highlighted: item.item_id === highlightedItemId,
    onStepBack: askOf(queueItemStepBack(item, stationTypes, isManager)) ?? undefined,
  });

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100%",
        bgcolor: "var(--color-canvas-parchment)",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
      }}
    >
        {/* Auto-hiding context dock (station + worker + scan) */}
        <TestingDock
          hasStation={!!station}
          stationName={station?.test_station_desc ?? null}
          stationTypeName={stationType?.name ?? null}
          itemCount={itemsStale ? null : filteredItems.length}
          countNoun={packageLevel ? "מארזים" : "פריטים"}
          allStations={queue.allStations}
          typeNameById={typeNameById}
          selectedStationId={station?.test_station_id ?? null}
          onPickStation={handlePickAllStation}
          activeWorkerId={worker.workerId}
          activeWorkerName={worker.workerName}
          onWorkerChange={worker.pickWorker}
          workerLocked={worker.workerLocked}
          onScan={scan.openDialog}
        />

        <LegacyNotice text={scan.legacyNotice} onDismiss={scan.dismissLegacyNotice} />

        {/* Same 1280 frame as the dock */}
        <div className="tst-frame" style={{ marginTop: 24, marginBottom: 40, flex: 1 }}>
            {/* Search / scan + queue filters. The field is focused whenever no
                dialog is open, so a hardware scan lands here without a button
                press; Enter locates the code (at this or another station). */}
            <div className="tst-filters" role="search" aria-label="חיפוש וסינון התור">
                <div className="tst-scan">
                    <QrCodeIcon fontSize={20} aria-hidden className="tst-scan-icon" />
                    <input
                        ref={filterRef}
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !scan.loading) { e.preventDefault(); handleFilterEnter(); }
                            if (e.key === "Escape") setFilterText("");
                        }}
                        placeholder={station ? "סרוק ברקוד, או חפש בתור לפי מזהה, סריאלי, מק״ט" : "סרוק ברקוד של פריט או מארז"}
                        aria-label="סריקה או חיפוש בתור"
                        aria-busy={scan.loading || undefined}
                        autoComplete="off"
                        dir="auto"
                    />
                    {scan.loading ? (
                        <span className="tst-scan-end" aria-hidden><CircularProgress size={14} /></span>
                    ) : filterText ? (
                        <IconButton size="small" className="tst-scan-end" title="ניקוי החיפוש" onClick={() => { setFilterText(""); filterRef.current?.focus(); }}><ClearIcon fontSize={16} aria-hidden /></IconButton>
                    ) : null}
                </div>
                <QueueFilter value={url.customer} onChange={(v) => setUrl({ customer: v })} options={customerOptions} allLabel="כל הלקוחות" disabled={!station} />
                <QueueFilter value={url.shipment} onChange={(v) => setUrl({ shipment: v })} options={shipmentOptions} allLabel="כל המשלוחים" disabled={!station} />
                <QueueFilter value={url.itype} onChange={(v) => setUrl({ itype: v })} options={itemTypeOptions} allLabel="כל סוגי הפריט" disabled={!station} />
                {anyFilter && <button type="button" className="tst-clear" onClick={clearFilters}>ניקוי הסינון</button>}
                {station && !itemsStale && (
                    <span className="tst-filter-count" role="status">
                        {anyFilter ? `מציג ${filteredItems.length} מתוך ${items.length}` : `${items.length} ${packageLevel ? "מארזים" : "פריטים"} בתור`}
                    </span>
                )}
            </div>

            {station || itemsStale ? (
                <Box>
                    <SummaryStrip
                        stale={itemsStale}
                        waiting={summary.waiting}
                        inTest={summary.inTest}
                        completedToday={queue.completedToday}
                        longestWaitStart={summary.longestWaitStart}
                    />

                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", mb: "18px" }}>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
                            <Typography component="h2" sx={{ m: 0, fontSize: "var(--text-lead)", fontWeight: 700, letterSpacing: "var(--ls-caption)", color: "var(--color-ink)" }}>
                                {packageLevel ? "מארזים בתור" : "התור לבדיקה"}
                            </Typography>
                            <Typography component="span" sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
                                ממוינים לפי זמן המתנה — הממתין ביותר קודם
                            </Typography>
                            {/* A refresh over a list already on screen: a quiet note, not skeletons. */}
                            <span role="status" className="tst-refreshing">
                                {queue.loading && !itemsStale && (
                                    <>
                                        <CircularProgress size={12} aria-hidden />
                                        מתעדכן…
                                    </>
                                )}
                            </span>
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <Button
                               variant="outlined"
                               color="inherit"
                               className="tst-toolbar-btn"
                               startIcon={<HistoryIcon sx={{ fontSize: 17 }} aria-hidden />}
                               onClick={() => setHistoryDialogOpen(true)}
                            >
                               היסטוריה
                            </Button>
                        </Box>
                    </Box>

                    {itemsStale ? (
                        <Box aria-hidden sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton key={i} variant="rectangular" height={70} sx={{ borderRadius: "14px" }} />
                            ))}
                        </Box>
                    ) : queue.error ? (
                        <Alert
                            severity="error"
                            action={<Button size="small" variant="text" onClick={queue.refresh} disabled={queue.loading}>נסה שוב</Button>}
                        >
                            {queue.error}
                        </Alert>
                    ) : packageLevel ? (
                        <Box sx={{ pb: 4 }}>
                            {queue.blockedPackages.length > 0 && <BlockedPackagesBanner packages={queue.blockedPackages} />}
                            {orderedItems.some((it) => it.is_package && it.package) ? (
                                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>
                                    {orderedItems.filter((it) => it.is_package && it.package).map((item) => (
                                        <PackageQueueCard
                                            key={item.item_id}
                                            item={item}
                                            onBegin={win.begin}
                                            starting={win.starting === item.item_id}
                                            stepBackOf={boxQueueStepBack(item)}
                                        />
                                    ))}
                                </Box>
                            ) : (
                                <EmptyState
                                    icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                                    title="אין מארזים בתור לעמדה זו."
                                    hint="סרוק מדבקת קופסה לאיתור מארז."
                                />
                            )}
                            {/* Loose (pre-package) items that still route through this
                                station type keep the row layout underneath the boxes. */}
                            {orderedItems.some((it) => !it.is_package) && (
                                <Box sx={{ display: "flex", flexDirection: "column", gap: "10px", mt: "18px" }}>
                                    {orderedItems.filter((it) => !it.is_package).map((item, index) => (
                                        <ItemCard key={`${item.item_id}-${index}`} rank={index + 1} {...itemCardProps(item)} />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    ) : orderedItems.length > 0 ? (
                        <Box sx={{ pb: 4 }}>
                            <Box aria-hidden sx={{ display: "flex", alignItems: "center", gap: "15px", padding: "0 16px 12px", fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-48)" }}>
                                <Box sx={{ width: 38, flexShrink: 0, textAlign: "center" }}>תור</Box>
                                <Box sx={{ flex: 1 }}>מזהה · דגם</Box>
                                <Box sx={{ width: 150, flexShrink: 0 }}>שלב</Box>
                                <Box sx={{ minWidth: 82, flexShrink: 0, textAlign: "center" }}>זמן</Box>
                                <Box sx={{ width: 40, flexShrink: 0 }} />
                                <Box sx={{ width: 120, flexShrink: 0 }} />
                            </Box>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                {orderedItems.map((item, index) => (
                                    <ItemCard
                                        key={`${item.item_id}-${index}`}
                                        rank={index + 1}
                                        {...itemCardProps(item)}
                                        priority={item.item_id === priorityItemId}
                                    />
                                ))}
                            </Box>
                        </Box>
                    ) : (
                        <EmptyState
                            icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                            title="אין פריטים תואמים בעמדה זו."
                            hint="נסה לנקות את הסינון, או סרוק ברקוד לאיתור פריט."
                        />
                    )}
                </Box>
            ) : (
                // No station yet (artboard "no station"). The dock panel above
                // stays open in this state, so "למעלה" points at real controls.
                <EmptyState
                    icon={<ScienceIcon sx={{ fontSize: 30 }} aria-hidden />}
                    title="בחר עמדה כדי להתחיל"
                    hint="בחר עמדה ועובד למעלה, או סרוק ברקוד של פריט."
                />
            )}
        </div>

        {/* The station's popup. Parked, it still thinks it is open (so it neither resets nor
            reloads); DialogParked is what hides it. */}
        {(win.open || win.parked) && win.item && station && stationType && (
          <DialogParked.Provider value={!win.open}>
            <BoxItemStepBackProvider value={wizardStepBack}>
              <StationPopupDialog
                key={win.session}
                popup={stationPopupOf(stationType, win.item)}
                onClose={win.close}
                item={win.item}
                station={station}
                stationTypeName={stationType.name}
                workerId={worker.workerId}
                workerName={worker.workerName}
                onSubmit={win.submit}
              />
            </BoxItemStepBackProvider>
          </DialogParked.Provider>
        )}

        {station && (
            <StationHistoryDialog
                open={historyDialogOpen}
                onClose={() => setHistoryDialogOpen(false)}
                stationId={station.test_station_id}
                stationName={station.test_station_desc}
            />
        )}

        <NextStationDialog
            key={win.next.seq}
            open={win.next.open}
            onClose={win.next.close}
            info={win.next.info}
            postStepBack={(req) => postStepBack(req, actor, queue.refresh)}
        />
        <StepBackDialogs dialogs={stepBack.dialogs} />
        <ResearchDialog open={win.research.open} onClose={win.research.close} station={win.research.station} />
        <FinishedRouteDialog open={scan.finishedOpen} info={scan.finished} onClose={scan.closeFinished} />
        <ScanDialog scan={scan} />

        {/* The page's error toast (start-test failures, scans from the global listener). Its own
            32px close button: the Alert's × is 24px, small for a station touchscreen. */}
        <Snackbar open={!!toastMessage} autoHideDuration={8000} onClose={closeToast} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
            <Alert
                severity="error"
                sx={{ minWidth: 320, maxWidth: 560, boxShadow: "var(--shadow-pop)" }}
                action={<IconButton size="small" title="סגירת ההודעה" onClick={closeToast} sx={{ marginBlock: "-6px", marginInlineEnd: "-6px" }}><ClearIcon fontSize={16} aria-hidden /></IconButton>}
            >
                {toastMessage}
            </Alert>
        </Snackbar>
    </Box>
  );
}

/** A queue filter: empty = everything (the placeholder says so); × goes back to it. */
function QueueFilter({ value, onChange, options, allLabel, disabled }: { value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel: string; disabled?: boolean }) {
  return (
    <SearchableCombobox<FilterOption>
      dense
      width={180}
      disabled={disabled}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o ? o.value : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      placeholder={allLabel}
      ariaLabel={allLabel}
    />
  );
}

/** The page's one empty-state shape (artboard: 64px circle, 17/600 line, 14 hint). */
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: "center", py: "64px", color: "var(--color-ink-muted-48)" }}>
      <Box sx={{ width: 64, height: 64, borderRadius: "var(--r-pill)", bgcolor: "var(--color-canvas)", border: "1px solid var(--color-hairline)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", mb: "14px" }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: "var(--text-lead)", color: "var(--color-ink)", fontWeight: 600, mb: "6px" }}>{title}</Typography>
      <Typography sx={{ fontSize: "var(--text-body-sm)" }}>{hint}</Typography>
    </Box>
  );
}

export default function TestingPage() {
  // useSearchParams (the ?station= / ?item= deep links) needs a Suspense
  // boundary so the route isn't forced into client-side rendering at build time.
  return (
    <React.Suspense fallback={null}>
      <TestingPageView />
    </React.Suspense>
  );
}
