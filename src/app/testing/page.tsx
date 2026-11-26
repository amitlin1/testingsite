"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useUrlState, useUrlTextField } from "@/lib/hooks/useUrlState";
import { Typography, Box, Button, Skeleton, IconButton, DialogParked, Alert, Snackbar, CircularProgress } from "@/components/ui";
import {
  Clear as ClearIcon, Inventory as InventoryIcon, PlayArrowRounded as PlayArrowRoundedIcon, Science as ScienceIcon,
} from "@/components/ui/icons";
import { AlertTriangle } from "lucide-react";
import { useGlobalScanner } from "@/lib/hooks/useGlobalScanner";
import { fromHebrewLayout } from "@/lib/scan/scannerKeys";
import { playCue } from "@/lib/scan/sound";
import { ACCESS, can } from "@/lib/auth/roles";
import { TESTING_PARAMS } from "@/app/lib/links";
import { formatIdText } from "@/app/lib/packages/ids";
import type { QueueRow, StationLite } from "@/app/lib/testing/contract";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { stationPopupOf } from "@/app/lib/testing/popup-kind";
import { StationPopupDialog } from "./tests-popups/mainPopUp";
import StationHistoryDialog from "./StationHistoryDialog";
import StationBar from "./StationBar";
import { useActiveWorker } from "./useActiveWorker";
import { useStationQueue } from "./queue/useStationQueue";
import { boxItemStepBack, filterQueue, queueItemStepBack, queueRowOfCode, queueSummary, type StepBackRequest } from "./queue/queueModel";
import {
  buildTree, customerLabel, nearestNode, nextToStart, nodeOf, rowsOfNode, shipmentKeyOf, shipmentLabel, shipmentNodeOf, urlOfNode,
  type CustomerBranch, type QueueNode, type ShipmentBranch, type TreeSort,
} from "./queue/treeModel";
import QueueTree from "./queue/QueueTree";
import QueueList, { type ListGroup } from "./queue/QueueList";
import ScannedItem, { ScanBand } from "./queue/ScannedItem";
import PackageQueueCard from "./queue/PackageQueueCard";
import BlockedPackagesBanner from "./queue/BlockedPackagesBanner";
import { FinishedRouteDialog, LegacyNotice, useScanLocate } from "./scan";
import { BoxItemStepBackProvider, StepBackDialogs, postStepBack, useStepBack } from "./stepBack";
import { useTestWindow } from "./useTestWindow";
import { NextStationDialog, ResearchDialog } from "./ResultDialogs";
import { ClockInfoIcon } from "@/app/components/ClockInfo/ClockInfo";
import "./testing.css";

/** Every state of the screen lives in the URL: a refresh keeps the station, the open node of the
 *  tree (customer / shipment), the scanned row (focus) and the search, and other screens deep
 *  link in (/testing?item=<id> from the packages screen, ?station= from the command palette). */
const URL_DEFAULTS = { [TESTING_PARAMS.station]: "", [TESTING_PARAMS.item]: "", q: "", customer: "", shipment: "", focus: "" };

/**
 * The testing screen (design: the canvas "מסך בדיקה — עיצוב מחדש כעץ", direction A): the station's
 * queue as a tree — customer › shipment › rows — beside the open node's rows, and a scan that jumps
 * straight to the scanned row. The station popups, the result / step-back / history dialogs and
 * the box cards are the same components as before; only the queue around them changed.
 */
function TestingPageView() {
  const [url, setUrl] = useUrlState(URL_DEFAULTS);
  const stationId = Number(url.station) || null;
  const queue = useStationQueue(stationId);
  const { station, stationType, stationTypes, packageLevel, items } = queue;
  const countNoun = packageLevel ? "מארזים" : "פריטים";

  const worker = useActiveWorker();
  const actor = { workerId: worker.workerId, workerName: worker.workerName };
  // Only who holds ACCESS.stepBack (by default managers and testers): the step-back route refuses
  // anyone else (403), so no one else sees the button.
  const canStepBack = can(useSession().data?.roles, ACCESS.stepBack);

  // The scan / search field: typing narrows the tree and the rows; Enter (a scanner ends with it)
  // jumps to the code's row.
  const writeQ = React.useCallback((v: string) => setUrl({ q: v }), [setUrl]);
  const [filterText, setFilterText] = useUrlTextField(url.q, writeQ);
  const scanRef = React.useRef<HTMLInputElement>(null);
  const [sort, setSort] = React.useState<TreeSort>("wait");
  // The last code that landed (the field's green "נסרק"), until the next keystroke.
  const [landed, setLanded] = React.useState<string | null>(null);
  // The scan moved the screen to another station: its name, for the band.
  const [movedTo, setMovedTo] = React.useState<string | null>(null);

  // The scanned row, while the queue still holds it (once tested it leaves, and its shipment shows).
  const focusItem = url.focus ? items.find((it) => String(it.item_id) === url.focus) ?? null : null;
  // While a row is shown alone, what is typed is the next scan, not a search: the tree stays whole.
  const searched = React.useMemo(
    () => (focusItem ? items : filterQueue(items, { q: filterText, customer: "", shipment: "", itype: "" })),
    [items, filterText, focusItem],
  );
  const tree = React.useMemo(() => buildTree(searched, queue.shipmentProgress, sort), [searched, queue.shipmentProgress, sort]);
  const node: QueueNode = focusItem ? shipmentNodeOf(focusItem) : nearestNode(tree, nodeOf(url.customer, url.shipment));
  const rows = React.useMemo(() => rowsOfNode(searched, node), [searched, node]);
  // Station numbers, so from the whole queue.
  const summary = React.useMemo(() => queueSummary(items), [items]);

  // A start-test failure or a failed step back (the page's error toast).
  const [startError, setStartError] = React.useState<string | null>(null);

  const win = useTestWindow({ station, stationType, actor, canStepBack, onRefresh: queue.refresh, onStartError: setStartError });
  const stepBack = useStepBack({ actor, onRefresh: queue.refresh, onError: setStartError, onClosingStopped: win.closingStopped });
  const askOf = (req: StepBackRequest | null) => (req ? () => stepBack.ask(req) : null);
  // "החזר" on a box item: from the closing queue card, and from inside the closing wizard.
  const boxQueueStepBack = (box: QueueRow) => (it: PackageItemView) => askOf(boxItemStepBack(it, canStepBack, { box }));
  const wizardStepBack = (it: PackageItemView) => askOf(boxItemStepBack(it, canStepBack, "wizard"));
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);

  const pick = (n: QueueNode) => {
    setMovedTo(null);
    setUrl({ ...urlOfNode(n), focus: "" });
  };

  // A row begun from the scanned view keeps its shipment in the URL: after the result it has left
  // the queue, and the screen stays on that shipment instead of jumping to the whole queue.
  const begin = (row: QueueRow) => {
    if (focusItem && row.item_id === focusItem.item_id) setUrl(urlOfNode(shipmentNodeOf(row)));
    win.begin(row);
  };

  const scan = useScanLocate({
    stationTypes,
    // The station goes into the URL; the queue query follows it, and the row shows alone once
    // its queue answers.
    onLocated: ({ itemId, stationId: at }) => {
      setFilterText("");
      setMovedTo(at !== stationId ? queue.allStations.find((s) => s.id === at)?.name ?? null : null);
      setLanded(formatIdText(itemId));
      setUrl({ station: String(at), item: "", q: "", customer: "", shipment: "", focus: String(itemId) });
      playCue("ok");
    },
    onFinished: () => setFilterText(""),
  });

  // A code: a row of this queue (by id, a label's id part, or its exact serial) shows at once;
  // anything else is located (it may wait at another station). A code typed through the Hebrew
  // layout is read back as the US keys that typed it — our barcodes hold no Hebrew.
  const handleCode = (raw: string) => {
    const code = fromHebrewLayout(raw.trim());
    if (!code) return;
    const local = queueRowOfCode(items, code);
    if (local) {
      setFilterText("");
      setMovedTo(null);
      setLanded(formatIdText(local.item_id));
      setUrl({ ...urlOfNode(shipmentNodeOf(local)), q: "", focus: String(local.item_id) });
      playCue("ok");
      return;
    }
    void scan.locate(code);
  };

  // A failed scan: the low buzz, and the field keeps the code selected so the next scan replaces it.
  React.useEffect(() => {
    if (!scan.error) return;
    playCue("error");
    scanRef.current?.select();
  }, [scan.error]);

  // Deep link ?item=<id> (the packages screen's "למסך הבדיקות"): find the item's station and show
  // it alone. With ?station= as well (the command palette) the station is already known.
  const itemLinkDone = React.useRef(false);
  const openItemLink = React.useEffectEvent((item: string, at: string) => {
    if (at) {
      setUrl({ item: "", focus: item });
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

  // A scan with nothing focused (no field, no dialog) goes to the same handler — the
  // document-level keyboard-wedge listener. Off while a wizard is open (its overlay is not a
  // role="dialog" the hook can see).
  useGlobalScanner(handleCode, !win.open && !scan.dialogOpen);

  // One error toast for the page: a start-test failure. A scan's failure is the band above the
  // rows (it stays until the next scan or "סגירה").
  const closeToast = () => setStartError(null);

  // The station picked in the bar goes into the URL; the tree starts from the whole queue.
  const handlePickStation = React.useCallback((picked: StationLite | null) => {
    setFilterText("");
    setLanded(null);
    setMovedTo(null);
    setUrl({ station: picked ? String(picked.id) : "", item: "", q: "", customer: "", shipment: "", focus: "" });
  }, [setUrl, setFilterText]);

  const typeNameById = React.useCallback(
    (typeId: number) => stationTypes.find((t) => t.id === typeId)?.name ?? "",
    [stationTypes],
  );

  const itemsStale = queue.stale;

  // Keep the scan field ready for the next scan: focus it whenever no dialog is open and nothing
  // else holds the focus — once the closing dialog has handed the focus back.
  const anyDialogOpen = win.open || scan.dialogOpen || scan.finishedOpen || win.next.open || win.research.open || historyDialogOpen
    || stepBack.open;
  React.useEffect(() => {
    if (anyDialogOpen) return;
    const t = setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) scanRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [anyDialogOpen, stationId]);

  const rowProps = (item: QueueRow) => ({
    onBegin: begin,
    starting: win.starting === item.item_id,
    onStepBack: askOf(queueItemStepBack(item, stationTypes, canStepBack)) ?? undefined,
  });

  const customer = node.kind === "all" ? undefined : tree.find((c) => c.key === node.customer);
  const shipment = node.kind === "shipment" ? customer?.shipments.find((s) => s.key === node.shipment) : undefined;
  const boxes = rows.filter((it) => it.is_package && it.package);
  const loose = packageLevel ? rows.filter((it) => !it.is_package) : rows;
  const next = nextToStart(packageLevel ? boxes : rows);

  return (
    <Box sx={{ width: "100%", minHeight: "100%", bgcolor: "var(--color-canvas-parchment)", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <StationBar
        station={station ? { id: station.test_station_id, name: station.test_station_desc } : null}
        stationTypeName={stationType?.name ?? null}
        allStations={queue.allStations}
        typeNameById={typeNameById}
        onPickStation={handlePickStation}
        workerId={worker.workerId}
        workerName={worker.workerName}
        workerLocked={worker.workerLocked}
        onWorkerChange={worker.pickWorker}
        scanInputRef={scanRef}
        scan={{
          value: filterText,
          onChange: (v) => { setFilterText(v); setLanded(null); if (scan.error) scan.clearError(); },
          onKeyDown: (e) => {
            if (e.key === "Enter" && !scan.loading) { e.preventDefault(); handleCode(filterText); }
            if (e.key === "Escape") {
              setFilterText("");
              if (url.focus) pick(focusItem ? shipmentNodeOf(focusItem) : nodeOf(url.customer, url.shipment));
            }
          },
          loading: scan.loading,
          landed,
          placeholder: station ? "סרקו ברקוד של פריט או מארז — או הקלידו מזהה, סריאלי, מק״ט" : "סרקו ברקוד של פריט או מארז",
        }}
        counts={station || itemsStale ? {
          waiting: itemsStale ? null : summary.waiting,
          inTest: itemsStale ? null : summary.inTest,
          completedToday: queue.completedToday,
        } : null}
        onHistory={station ? () => setHistoryDialogOpen(true) : null}
      />

      <LegacyNotice text={scan.legacyNotice} onDismiss={scan.dismissLegacyNotice} />

      <div className="tst-frame" style={{ flex: 1 }}>
        {station || itemsStale ? (
          <div className="tst-board">
            {itemsStale ? (
              <Skeleton variant="rectangular" height={420} sx={{ borderRadius: "var(--r-lg)", flex: "1 1 300px", maxWidth: 360 }} />
            ) : (
              <QueueTree tree={tree} node={node} total={searched.length} sort={sort} onSort={setSort} onPick={pick} countNoun={countNoun} />
            )}

            <main className="tst-content">
              {itemsStale ? (
                <Box aria-hidden sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rectangular" height={80} sx={{ borderRadius: "var(--r-lg)" }} />)}
                </Box>
              ) : queue.error ? (
                <Alert severity="error" action={<Button size="small" variant="text" onClick={queue.refresh} disabled={queue.loading}>נסה שוב</Button>}>
                  {queue.error}
                </Alert>
              ) : (
                <>
                  {/* The whole queue is the root: no path to show. */}
                  {(node.kind !== "all" || focusItem) && <Crumbs node={node} customer={customer} shipment={shipment} focusItem={focusItem} onPick={pick} />}

                  {scan.error && (
                    <div role="alert" className="tst-band tst-band--warn">
                      <AlertTriangle size={24} strokeWidth={1.75} aria-hidden style={{ color: "var(--color-warning-ink)", flexShrink: 0 }} />
                      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{scan.error}</div>
                        <div className="tst-band-sub">בדקו שהמדבקה שייכת לפריט או למארז, או הקלידו את המזהה. המסך לא זז.</div>
                      </div>
                      <button type="button" className="tst-btn-quiet" onClick={() => { scan.clearError(); scanRef.current?.focus(); }}>סגירה</button>
                    </div>
                  )}

                  {focusItem ? (
                    <>
                      <ScanBand
                        item={focusItem}
                        movedTo={movedTo}
                        noun={focusItem.is_package ? "המארז" : "הפריט"}
                        onShowShipment={() => pick(shipmentNodeOf(focusItem))}
                        onBack={() => pick({ kind: "all" })}
                      />
                      {focusItem.is_package && focusItem.package ? (
                        <Box sx={{ maxWidth: 560 }}>
                          <PackageQueueCard item={focusItem} onBegin={begin} starting={win.starting === focusItem.item_id} stepBackOf={boxQueueStepBack(focusItem)} />
                        </Box>
                      ) : (
                        <ScannedItem
                          item={focusItem}
                          boxMatesHere={focusItem.package_id != null ? items.filter((it) => it.package_id === focusItem.package_id && it.item_id !== focusItem.item_id).length : 0}
                          onBegin={begin}
                          starting={win.starting === focusItem.item_id}
                          onStepBack={askOf(queueItemStepBack(focusItem, stationTypes, canStepBack)) ?? undefined}
                        />
                      )}
                      <SiblingRows
                        focusItem={focusItem}
                        rows={rows.filter((it) => it.item_id !== focusItem.item_id)}
                        packageLevel={packageLevel}
                        rowProps={rowProps}
                        renderBox={(it) => <PackageQueueCard key={it.item_id} item={it} onBegin={begin} starting={win.starting === it.item_id} stepBackOf={boxQueueStepBack(it)} />}
                      />
                    </>
                  ) : (
                    <>
                      <NodeHead
                        node={node}
                        customer={customer}
                        shipment={shipment}
                        count={rows.length}
                        customers={tree.length}
                        countNoun={countNoun}
                        refreshing={queue.loading}
                        next={next}
                        onNext={() => next && begin(next)}
                        startingNext={next != null && win.starting === next.item_id}
                      />

                      {packageLevel && queue.blockedPackages.length > 0 && <BlockedPackagesBanner packages={queue.blockedPackages} />}

                      {rows.length === 0 ? (
                        items.length === 0 ? (
                          <EmptyState
                            icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                            title={packageLevel ? "אין מארזים בתור לעמדה זו." : "אין פריטים בתור לעמדה זו."}
                            hint={packageLevel ? "סרקו מדבקת קופסה לאיתור מארז." : "סרקו ברקוד לאיתור פריט."}
                          />
                        ) : (
                          <EmptyState
                            icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                            title="אין פריטים שתואמים לחיפוש."
                            hint="נקו את החיפוש, או סרקו ברקוד לאיתור פריט."
                            action={<Button variant="outlined" onClick={() => { setFilterText(""); scanRef.current?.focus(); }}>ניקוי החיפוש</Button>}
                          />
                        )
                      ) : (
                        <>
                          {boxes.length > 0 && (
                            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>
                              {boxes.map((it) => (
                                <PackageQueueCard key={it.item_id} item={it} onBegin={begin} starting={win.starting === it.item_id} stepBackOf={boxQueueStepBack(it)} />
                              ))}
                            </Box>
                          )}
                          {/* Loose (pre-package) items that still route through a box station keep the rows. */}
                          {loose.length > 0 && (
                            <QueueList
                              label={`${countNoun} בתור`}
                              groups={groupsOf(node, customer, loose, pick)}
                              showPlace={node.kind === "all"}
                              rowProps={rowProps}
                            />
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </main>
          </div>
        ) : (
          // No station yet: the bar above holds the station search, open.
          <EmptyState
            icon={<ScienceIcon sx={{ fontSize: 30 }} aria-hidden />}
            title="בחרו עמדה כדי להתחיל"
            hint="בחרו עמדה ועובד למעלה, או סרקו ברקוד של פריט."
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
        postStepBack={(req, reason) => postStepBack(req, reason, actor, queue.refresh)}
      />
      <StepBackDialogs dialogs={stepBack.dialogs} />
      <ResearchDialog open={win.research.open} onClose={win.research.close} station={win.research.station} />
      <FinishedRouteDialog open={scan.finishedOpen} info={scan.finished} onClose={scan.closeFinished} />

      {/* The page's error toast (start-test failures). Its own 32px close button: the Alert's × is
          24px, small for a station touchscreen. */}
      <Snackbar open={!!startError} autoHideDuration={8000} onClose={closeToast} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert
          severity="error"
          sx={{ minWidth: 320, maxWidth: 560, boxShadow: "var(--shadow-pop)" }}
          action={<IconButton size="small" title="סגירת ההודעה" onClick={closeToast} sx={{ marginBlock: "-6px", marginInlineEnd: "-6px" }}><ClearIcon fontSize={16} aria-hidden /></IconButton>}
        >
          {startError}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/** The open node's rows as list groups: a customer's per shipment (in the tree's order, each with
 *  its sub-header), anything else as one group. */
function groupsOf(node: QueueNode, customer: CustomerBranch | undefined, rows: readonly QueueRow[], pick: (n: QueueNode) => void): ListGroup[] {
  if (node.kind !== "customer" || !customer) return [{ key: "all", rows }];
  return customer.shipments
    .map((s) => ({
      key: s.key,
      head: {
        title: shipmentLabel(s.code),
        meta: s.progress && s.progress.total > 0 ? `${s.progress.done}/${s.progress.total} סיימו כאן` : `${s.count} בתור`,
        onOpen: () => pick({ kind: "shipment", customer: customer.key, shipment: s.key }),
      },
      rows: rows.filter((it) => shipmentKeyOf(it) === s.key),
    }))
    .filter((g) => g.rows.length > 0);
}

/** "כל התור › לקוח 410 › משלוח 7731 (› the scanned row)": every step but the last goes back up. */
function Crumbs({ node, customer, shipment, focusItem, onPick }: {
  node: QueueNode;
  customer: CustomerBranch | undefined;
  shipment: ShipmentBranch | undefined;
  focusItem: QueueRow | null;
  onPick: (n: QueueNode) => void;
}) {
  const steps: { label: string; to: QueueNode | null }[] = [{ label: "כל התור", to: { kind: "all" } }];
  if (node.kind !== "all") steps.push({ label: customerLabel(customer?.code ?? null), to: { kind: "customer", customer: node.customer } });
  if (node.kind === "shipment") steps.push({ label: shipmentLabel(shipment?.code ?? null), to: node });
  if (focusItem) steps.push({ label: formatIdText(focusItem.item_id), to: null });
  return (
    <nav aria-label="מיקום בעץ">
      <ol className="tst-crumbs">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <span aria-hidden className="tst-crumb-sep">‹</span>}
              {last || !s.to ? (
                <span aria-current="page"><bdi>{s.label}</bdi></span>
              ) : (
                <button type="button" onClick={() => onPick(s.to!)}>{s.label}</button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The open node's title, what it holds, a shipment's progress, and "התחל את הבא". */
function NodeHead({ node, customer, shipment, count, customers, countNoun, refreshing, next, onNext, startingNext }: {
  node: QueueNode;
  customer: CustomerBranch | undefined;
  shipment: ShipmentBranch | undefined;
  count: number;
  customers: number;
  countNoun: string;
  refreshing: boolean;
  next: QueueRow | undefined;
  onNext: () => void;
  startingNext: boolean;
}) {
  const title = node.kind === "all" ? "כל התור" : node.kind === "customer" ? customerLabel(customer?.code ?? null) : shipmentLabel(shipment?.code ?? null);
  const meta = node.kind === "all"
    ? `${count} ${countNoun} · ${customers === 1 ? "לקוח אחד" : `${customers} לקוחות`} · הממתין ביותר קודם`
    : node.kind === "customer"
      ? `${customer?.shipments.length === 1 ? "משלוח אחד" : `${customer?.shipments.length ?? 0} משלוחים`} · ${count} ${countNoun} בתור של העמדה`
      : `${customerLabel(customer?.code ?? null)} · ${count} ${countNoun} בתור של העמדה`;
  const p = node.kind === "shipment" ? shipment?.progress : null;
  return (
    <div className="tst-head">
      <div style={{ minWidth: 0 }}>
        <h2 className="tst-head-title">{title}</h2>
        <div className="tst-head-meta">
          <span>{meta}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>הזמנים בנטו<ClockInfoIcon metric="testingTimer" /></span>
          {/* A refresh over a list already on screen: a quiet note, not skeletons. */}
          <span role="status" className="tst-refreshing">
            {refreshing && (
              <>
                <CircularProgress size={12} aria-hidden />
                מתעדכן…
              </>
            )}
          </span>
        </div>
      </div>
      <div className="tst-head-actions">
        {p && p.total > 0 && (
          <div style={{ minWidth: 200 }}>
            <div className="tst-band-sub tst-num" style={{ fontSize: "var(--text-body-sm)" }}>{p.done} מתוך {p.total} במשלוח כבר עברו את העמדה</div>
            <div className="tst-progress tst-progress--lg" aria-hidden style={{ width: "100%", marginTop: 6 }}><span style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div>
          </div>
        )}
        {next && (
          <Button
            className="tst-next"
            onClick={onNext}
            disabled={startingNext}
            title={`הבא בתור: ${formatIdText(next.item_id)}`}
            startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 22 }} aria-hidden />}
          >
            התחל את הבא בתור
          </Button>
        )}
      </div>
    </div>
  );
}

/** Under the scanned row: the rest of its shipment in this queue. */
function SiblingRows({ focusItem, rows, packageLevel, rowProps, renderBox }: {
  focusItem: QueueRow;
  rows: readonly QueueRow[];
  packageLevel: boolean;
  rowProps: (row: QueueRow) => { onBegin: (row: QueueRow) => void; starting: boolean; onStepBack?: () => void };
  renderBox: (row: QueueRow) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  const boxes = packageLevel ? rows.filter((it) => it.is_package && it.package) : [];
  const loose = packageLevel ? rows.filter((it) => !it.is_package) : rows;
  return (
    <section aria-label="עוד באותו משלוח" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Typography component="h2" sx={{ m: 0, fontSize: "var(--text-body)", fontWeight: 600, color: "var(--color-ink-muted-70)", px: "4px" }}>
        עוד ב{shipmentLabel(focusItem.shipment_code)} · {rows.length}
      </Typography>
      {boxes.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>{boxes.map(renderBox)}</Box>
      )}
      {loose.length > 0 && <QueueList label="עוד באותו משלוח" groups={[{ key: "rest", rows: loose }]} showPlace={false} rowProps={rowProps} />}
    </section>
  );
}

/** The page's one empty-state shape (artboard: 64px circle, 17/600 line, 14 hint). */
function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <Box sx={{ textAlign: "center", py: "64px", color: "var(--color-ink-muted-48)" }}>
      <Box sx={{ width: 64, height: 64, borderRadius: "var(--r-pill)", bgcolor: "var(--color-canvas)", border: "1px solid var(--color-hairline)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", mb: "14px" }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: "var(--text-lead)", color: "var(--color-ink)", fontWeight: 600, mb: "6px" }}>{title}</Typography>
      <Typography sx={{ fontSize: "var(--text-body-sm)" }}>{hint}</Typography>
      {action && <Box sx={{ mt: "16px" }}>{action}</Box>}
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
