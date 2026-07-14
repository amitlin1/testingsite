"use client";
import * as React from "react";
import {
  Typography,
  TextField,
  Paper,
  Box,
  Card,
  CardContent,
  Button,
  Chip,
  Stack,
  Skeleton,
  Divider,
  alpha,
  MenuItem,
  Menu,
  InputAdornment,
  Grid,
  Container,
  useTheme,
  IconButton,
  Grow,
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
import { KeyboardArrowDown as KeyboardArrowDownIcon } from "@/components/ui/icons";
import { PlayArrowRounded as PlayArrowRoundedIcon } from "@/components/ui/icons";
import { Speed as SpeedIcon } from "@/components/ui/icons";
import { PrecisionManufacturing as PrecisionManufacturingIcon } from "@/components/ui/icons";
import { QrCode as QrCodeIcon } from "@/components/ui/icons";
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { TrendingUp as TrendingUpIcon } from "@/components/ui/icons";
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

// --- Item Card Component ---
function ItemCard({
  item,
  onAddTestResult,
  onStartTest,
  onRefresh,
  index,
  highlighted = false,
  hasWizard = false,
}: {
  item: ItemRow;
  onAddTestResult: (item: ItemRow) => void;
  onStartTest: (itemId: number) => Promise<void>;
  onRefresh: () => void;
  index: number;
  highlighted?: boolean;
  hasWizard?: boolean;
}) {
  const theme = useTheme();
  const baseTimeString =
    item.current_status === 1 || item.current_status === 5
      ? item.processing_start_time
      : item.current_status === 2 || item.current_status === 4
        ? item.queue_start_time
        : null;

  const elapsedTime = useElapsedTime(baseTimeString);
  const isInTest = item.current_status === 1 || item.current_status === 5;
  const isWaiting = item.current_status === 2 || item.current_status === 4;

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  


  // Status Colors
  const statusColor = isWaiting ? "#ff9800" : isInTest ? "#2196f3" : "#4caf50";
  const statusBg = isWaiting ? alpha("#ff9800", 0.1) : isInTest ? alpha("#2196f3", 0.1) : alpha("#4caf50", 0.1);

  return (
    <Grow in={true} timeout={(index + 1) * 200}>
      <Card
        elevation={0}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: "14px",
          bgcolor: "#fff",
          border: highlighted ? "1.5px solid #0066cc" : "1px solid #e0e0e0",
          boxShadow: highlighted ? "0 0 0 3px rgba(0,102,204,0.18)" : "none",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          overflow: "visible", // for the scanned badge
          position: "relative",
        }}
      >
        {highlighted && (
            <Chip
                size="small"
                icon={<QrCodeIcon sx={{ fontSize: "16px !important" }} />}
                label="נסרק"
                color="primary"
                sx={{
                    position: "absolute",
                    top: -10,
                    right: 14,
                    fontWeight: 600,
                    zIndex: 3,
                }}
            />
        )}

        <CardContent sx={{ p: 2, flexGrow: 1, display: "flex", flexDirection: "column", gap: 1.25, "&:last-child": { pb: 2 } }}>
            
            {/* Header: ID and Status */}
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
               <Box>
                    <Typography variant="h5" fontWeight="800" color="text.primary" sx={{ letterSpacing: "-0.5px" }}>
                        #{item.item_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" fontWeight="500">
                        {item.model}
                    </Typography>
               </Box>
               
               <Chip
                 label={item.item_status_desc || "סטטוס לא ידוע"}
                 size="small"
                 sx={{
                     bgcolor: statusBg,
                     color: statusColor,
                     fontWeight: 700,
                     borderRadius: 2,
                     border: `1px solid ${alpha(statusColor, 0.2)}`,
                     height: 28,
                     px: 1
                 }}
               />
            </Stack>

            <Divider sx={{ borderStyle: "dashed", borderColor: alpha(theme.palette.divider, 0.5) }} />

            {/* Info Grid */}
            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                 <Grid size={{ xs: 6 }}>
                      <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">סריאלי</Typography>
                          <Typography variant="body2" fontWeight="600">{item.serial_no}</Typography>
                      </Stack>
                 </Grid>
                 <Grid size={{ xs: 6 }}>
                      <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">מקט</Typography>
                          <Typography variant="body2" fontWeight="600">{item.makat}</Typography>
                      </Stack>
                 </Grid>
                 <Grid size={{ xs: 6 }}>
                      <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">לקוח</Typography>
                          <Typography variant="body2" fontWeight="600">{item.customer_code || "-"}</Typography>
                      </Stack>
                 </Grid>
                 <Grid size={{ xs: 6 }}>
                      <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">שלב נוכחי</Typography>
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <SpeedIcon sx={{ fontSize: 18, color: "primary.main" }} />
                                <Typography variant="body2" fontWeight="700" color="text.primary">{item.current_route_step}</Typography>
                           </Box>
                      </Stack>
                 </Grid>
            </Grid>

            {/* Timers & Connected Items */}
            <Stack spacing={1} sx={{ mt: 1 }}>
                {elapsedTime && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 2, bgcolor: alpha(statusColor, 0.05) }}>
                        <AccessTimeIcon sx={{ fontSize: 18, color: statusColor }} />
                        <Typography variant="body2" fontWeight="700" color={statusColor}>
                             {isWaiting ? "ממתין:" : "בבדיקה:"} {elapsedTime}
                        </Typography>
                    </Box>
                )}

                {(item.parent_item_id || item.has_children) && (
                    <Button
                        variant="outlined"
                        color="secondary"
                        size="small"
                        startIcon={<LinkIcon />}
                        endIcon={<KeyboardArrowDownIcon />}
                        onClick={handleMenuClick}
                        fullWidth
                        sx={{ 
                            justifyContent: "space-between",
                            borderRadius: 2,
                            borderColor: alpha(theme.palette.secondary.main, 0.3),
                            color: theme.palette.secondary.main
                        }}
                    >
                        פריטים מחוברים
                    </Button>
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
                    {item.connected_items && item.connected_items.length > 0 ? (
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
            </Stack>

            <Box sx={{ flexGrow: 1 }} />

            {/* Action Button */}
            <Button
                className="action-button"
                variant="contained"
                fullWidth
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
                color={isWaiting ? "warning" : "primary"}
                sx={{
                  mt: 1,
                  height: 44,
                  borderRadius: "11px",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                }}
                endIcon={isWaiting ? <PlayArrowRoundedIcon /> : <CheckCircleOutlineIcon />}
            >
              {isWaiting ? (item.current_status === 4 ? "התחל מחקר" : "התחל בדיקה") : "סיום ודיווח"}
            </Button>
        </CardContent>
      </Card>
    </Grow>
  );
}

// --- Main Page Component ---
export default function TestingPage() {
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
          const pending = pendingScanStationRef.current;
          if (pending && list.some((s) => s.test_station_id === pending.test_station_id)) {
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
    setFilterMakat("");
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
                        {/* Control Bar */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2,
                                mb: 4,
                                borderRadius: 3,
                                bgcolor: "white",
                                border: "1px solid rgba(0,0,0,0.04)",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.02)",
                                display: "flex",
                                flexDirection: { xs: "column", md: "row" },
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 2
                            }}
                        >
                             <Stack direction="row" alignItems="center" spacing={4}>
                                 <PrecisionManufacturingIcon color="primary" />
                                 <Typography variant="h6" fontWeight="700">
                                     {selectedStation.test_station_desc}
                                 </Typography>
                                 <Chip 
                                    label={`${filteredItems.length} פריטים`} 
                                    sx={{ fontWeight: "bold", bgcolor: alpha("#2196F3", 0.1), color: "primary.main" }} 
                                 />
                             </Stack>

                             <Box sx={{ display: "flex", gap: 2, width: { xs: "100%", md: "auto" } }}>
                                 <TextField
                                     fullWidth
                                     placeholder="סינון לפי מקט, מספר סריאלי או מזהה פריט..."
                                     size="small"
                                     value={filterMakat}
                                     onChange={(e) => setFilterMakat(e.target.value)}
                                     InputProps={{
                                         startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment>,
                                         endAdornment: filterMakat && (
                                            <InputAdornment position="end">
                                                <IconButton size="small" onClick={() => setFilterMakat("")}><ClearIcon fontSize="small"/></IconButton>
                                            </InputAdornment>
                                         )
                                     }}
                                     sx={{ 
                                         width: { xs: "100%", md: 350 },
                                         "& .MuiOutlinedInput-root": {
                                             bgcolor: "#f8f9fa",
                                             borderRadius: 2
                                         }
                                     }}
                                 />
                                 <Button
                                    variant="outlined"
                                    color="inherit"
                                    startIcon={<HistoryIcon />}
                                    onClick={() => setHistoryDialogOpen(true)}
                                    sx={{
                                        borderRadius: 2,
                                        borderColor: "#e0e0e0",
                                        "& .MuiButton-startIcon": {
                                            marginRight: 0,
                                            marginLeft: 1.5 // Force RTL spacing
                                        }
                                    }}
                                 >
                                    היסטוריה
                                 </Button>
                             </Box>
                        </Paper>

                        {/* Items Grid — dense auto-fill, ~258px min column */}
                        {itemsLoading ? (
                            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: "14px" }}>
                                {[1, 2, 3, 4].map((i) => (
                                    <Skeleton key={i} variant="rectangular" height={260} sx={{ borderRadius: "14px" }} />
                                ))}
                            </Box>
                        ) : filteredItems.length > 0 ? (
                            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: "14px", pb: 4 }}>
                                {filteredItems.map((item, index) => (
                                    <ItemCard
                                        key={`${item.item_id}-${index}`}
                                        item={item}
                                        onAddTestResult={handleAddTestResult}
                                        onStartTest={handleStartTest}
                                        onRefresh={handleRefreshItems}
                                        index={index}
                                        highlighted={highlightedItemId != null && Number(item.item_id) === Number(highlightedItemId)}
                                        hasWizard={selectedStationType != null && hasStartTestDialog(selectedStationType.id)}
                                    />
                                ))}
                            </Box>
                        ) : (
                            <Box sx={{ textAlign: "center", py: 10, opacity: 0.6 }}>
                                <InventoryIcon sx={{ fontSize: 60, color: "text.secondary", mb: 2 }} />
                                <Typography variant="h5" color="text.secondary">לא נמצאו פריטים</Typography>
                                <Typography variant="body1" color="text.secondary">העמדה ריקה כרגע, ייתכן ואין משימות הממתינות לביצוע</Typography>
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
