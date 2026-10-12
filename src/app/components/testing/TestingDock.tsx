"use client";

import * as React from "react";
import { Box, Typography, Button } from "@/components/ui";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import { KeyboardArrowDown as KeyboardArrowDownIcon } from "@/components/ui/icons";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import WorkerPicker from "../WorkerPicker";

import type { StationLite } from "@/types";

type TestingDockProps = {
  hasStation: boolean;
  stationName: string | null;
  stationTypeName: string | null;
  /** null while the queue for this station hasn't answered yet (shown as "—"). */
  itemCount: number | null;
  /** What the count counts — "פריטים" (default) or "מארזים" at a package-level station. */
  countNoun?: string;
  allStations: StationLite[];
  typeNameById: (typeId: number) => string;
  selectedStationId: number | null;
  onPickStation: (station: StationLite | null) => void;
  activeWorkerId: number | null;
  activeWorkerName: string;
  onWorkerChange: (id: number | null) => void;
  /** When true, the active worker comes from the login (employeeNumber) and the
   *  picker is read-only — the user can't act as someone else. */
  workerLocked?: boolean;
  onScan: () => void;
};

/** Hover-intent delay before the panel opens under a passing mouse (MO-8). */
const HOVER_INTENT_MS = 150;

/**
 * Auto-hiding context dock for the Testing screen (round-2 redesign).
 *
 * A slim always-visible strip (station + worker chip + toggle) maximises board
 * space; a panel under it holds the all-stations search, the worker picker and
 * the scan button. The panel opens:
 *  - on click / tap of the strip or its "שינוי עמדה ועובד" toggle (pinned
 *    until clicked again, Escape, or a press outside the dock),
 *  - while keyboard focus is inside the dock (Tab reaches the toggle, then the
 *    fields),
 *  - under a resting mouse pointer, after a short intent delay,
 *  - and always while no station is selected yet, or while a dropdown inside
 *    it is open (so it can't vanish mid-selection) — the prototype's
 *    `dockHover || openCombo || !station`.
 * Closed, the panel is visibility:hidden (testing.css), so its fields are out
 * of the Tab order instead of invisible-but-focusable.
 */
export default function TestingDock({
  hasStation,
  stationName,
  stationTypeName,
  itemCount,
  countNoun = "פריטים",
  allStations,
  typeNameById,
  selectedStationId,
  onPickStation,
  activeWorkerId,
  activeWorkerName,
  onWorkerChange,
  workerLocked = false,
  onScan,
}: TestingDockProps) {
  const [hover, setHover] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [focusOpen, setFocusOpen] = React.useState(false);
  const [stationOpen, setStationOpen] = React.useState(false);
  const [workerOpen, setWorkerOpen] = React.useState(false);

  const panelShow = hover || pinned || focusOpen || stationOpen || workerOpen || !hasStation;
  const hasWorker = activeWorkerId != null;
  const panelId = React.useId();

  const rootRef = React.useRef<HTMLDivElement>(null);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // How focus arrived: keyboard focus opens the panel, a mouse / touch press
  // does not (clicks have their own toggle; a focused field would otherwise
  // hold the panel open after the pointer has moved on).
  const viaPointer = React.useRef(false);
  // A programmatic focus back to the toggle (after Escape) must not reopen it.
  const skipFocusOpen = React.useRef(false);

  React.useEffect(() => {
    const onKey = () => { viaPointer.current = false; };
    const onPointer = (e: PointerEvent) => {
      viaPointer.current = true;
      // A press outside the dock releases the panel (pinned, or held by focus).
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false);
        setFocusOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const closeAll = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(false);
    setPinned(false);
    setFocusOpen(false);
  };

  // Click / tap on the strip (or Enter / Space on its toggle, which bubbles
  // here as a click): an explicit open / close that wins over hover and focus.
  const toggle = () => {
    if (panelShow) closeAll();
    else setPinned(true);
  };

  const selectedStation = React.useMemo(
    () => allStations.find((s) => s.id === selectedStationId) ?? null,
    [allStations, selectedStationId]
  );

  return (
    <div
      ref={rootRef}
      className="tst-dock"
      // Mouse only: a touch "enter" never gets its "leave", which would hold
      // the panel open after a tap meant to close it.
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHover(true), HOVER_INTENT_MS);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setHover(false);
      }}
      onFocus={() => {
        if (skipFocusOpen.current) { skipFocusOpen.current = false; return; }
        if (!viaPointer.current) setFocusOpen(true);
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Element | null;
        // Focus moving into a dialog opened from the panel (the scan dialog)
        // keeps it open, so the dialog can hand focus back to a visible button.
        if (next?.closest('[role="dialog"]')) return;
        if (!e.currentTarget.contains(next)) setFocusOpen(false);
      }}
      onKeyDown={(e) => {
        // An open dropdown takes its own Escape first.
        if (e.key !== "Escape" || stationOpen || workerOpen || !panelShow) return;
        const focusInPanel = toggleRef.current !== document.activeElement && e.currentTarget.contains(document.activeElement);
        closeAll();
        if (focusInPanel) {
          skipFocusOpen.current = true;
          toggleRef.current?.focus();
        }
      }}
    >
      {/* Slim peek strip — the whole strip is the pointer target; the toggle
          button inside it is the keyboard / screen-reader control. */}
      <div className="tst-dock-strip" onClick={toggle}>
        <div className="tst-frame tst-dock-row">
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: "var(--r-sm)",
              bgcolor: "var(--color-ink)",
              color: "var(--color-on-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ScienceIcon sx={{ fontSize: 17 }} aria-hidden />
          </Box>
          <Box sx={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 1 }}>
            {/* The page's one h1: the station being worked (or the prompt to pick one). */}
            <Typography
              component="h1"
              sx={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 700, letterSpacing: "var(--ls-caption)", lineHeight: "var(--lh-snug)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {hasStation ? stationName : "בחר עמדה לבדיקה"}
            </Typography>
            <Typography component="span" className="tst-hide-sm" sx={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", whiteSpace: "nowrap" }}>
              {hasStation ? `${stationTypeName ?? ""} · ${itemCount ?? "—"} ${countNoun}` : "בחר עמדה ועובד כדי להתחיל"}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              borderRadius: "var(--r-pill)",
              padding: "4px 11px",
              fontSize: "var(--text-fine)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              bgcolor: hasWorker ? "color-mix(in srgb, var(--color-primary) 8%, transparent)" : "var(--color-warning-bg)",
              border: `1px solid ${hasWorker ? "color-mix(in srgb, var(--color-primary) 22%, transparent)" : "var(--color-warning-border)"}`,
              color: hasWorker ? "var(--color-primary)" : "var(--color-warning-ink)",
            }}
          >
            <PersonIcon sx={{ fontSize: 14 }} aria-hidden />
            {hasWorker ? activeWorkerName || "עובד" : "בחר עובד"}
          </Box>
          <Box sx={{ flex: 1 }} />
          <button
            ref={toggleRef}
            type="button"
            className="tst-dock-toggle"
            aria-expanded={panelShow}
            aria-controls={panelId}
          >
            <KeyboardArrowDownIcon className="tst-dock-chevron" sx={{ fontSize: 15 }} aria-hidden />
            שינוי עמדה ועובד
          </button>
        </div>
      </div>

      {/* The panel (hover / click / keyboard focus) */}
      <div id={panelId} className="tst-dock-panel" data-open={panelShow ? "" : undefined}>
        <div className="tst-frame tst-dock-panel-row">
          <Box sx={{ flex: 1, minWidth: 240, maxWidth: 360 }}>
            <SearchableCombobox<StationLite>
              label="עמדה"
              options={allStations}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              value={selectedStation}
              onChange={onPickStation}
              onOpen={() => setStationOpen(true)}
              onClose={() => setStationOpen(false)}
              placeholder="חפש עמדה לשינוי…"
              noOptionsText="אין עמדה תואמת"
              renderOptionContent={(o) => (
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: "var(--text-body-sm)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.name}
                  </Typography>
                  <Typography sx={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>{typeNameById(o.typeId)}</Typography>
                </Box>
              )}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 200, maxWidth: 300 }}>
            <FieldLabel>עובד פעיל</FieldLabel>
            <WorkerPicker
              value={activeWorkerId}
              onChange={onWorkerChange}
              hideHeader
              size="small"
              disabled={workerLocked}
              // Only who may test: the roles /testing is open to (src/lib/routes.ts).
              roles={["manager", "tester"]}
              placeholder={workerLocked ? "מזוהה מההתחברות" : "חפש עובד…"}
              onOpen={() => setWorkerOpen(true)}
              onClose={() => setWorkerOpen(false)}
            />
          </Box>

          <Button variant="dark" className="tst-dock-scan" onClick={onScan} startIcon={<QrCodeScannerIcon fontSize={18} aria-hidden />}>
            סרוק ברקוד
          </Button>
        </div>
      </div>
    </div>
  );
}
