"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Typography,
  TextField,
  Box,
  Card,
  Button,
  Chip,
  Stack,
  Skeleton,
  alpha,
  MenuItem,
  Menu,
  InputAdornment,
  Container,
  IconButton,
  Fade,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@/components/ui";
import {TestStationType, TestStation, ItemRow, StationLite} from "../../types";
// Icons
import { Search as SearchIcon } from "@/components/ui/icons";
import { Clear as ClearIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { CheckCircleOutline as CheckCircleOutlineIcon } from "@/components/ui/icons";
import { Inventory as InventoryIcon } from "@/components/ui/icons";
import { AccessTime as AccessTimeIcon } from "@/components/ui/icons";
import { History as HistoryIcon } from "@/components/ui/icons";
import { Link as LinkIcon } from "@/components/ui/icons";
import { AccountTree as AccountTreeIcon } from "@/components/ui/icons";
import { PlayArrowRounded as PlayArrowRoundedIcon } from "@/components/ui/icons";
import { PrecisionManufacturing as PrecisionManufacturingIcon } from "@/components/ui/icons";
import { QrCode as QrCodeIcon } from "@/components/ui/icons";
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { TrendingUp as TrendingUpIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { Queue as QueueIcon } from "@/components/ui/icons";
// MoreVertIcon removed
import { getStartTestDialog, hasStartTestDialog } from "./tests-popups/mainPopUp";
import StationHistoryDialog from "../components/StationHistoryDialog";
import TestingDock from "../components/testing/TestingDock";

// Item / station types now live in src/types (ItemRow, TestStation, TestStationType, StationLite).

// Custom hook for live elapsed time display
function useElapsedTime(createdAt: string | null | undefined): string {
  const [elapsed, setElapsed] = React.useState<string>("");

  React.useEffect(() => {
    if (!createdAt) {
      setElapsed("");
      return;
    }
    const startTime = new Date(createdAt).getTime();
    if (isNaN(startTime)) {
      setElapsed("");
      return;
    }

    const updateElapsed = () => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      if (diff < 0) {
        setElapsed("");
        return;
      }
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      setElapsed(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  return elapsed;
}

// Shifthouse status tokens (waiting amber / in-test blue / done green).
const STATUS_TOKENS = {
  waiting: { color: "#d97706", bg: "rgba(217,118,6,0.10)", border: "rgba(217,118,6,0.28)", timerBg: "rgba(217,118,6,0.08)" },
  inTest: { color: "#0066cc", bg: "rgba(0,102,204,0.10)", border: "rgba(0,102,204,0.25)", timerBg: "rgba(0,102,204,0.06)" },
  done: { color: "#1f8a5b", bg: "rgba(31,138,91,0.10)", border: "rgba(31,138,91,0.25)", timerBg: "rgba(31,138,91,0.06)" },
} as const;

// --- Item Row Strip (option 3a: queue rank + step progress) ---
function ItemCard({
  item,
  rank,
  onAddTestResult,
  onStartTest,
  onRefresh,
  highlighted = false,
  priority = false,
  hasWizard = false,
}: {
  item: ItemRow;
  rank: number;
  onAddTestResult: (item: ItemRow) => void;
  onStartTest: (itemId: number) => Promise<void>;
  onRefresh: () => void;
  highlighted?: boolean;
  priority?: boolean;
  hasWizard?: boolean;
}) {
  const baseTimeString =
    item.current_status === 1 || item.current_status === 5
      ? item.processing_start_time
      : item.current_status === 2 || item.current_status === 4
        ? item.queue_start_time
        : null;

  const elapsedTime = useElapsedTime(baseTimeString);
  const isInTest = item.current_status === 1 || item.current_status === 5;
  const isWaiting = item.current_status === 2 || item.current_status === 4;
  const isAccessory = item.parent_item_id != null;

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const tokens = isWaiting ? STATUS_TOKENS.waiting : isInTest ? STATUS_TOKENS.inTest : STATUS_TOKENS.done;
  const statusColor = tokens.color;

  const isActionable = isWaiting || isInTest;

  // Steps come from the item's real testing route.
  const totalSteps = Math.max(item.route_steps?.length || 1, 1);
  const currentStep = item.current_route_step ?? 1;
  const rankBg = priority ? "#d97706" : isActionable ? "#15171a" : "#c7c7cf";

  return (
      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "15px",
          bgcolor: "#fff",
          borderRadius: "14px",
          padding: "14px 16px",
          border: highlighted
            ? "1.5px solid #0066cc"
            : priority
              ? "1.5px solid #d97706"
              : "1px solid #e0e0e0",
          boxShadow: highlighted
            ? "0 0 0 3px rgba(0,102,204,0.18)"
            : priority
              ? "0 0 0 3px rgba(217,118,6,0.10)"
              : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        {/* Priority ribbon — the longest-waiting item */}
        {priority && (
            <Box
                sx={{
                    position: "absolute",
                    top: -10,
                    insetInlineStart: 58,
                    zIndex: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    bgcolor: "#d97706",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: "9999px",
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                }}
            >
                <StarIcon sx={{ fontSize: 12 }} />
                ממתין הכי הרבה
            </Box>
        )}

        {highlighted && (
            <Chip
                size="small"
                icon={<QrCodeIcon sx={{ fontSize: "16px !important" }} />}
                label="נסרק"
                color="primary"
                sx={{
                    position: "absolute",
                    top: -10,
                    insetInlineEnd: 14,
                    fontWeight: 600,
                    zIndex: 3,
                }}
            />
        )}

        {/* Status color bar */}
        <Box sx={{ width: 5, alignSelf: "stretch", borderRadius: "9999px", bgcolor: statusColor, flexShrink: 0 }} />

        {/* Queue rank circle */}
        <Box
            sx={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: "9999px",
                bgcolor: rankBg,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
            }}
        >
            {rank}
        </Box>

        {/* ID + status, model line */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.4px", color: "#1d1d1f", fontVariantNumeric: "tabular-nums" }}>
                    #{item.item_id}
                </Typography>
                <Box sx={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: 12, fontWeight: 700, color: statusColor, whiteSpace: "nowrap" }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "9999px", bgcolor: statusColor }} />
                    {item.item_status_desc || "סטטוס לא ידוע"}
                </Box>
            </Box>
            <Typography sx={{ fontSize: 13, color: "#7a7a7a", mt: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.model} · מק״ט {item.makat}
            </Typography>
        </Box>

        {/* Step progress */}
        <Box sx={{ flexShrink: 0, width: 150 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#5a5a5f", mb: "5px" }}>
                שלב {currentStep} / {totalSteps}
            </Typography>
            <Box sx={{ display: "flex", gap: "4px" }}>
                {Array.from({ length: totalSteps }, (_, i) => (
                    <Box key={i} sx={{ flex: 1, height: 5, borderRadius: "9999px", bgcolor: i < currentStep ? statusColor : "#e6e6ea" }} />
                ))}
            </Box>
        </Box>

        {/* Timer in the status color */}
        <Box sx={{ flexShrink: 0, fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: statusColor, minWidth: 82, textAlign: "center" }}>
            {elapsedTime || "—"}
        </Box>

        {/* Connected items slot — fixed width so the columns stay aligned.
            An accessory gets its own icon that points at its parent item only;
            a parent keeps the link icon listing all of its accessories. */}
        {(isAccessory || item.has_children) ? (
            <IconButton
                onClick={handleMenuClick}
                aria-label={isAccessory ? `פריט אב: #${item.parent_item_id}` : "פריטים מחוברים"}
                title={isAccessory ? `פריט אב: #${item.parent_item_id}` : "פריטים מחוברים"}
                sx={{
                    width: 40,
                    height: 40,
                    flexShrink: 0,
                    borderRadius: "10px",
                    border: isAccessory ? "1px solid #cfe3fb" : "1px solid #d4d4dc",
                    bgcolor: isAccessory ? "#f3f8ff" : "transparent",
                    color: isAccessory ? "#0066cc" : "#5a5a5f",
                }}
            >
                {isAccessory ? <AccountTreeIcon sx={{ fontSize: 18 }} /> : <LinkIcon sx={{ fontSize: 18 }} />}
            </IconButton>
        ) : (
            <Box sx={{ width: 40, flexShrink: 0 }} />
        )}

        {/* Connected Items Menu */}
        <Menu
             anchorEl={anchorEl}
             open={Boolean(anchorEl)}
             onClose={handleMenuClose}
             anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
             transformOrigin={{ vertical: 'top', horizontal: 'right' }}
             marginThreshold={0}
             PaperProps={{
                 sx: {
                     mt: 1,
                     borderRadius: 3,
                     boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                     minWidth: 180
                 }
             }}
        >
           {isAccessory ? (
               <MenuItem onClick={handleMenuClose} dense>
                  <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
                     <AccountTreeIcon fontSize="small" color="action" />
                     <Box>
                         <Typography variant="caption" color="text.secondary">פריט אב</Typography>
                         <Typography variant="subtitle2">#{item.parent_item_id}</Typography>
                         <Typography variant="caption" color="text.secondary">S/N: {item.parent_serial_no || '-'}</Typography>
                     </Box>
                  </Stack>
               </MenuItem>
           ) : item.connected_items && item.connected_items.length > 0 ? (
               item.connected_items.map((conn) => (
                 <MenuItem key={conn.item_id} onClick={handleMenuClose} dense>
                    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
                       <QrCodeIcon fontSize="small" color="action" />
                       <Box>
                           <Typography variant="subtitle2">#{conn.item_id}</Typography>
                           <Typography variant="caption" color="text.secondary">S/N: {conn.serial_no || '-'}</Typography>
                       </Box>
                    </Stack>
                 </MenuItem>
               ))
           ) : (
               <MenuItem disabled><Typography variant="caption">טוען...</Typography></MenuItem>
           )}
        </Menu>

        {/* Action Button — always visible; ghost green when done */}
        {isActionable ? (
            <Button
                className="action-button"
                variant="contained"
                onClick={async () => {
                  if (isWaiting) {
                    if (hasWizard) {
                      // Station-type wizard runs the intake in place of the plain start.
                      onAddTestResult(item);
                    } else {
                      await onStartTest(item.item_id);
                      onRefresh();
                    }
                  } else if (isInTest) {
                    onAddTestResult(item);
                  }
                }}
                startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 16 }} />}
                sx={{
                  height: 44,
                  width: 120,
                  flexShrink: 0,
                  borderRadius: "11px",
                  fontWeight: 600,
                  fontSize: 14.5,
                  gap: "7px",
                  padding: 0,
                  justifyContent: "center",
                  whiteSpace: "nowrap",
                }}
            >
              {isWaiting ? (item.current_status === 4 ? "התחל מחקר" : "התחל בדיקה") : "המשך בדיקה"}
            </Button>
        ) : (
            <Button
                className="action-button"
                variant="outlined"
                disabled
                sx={{
                  height: 44,
                  width: 120,
                  flexShrink: 0,
                  borderRadius: "11px",
                  fontWeight: 600,
                  fontSize: 14.5,
                  padding: 0,
                  justifyContent: "center",
                  border: "1px solid rgba(31,138,91,0.3)",
                  bgcolor: "rgba(31,138,91,0.07)",
                  color: "#1f8a5b",
                  opacity: 1,
                }}
            >
              הושלם
            </Button>
        )}
      </Box>
  );
}

// Queue-priority helpers: waiting first (longest wait first), then in-test,
// then anything else.
const rankOf = (it: ItemRow) =>
  it.current_status === 2 || it.current_status === 4 ? 0
  : it.current_status === 1 || it.current_status === 5 ? 1 : 2;
const baseTimeOf = (it: ItemRow) =>
  new Date(it.queue_start_time || it.processing_start_time || 0).getTime();

// --- Summary strip tile ---
function SummaryTile({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  valueColor = "#1d1d1f",
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: React.ReactNode;
  label: string;
  valueColor?: string;
}) {
  return (
    <Box sx={{ bgcolor: "#fff", border: "1px solid #e0e0e0", borderRadius: "16px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
      <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: "12px", bgcolor: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: 13, color: "#7a7a7a", mt: "5px" }}>{label}</Typography>
      </Box>
    </Box>
  );
}

// --- Main Page Component ---
function TestingPageView() {
  // Command-palette deep link: /testing?type=<typeId>&station=<stationId>
  // and optionally &item=<itemId>, which seeds the queue filter so the station
  // opens narrowed to the one item the user searched for.
  // Applied once, after the station-type list arrives (see the effect below).
  const searchParams = useSearchParams();
  const linkTypeId = Number(searchParams.get("type")) || null;
  const linkStationId = Number(searchParams.get("station")) || null;
  const linkItemId = searchParams.get("item")?.trim() || "";
  /** Station staged by the deep link, consumed by the stations effect. */
  const pendingLinkStationRef = React.useRef<number | null>(linkStationId);
  /**
   * Item filter staged by the deep link. Selecting a station clears the filter
   * (see the items effect), and the linked station is selected asynchronously —
   * so the seed has to survive that one clear, then behave normally.
   */
  const pendingLinkItemRef = React.useRef<string>(linkItemId);
  /** Guards the one-shot type selection so it can't fight the user's later picks. */
  const linkAppliedRef = React.useRef(false);

  const [stationTypes, setStationTypes] = React.useState<TestStationType[]>([]);
  const [selectedStationType, setSelectedStationType] = React.useState<TestStationType | null>(null);
  const [stations, setStations] = React.useState<TestStation[]>([]);
  const [selectedStation, setSelectedStation] = React.useState<TestStation | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [stationTypesLoading, setStationTypesLoading] = React.useState(false);
  const [stationsLoading, setStationsLoading] = React.useState(false);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<ItemRow | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);
  const [nextStationDialogOpen, setNextStationDialogOpen] = React.useState(false);
  const [nextStationInfo, setNextStationInfo] = React.useState<{
    isLastStation: boolean;
    nextStation?: {
      testStationId: number;
      testStationDesc: string;
      stationTypeId: number;
      routeStep: number;
    };
    finishedFromResearch?: boolean;
    finishedAtStep?: number;
  } | null>(null);
  const [researchDialogOpen, setResearchDialogOpen] = React.useState(false);
  const [researchStationInfo, setResearchStationInfo] = React.useState<{
    stationId: number;
    stationDesc: string;
    stationTypeId: number;
    stationTypeName: string;
    currentLoad: number;
  } | null>(null);

  const [filterMakat, setFilterMakat] = React.useState("");

  // Flat list of every station (across all types) for the dock's all-stations
  // search — picking one sets type + station in a single step.
  const [allStations, setAllStations] = React.useState<StationLite[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/stations")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setAllStations(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAllStations([]); });
    return () => { cancelled = true; };
  }, []);

  // Page-level "who's working" picker — single source of truth for any action
  // taken from this page (finish test, file upload, replace, edit). Persisted
  // to localStorage so a refresh doesn't lose the choice. Smart-card auth will
  // replace this in the future.
  const WORKER_STORAGE_KEY = "testing-page:active-worker-id";
  const [activeWorkerId, setActiveWorkerId] = React.useState<number | null>(null);
  const [activeWorkerName, setActiveWorkerName] = React.useState<string>("");
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKER_STORAGE_KEY);
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) setActiveWorkerId(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const handleWorkerChange = (workerId: number | null) => {
    setActiveWorkerId(workerId);
    try {
      if (workerId == null) window.localStorage.removeItem(WORKER_STORAGE_KEY);
      else window.localStorage.setItem(WORKER_STORAGE_KEY, String(workerId));
    } catch {
      /* ignore */
    }
  };
  // Resolve the worker_name for downstream consumers (OnlyOffice user.name etc.).
  React.useEffect(() => {
    if (activeWorkerId == null) {
      setActiveWorkerName("");
      return;
    }
    let cancelled = false;
    fetch("/api/settings/workers")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ worker_id: number; worker_name: string }>) => {
        if (cancelled) return;
        const match = Array.isArray(rows) ? rows.find((w) => w.worker_id === activeWorkerId) : null;
        setActiveWorkerName(match?.worker_name ?? "");
      })
      .catch(() => {
        if (!cancelled) setActiveWorkerName("");
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkerId]);

  // Barcode scanner state
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scanInput, setScanInput] = React.useState("");
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [highlightedItemId, setHighlightedItemId] = React.useState<number | null>(null);
  const [finishedDialogOpen, setFinishedDialogOpen] = React.useState(false);
  const [finishedItemInfo, setFinishedItemInfo] = React.useState<{
    itemId: number;
    serialNo?: string | null;
    model?: string | null;
  } | null>(null);
  const scanTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // When a scan flow changes stationType, we hold the pending station here so the
  // stationType effect doesn't blow it away with setSelectedStation(null).
  const pendingScanStationRef = React.useRef<TestStation | null>(null);

  const filteredItems = React.useMemo(() => {
    const base = filterMakat
      ? items.filter((item) =>
          item.makat?.toString().includes(filterMakat) ||
          item.serial_no?.toString().includes(filterMakat) ||
          item.item_id?.toString().includes(filterMakat)
        )
      : items;

    // Hoist the scanned item to the front of the list (if present).
    if (highlightedItemId == null) return base;
    const idx = base.findIndex((it) => Number(it.item_id) === Number(highlightedItemId));
    if (idx <= 0) return base;
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
  }, [items, filterMakat, highlightedItemId]);

  // Priority ordering for the grid: waiting (longest wait first) → in-test →
  // rest. The scanned item stays hoisted to the very front regardless.
  const { orderedItems, priorityItemId } = React.useMemo(() => {
    const sorted = [...filteredItems].sort(
      (a, b) => rankOf(a) - rankOf(b) || baseTimeOf(a) - baseTimeOf(b)
    );
    // The longest-waiting item gets the priority ribbon (hidden while filtering).
    const topWaiting = !filterMakat
      ? sorted.find((it) => it.current_status === 2 || it.current_status === 4)
      : undefined;
    if (highlightedItemId != null) {
      const idx = sorted.findIndex((it) => Number(it.item_id) === Number(highlightedItemId));
      if (idx > 0) {
        const [hit] = sorted.splice(idx, 1);
        sorted.unshift(hit);
      }
    }
    return {
      orderedItems: sorted,
      priorityItemId: topWaiting != null ? Number(topWaiting.item_id) : null,
    };
  }, [filteredItems, filterMakat, highlightedItemId]);

  // Summary-strip data — station overview, so derived from the unfiltered list.
  const waitingCount = React.useMemo(
    () => items.filter((it) => it.current_status === 2 || it.current_status === 4).length,
    [items]
  );
  const inTestCount = React.useMemo(
    () => items.filter((it) => it.current_status === 1 || it.current_status === 5).length,
    [items]
  );
  // Longest wait = live timer on the earliest queue_start_time among waiting items.
  const longestWaitStart = React.useMemo(() => {
    let earliest: string | null = null;
    for (const it of items) {
      if ((it.current_status === 2 || it.current_status === 4) && it.queue_start_time) {
        if (earliest == null || new Date(it.queue_start_time).getTime() < new Date(earliest).getTime()) {
          earliest = it.queue_start_time;
        }
      }
    }
    return earliest;
  }, [items]);
  const longestWait = useElapsedTime(longestWaitStart);

  // "Completed today" — count of item_route_history rows for this station with
  // processing_end_time since the start of the local day.
  const [completedToday, setCompletedToday] = React.useState<number | null>(null);
  const fetchCompletedToday = React.useCallback(async (stationId: number) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const res = await fetch(
        `/api/testing/completed-today?stationId=${stationId}&since=${encodeURIComponent(startOfDay.toISOString())}`
      );
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setCompletedToday(typeof data?.count === "number" ? data.count : 0);
    } catch {
      setCompletedToday(null);
    }
  }, []);
  React.useEffect(() => {
    if (!selectedStation) {
      setCompletedToday(null);
      return;
    }
    fetchCompletedToday(selectedStation.test_station_id);
  }, [selectedStation, fetchCompletedToday]);

  // Load effects
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setStationTypesLoading(true);
      try {
        const res = await fetch("/api/testing/stations");
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setStationTypes(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!cancelled) setStationTypes([]);
      } finally {
        if (!cancelled) setStationTypesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Deep link, step 1: once the types are loaded, select the linked one. The
  // station itself is staged in a ref and picked up by the stations effect
  // below — same handoff the barcode-scan flow uses, so the type change can't
  // clear the selection out from under us.
  React.useEffect(() => {
    if (linkAppliedRef.current || !linkTypeId || stationTypes.length === 0) return;
    const match = stationTypes.find((t) => t.id === linkTypeId);
    if (!match) return;
    linkAppliedRef.current = true;
    setSelectedStationType(match);
  }, [stationTypes, linkTypeId]);

  React.useEffect(() => {
    if (!selectedStationType) {
      setStations([]); setSelectedStation(null); setItems([]); return;
    }
    let cancelled = false;
    (async () => {
      setStationsLoading(true);
      try {
        const res = await fetch(`/api/testing/test-stations?typeId=${selectedStationType.id}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          const list: TestStation[] = Array.isArray(data) ? data : [];
          setStations(list);
          // If a scan flow staged a target station for this type, honor it
          // instead of clearing the selection (avoids a flicker / lost selection).
          // Deep link, step 2: a ?station= from the palette resolves here,
          // alongside the scan flow's staged station.
          const linked = pendingLinkStationRef.current;
          const linkedFresh =
            linked != null ? list.find((s) => s.test_station_id === linked) : undefined;
          const pending = pendingScanStationRef.current;
          if (linkedFresh) {
            pendingLinkStationRef.current = null;
            setSelectedStation(linkedFresh);
          } else if (pending && list.some((s) => s.test_station_id === pending.test_station_id)) {
            const fresh = list.find((s) => s.test_station_id === pending.test_station_id)!;
            pendingScanStationRef.current = null;
            setSelectedStation(fresh);
          } else {
            setSelectedStation(null); setItems([]);
          }
        }
      } catch (error) {
        if (!cancelled) setStations([]);
      } finally {
        if (!cancelled) setStationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedStationType]);

  React.useEffect(() => {
    if (!selectedStation) { setItems([]); return; }
    // Switching stations drops a now-meaningless filter — unless this is the
    // station a ?item= deep link targeted, whose filter is the whole point.
    const pendingItem = pendingLinkItemRef.current;
    pendingLinkItemRef.current = "";
    setFilterMakat(
      pendingItem && selectedStation.test_station_id === linkStationId ? pendingItem : "",
    );
    let cancelled = false;
    (async () => {
      setItemsLoading(true);
      try {
        const res = await fetch(`/api/testing/items?stationId=${selectedStation.test_station_id}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedStation]);

  const handleAddTestResult = (item: ItemRow) => {
    setSelectedItem(item);
    setDialogOpen(true);
  };

  // Resolve a scanned barcode to a station and hoist the matching item.
  const handleBarcodeScan = React.useCallback(async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) return;
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await fetch(`/api/testing/locate-by-barcode?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (!res.ok) {
        setScanError(data?.error || "שגיאה באיתור הפריט");
        return;
      }

      // Item already finished its route — show the friendly dialog, not an error.
      if (data.finished) {
        setFinishedItemInfo({
          itemId: Number(data.itemId),
          serialNo: data.serialNo,
          model: data.model,
        });
        setFinishedDialogOpen(true);
        setScannerOpen(false);
        setScanInput("");
        return;
      }

      const typeOption = stationTypes.find((t) => t.id === data.stationTypeId);
      if (!typeOption) {
        setScanError("סוג העמדה של הפריט לא נמצא");
        return;
      }

      setFilterMakat("");
      setHighlightedItemId(Number(data.itemId));

      if (selectedStationType?.id === typeOption.id) {
        // Same type already selected: find the station in the loaded list and switch directly.
        const stationOption = stations.find((s) => s.test_station_id === data.stationId);
        if (!stationOption) {
          setScanError("העמדה של הפריט לא נמצאה ברשימה הטעונה");
          return;
        }
        setSelectedStation(stationOption);
      } else {
        // Stage the target station and let the stationType effect adopt it once stations load.
        pendingScanStationRef.current = {
          test_station_id: data.stationId,
          test_station_desc: "",
          test_station_type_id: data.stationTypeId,
          status: 0,
          is_research: false,
        };
        setSelectedStationType(typeOption);
      }

      setScannerOpen(false);
      setScanInput("");
    } catch (err) {
      console.error("Error scanning barcode:", err);
      setScanError("שגיאה בתקשורת עם השרת");
    } finally {
      setScanLoading(false);
    }
  }, [stationTypes, selectedStationType, stations]);


  const handleStartTest = async (itemId: number) => {
    if (!selectedStation) throw new Error("Station not selected");
    try {
      const response = await fetch("/api/testing/start-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, stationId: selectedStation.test_station_id }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start test");
      }
    } catch (error) {
      console.error("Error starting test:", error);
      throw error;
    }
  };

  const handleRefreshItems = async () => {
    if (!selectedStation) return;
    setItemsLoading(true);
    fetchCompletedToday(selectedStation.test_station_id);
    try {
      const res = await fetch(`/api/testing/items?stationId=${selectedStation.test_station_id}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading items:", error);
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const handleSubmitTestResult = async (testData: Record<string, any>) => {
    if (!selectedItem || !selectedStation) return;
    const routeStepsLength = selectedItem.route_steps?.length || 0;
    if (routeStepsLength === 0) throw new Error("Route steps information is missing.");

    const response = await fetch("/api/testing/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ItemID: selectedItem.item_id,
        StationID: selectedStation.test_station_id,
        CurrentRouteStep: selectedItem.current_route_step,
        RouteStepsLength: routeStepsLength,
        QueueStartTime: selectedItem.created_at,
        ProcessingStartTime: selectedItem.processing_start_time,
        ItemTypeId: selectedItem.item_type_id,
        CreatedAt: selectedItem.created_at,
        ...testData,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save test result");
    }

    const result = await response.json();

    // Refresh items list
    handleRefreshItems();

    // Handle research response
    if (testData.sendToResearch && result.recommendedResearchStation) {
      setResearchStationInfo(result.recommendedResearchStation);
      setResearchDialogOpen(true);
    } else {
      // Check if this was a finishRoute action from research station
      const is_researchStatus = selectedItem.current_status === 5;
      const isFinishRoute = testData.finishRoute === true;

      setNextStationInfo({
        isLastStation: result.isLastStation || false,
        nextStation: result.nextStation || undefined,
        finishedFromResearch: is_researchStatus && isFinishRoute,
        finishedAtStep: selectedItem.current_route_step ?? undefined,
      });
      setNextStationDialogOpen(true);
    }
  };

  // Dock all-stations pick: set type + station in one step. Mirrors the scan
  // flow — when the type differs we stage the station and let the stationType
  // effect adopt it once that type's stations load.
  const handlePickAllStation = React.useCallback((station: StationLite | null) => {
    if (!station) { setSelectedStationType(null); setSelectedStation(null); setItems([]); return; }
    setHighlightedItemId(null);
    setFilterMakat("");
    const typeOption = stationTypes.find((t) => t.id === station.typeId);
    if (!typeOption) return;
    const synthetic: TestStation = { test_station_id: station.id, test_station_desc: station.name, test_station_type_id: station.typeId, status: 0, is_research: false };
    if (selectedStationType?.id === typeOption.id) {
  const found = stations.find((s) => s. test_station_id=== station.id);
      setSelectedStation(found ?? synthetic);
    } else {
      pendingScanStationRef.current = synthetic;
      setSelectedStationType(typeOption);
    }
  }, [stationTypes, selectedStationType, stations]);

  const typeNameById = React.useCallback(
    (typeId: number) => stationTypes.find((t) => t.id === typeId)?.name ?? "",
    [stationTypes]
  );

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100%",
        bgcolor: "#f5f5f7",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden", // Prevent horizontal overflow
      }}
    >
        {/* Auto-hiding context dock (station + worker + scan) */}
        <TestingDock
          hasStation={!!selectedStation}
          stationName={selectedStation?.test_station_desc ?? null}
          stationTypeName={selectedStationType?.name ?? null}
          itemCount={filteredItems.length}
          allStations={allStations}
          typeNameById={typeNameById}
          selectedStationId={selectedStation?.test_station_id ?? null}
          onPickStation={handlePickAllStation}
          activeWorkerId={activeWorkerId}
          activeWorkerName={activeWorkerName}
          onWorkerChange={handleWorkerChange}
          onScan={() => { setScanError(null); setScanInput(""); setScannerOpen(true); }}
        />

        {/* Main Content Area */}
        <Container maxWidth="xl" sx={{ mt: 3, mb: 5, flex: 1 }}>
            {selectedStation ? (
                <Fade in={true}>
                    <Box>
                        {/* Summary strip — station overview KPIs */}
                        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", mb: "22px" }}>
                            <SummaryTile
                                icon={<QueueIcon sx={{ fontSize: 21 }} />}
                                iconBg="rgba(217,118,6,0.10)"
                                iconColor="#d97706"
                                value={waitingCount}
                                label="בתור"
                            />
                            <SummaryTile
                                icon={<ScienceIcon sx={{ fontSize: 21 }} />}
                                iconBg="rgba(0,102,204,0.10)"
                                iconColor="#0066cc"
                                value={inTestCount}
                                label="בבדיקה"
                            />
                            <SummaryTile
                                icon={<CheckIcon sx={{ fontSize: 21 }} />}
                                iconBg="rgba(31,138,91,0.10)"
                                iconColor="#1f8a5b"
                                value={completedToday ?? "—"}
                                label="הושלמו היום"
                            />
                            <SummaryTile
                                icon={<AccessTimeIcon sx={{ fontSize: 21 }} />}
                                iconBg="rgba(217,118,6,0.10)"
                                iconColor="#d97706"
                                value={longestWait ? longestWait.slice(0, 5) : "—"}
                                label="המתנה הארוכה ביותר"
                                valueColor="#d97706"
                            />
                        </Box>

                        {/* Toolbar */}
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", mb: "18px" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                <Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", color: "#1d1d1f" }}>
                                    התור לבדיקה
                                </Typography>
                                <Typography sx={{ fontSize: 12.5, color: "#7a7a7a" }}>
                                    ממוינים לפי זמן המתנה — הממתין ביותר קודם
                                </Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <TextField
                                    placeholder="סינון לפי מק״ט, סריאלי או מזהה"
                                    size="small"
                                    value={filterMakat}
                                    onChange={(e) => setFilterMakat(e.target.value)}
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: "#7a7a7a" }} /></InputAdornment>,
                                        endAdornment: filterMakat && (
                                           <InputAdornment position="end">
                                               <IconButton size="small" onClick={() => setFilterMakat("")}><ClearIcon fontSize="small"/></IconButton>
                                           </InputAdornment>
                                        )
                                    }}
                                    sx={{ width: 300, maxWidth: "56vw", height: 44, borderRadius: "11px", bgcolor: "#fff" }}
                                />
                                <Button
                                   variant="outlined"
                                   color="inherit"
                                   startIcon={<HistoryIcon sx={{ fontSize: 17 }} />}
                                   onClick={() => setHistoryDialogOpen(true)}
                                   sx={{
                                       height: 44,
                                       borderRadius: "11px",
                                       borderColor: "#d4d4dc",
                                       color: "#1d1d1f",
                                       fontWeight: 600,
                                       gap: "7px",
                                       whiteSpace: "nowrap",
                                   }}
                                >
                                   היסטוריה
                                </Button>
                            </Box>
                        </Box>

                        {/* Items — row strips (queue rank + step progress) */}
                        {itemsLoading ? (
                            <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                {[1, 2, 3, 4].map((i) => (
                                    <Skeleton key={i} variant="rectangular" height={70} sx={{ borderRadius: "14px" }} />
                                ))}
                            </Box>
                        ) : orderedItems.length > 0 ? (
                            <Box sx={{ pb: 4 }}>
                                {/* Column headers */}
                                <Box sx={{ display: "flex", alignItems: "center", gap: "15px", padding: "0 16px 12px", fontSize: 12, fontWeight: 700, color: "#9a9aa0" }}>
                                    <Box sx={{ width: 5, flexShrink: 0 }} />
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
                                            item={item}
                                            rank={index + 1}
                                            onAddTestResult={handleAddTestResult}
                                            onStartTest={handleStartTest}
                                            onRefresh={handleRefreshItems}
                                            highlighted={highlightedItemId != null && Number(item.item_id) === Number(highlightedItemId)}
                                            priority={priorityItemId != null && Number(item.item_id) === Number(priorityItemId)}
                                            hasWizard={selectedStationType != null && hasStartTestDialog(selectedStationType.id)}
                                        />
                                    ))}
                                </Box>
                            </Box>
                        ) : (
                            <Box sx={{ textAlign: "center", py: "64px", color: "#7a7a7a" }}>
                                <Box sx={{ width: 64, height: 64, borderRadius: "9999px", bgcolor: "#fff", border: "1px solid #e0e0e0", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#0066cc", mb: "14px" }}>
                                    <InventoryIcon sx={{ fontSize: 30 }} />
                                </Box>
                                <Typography sx={{ fontSize: 17, color: "#1d1d1f", fontWeight: 600, mb: "6px" }}>
                                    אין פריטים תואמים בעמדה זו.
                                </Typography>
                                <Typography sx={{ fontSize: 14 }}>
                                    נסה לשנות את הסינון, או המתן לפריט הבא.
                                </Typography>
                            </Box>
                        )}
                    </Box>
                </Fade>
            ) : (
                <Stack alignItems="center" justifyContent="center" sx={{ minHeight: "60vh", opacity: 0.8 }}>
                    <PrecisionManufacturingIcon sx={{ fontSize: 100, color: "#e0e0e0", mb: 3 }} />
                    <Typography variant="h4" fontWeight="800" color="text.secondary" gutterBottom>
                        בחר עמדת בדיקה
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        יש לבחור סוג עמדה ולאחר מכן עמדה ספציפית כדי לראות את הפריטים
                    </Typography>
                </Stack>
            )}
        </Container>

        {/* Dialogs — the per-type finish/report dialog, resolved from the registry. */}
        {(() => {
  if (!dialogOpen || !selectedItem || !selectedStation || !selectedStationType) return null;
  const StartDialog = getStartTestDialog(selectedStationType.id);   // ← השליפה מה-REGISTRY
  return (
    <StartDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      item={selectedItem}
      station={selectedStation}
      workerId={activeWorkerId}
      workerName={activeWorkerName}
      onSubmit={handleSubmitTestResult}
    />
  );
})()}


        {selectedStation && (
            <StationHistoryDialog
                open={historyDialogOpen}
                onClose={() => setHistoryDialogOpen(false)}
                stationId={selectedStation.test_station_id}
                stationName={selectedStation.test_station_desc}
            />
        )}

        {/* Next Station Dialog */}
        <Dialog
            open={nextStationDialogOpen}
            onClose={() => setNextStationDialogOpen(false)}
            PaperProps={{ sx: { borderRadius: 3, p: 2, minWidth: 400 } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleOutlineIcon color="success" fontSize="large" />
                <Typography variant="h6" component="span" fontWeight="bold">
                    {nextStationInfo?.finishedFromResearch ? "המסלול הסתיים" : "הבדיקה הושלמה בהצלחה!"}
                </Typography>
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {nextStationInfo?.finishedFromResearch ? (
                         <Box sx={{ p: 2, bgcolor: alpha("#4caf50", 0.1), borderRadius: 2 }}>
                             <Typography variant="body1" fontWeight="600" color="success.main">
                                 העובד סיים את המסלול בשלב {nextStationInfo?.finishedAtStep}
                             </Typography>
                         </Box>
                    ) : nextStationInfo?.isLastStation ? (
                         <Box sx={{ p: 2, bgcolor: alpha("#4caf50", 0.1), borderRadius: 2 }}>
                             <Typography variant="body1" fontWeight="600" color="success.main">
                                 זהו השלב האחרון בתהליך. הפריט סיים את כל הבדיקות.
                             </Typography>
                         </Box>
                    ) : (
                        <Box>
                            <Typography variant="body1" gutterBottom>התחנה הבאה בתהליך:</Typography>
                            <Card variant="outlined" sx={{ p: 2, bgcolor: "#f8f9fa", borderColor: "primary.main" }}>
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <TrendingUpIcon color="primary" />
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {nextStationInfo?.nextStation?.testStationDesc || "לא ידוע"}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            שלב {nextStationInfo?.nextStation?.routeStep}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Card>
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setNextStationDialogOpen(false)} variant="contained" size="large" sx={{ borderRadius: 2, px: 4 }}>
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Research Dialog */}
        <Dialog
            open={researchDialogOpen}
            onClose={() => setResearchDialogOpen(false)}
             PaperProps={{ sx: { borderRadius: 3, p: 2, minWidth: 400 } }}
        >
             <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ScienceIcon color="warning" fontSize="large" />
                <Typography variant="h6" component="span" fontWeight="bold">הועבר לחקר</Typography>
            </DialogTitle>
            <DialogContent>
                <Typography variant="body1" gutterBottom>
                     הפריט הועבר להמשך טיפול בעמדת חקר:
                </Typography>
                <Card variant="outlined" sx={{ p: 2, mt: 1, bgcolor: alpha("#ff9800", 0.05), borderColor: "#ff9800" }}>
                     <Typography variant="subtitle1" fontWeight="bold" color="#e65100">
                         {researchStationInfo?.stationDesc}
                     </Typography>
                </Card>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setResearchDialogOpen(false)} variant="contained" color="warning" size="large" sx={{ borderRadius: 2, px: 4 }}>
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Finished Route Dialog (shown when a scanned item has already finished its testing route) */}
        <Dialog
            open={finishedDialogOpen}
            onClose={() => setFinishedDialogOpen(false)}
            PaperProps={{ sx: { borderRadius: 3, p: 2, minWidth: 400 } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleOutlineIcon color="success" fontSize="large" />
                <Typography variant="h6" component="span" fontWeight="bold">
                    המסלול הסתיים
                </Typography>
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Box sx={{ p: 2, bgcolor: alpha("#4caf50", 0.1), borderRadius: 2 }}>
                        <Typography variant="body1" fontWeight="600" color="success.main">
                            פריט זה סיים את מסלול הבדיקות
                        </Typography>
                    </Box>
                    {finishedItemInfo && (
                        <Card variant="outlined" sx={{ p: 2, bgcolor: "#f8f9fa" }}>
                            <Stack spacing={1}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <QrCodeIcon fontSize="small" color="action" />
                                    <Typography variant="subtitle1" fontWeight="bold">
                                        #{finishedItemInfo.itemId}
                                    </Typography>
                                </Stack>
                                {finishedItemInfo.model && (
                                    <Typography variant="body2" color="text.secondary">
                                        מודל: {finishedItemInfo.model}
                                    </Typography>
                                )}
                                {finishedItemInfo.serialNo && (
                                    <Typography variant="body2" color="text.secondary">
                                        סריאלי: {finishedItemInfo.serialNo}
                                    </Typography>
                                )}
                            </Stack>
                        </Card>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={() => setFinishedDialogOpen(false)}
                    variant="contained"
                    color="success"
                    size="large"
                    sx={{ borderRadius: 2, px: 4 }}
                >
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Barcode Scanner Dialog */}
        <Dialog
            open={scannerOpen}
            onClose={() => {
                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                setScannerOpen(false);
                setScanError(null);
                setScanInput("");
            }}
            maxWidth="sm"
            fullWidth
            PaperProps={{ sx: { borderRadius: 3 } }}
        >
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <QrCodeScannerIcon color="primary" />
                    <Typography variant="h6" component="span" fontWeight="bold">סריקת ברקוד פריט</Typography>
                </Box>
                <IconButton onClick={() => {
                    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                    setScannerOpen(false);
                    setScanError(null);
                    setScanInput("");
                }}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, py: 3 }}>
                    {scanError && (
                        <Box sx={{ width: "100%", p: 2, bgcolor: "error.light", color: "error.contrastText", borderRadius: 1 }}>
                            {scanError}
                        </Box>
                    )}
                    <QrCodeScannerIcon sx={{ fontSize: 80, color: "text.secondary", opacity: 0.5 }} />
                    <Typography variant="body1" color="text.secondary" textAlign="center">
                        סרוק את הברקוד של הפריט או הזן את המזהה ידנית
                    </Typography>
                    <TextField
                        autoFocus
                        fullWidth
                        size="medium"
                        placeholder="המתנה לסריקה..."
                        value={scanInput}
                        disabled={scanLoading}
                        onChange={(e) => {
                            const val = e.target.value;
                            setScanInput(val);
                            // Hardware scanners type quickly then stop — debounce and auto-submit.
                            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                            if (val.trim().length >= 1) {
                                scanTimeoutRef.current = setTimeout(() => {
                                    handleBarcodeScan(val);
                                }, 300);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && scanInput.trim()) {
                                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                                handleBarcodeScan(scanInput);
                            }
                        }}
                        InputProps={{
                            sx: { textAlign: "center", fontSize: "1.2rem" },
                            startAdornment: (
                                <InputAdornment position="start">
                                    <QrCodeIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={() => {
                        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                        setScannerOpen(false);
                        setScanError(null);
                        setScanInput("");
                    }}
                >
                    ביטול
                </Button>
                <Button
                    onClick={() => handleBarcodeScan(scanInput)}
                    variant="contained"
                    disabled={!scanInput.trim() || scanLoading}
                >
                    {scanLoading ? "מאתר..." : "אישור"}
                </Button>
            </DialogActions>
        </Dialog>

    </Box>
  );
}

export default function TestingPage() {
  // useSearchParams (the palette's ?type=/?station= deep link) needs a Suspense
  // boundary so the route isn't forced into client-side rendering at build time.
  return (
    <React.Suspense fallback={null}>
      <TestingPageView />
    </React.Suspense>
  );
}
