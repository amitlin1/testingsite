"use client";
import * as React from "react";
import {
  Typography,
  Autocomplete,
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
} from "@mui/material";

// Icons
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import ScienceIcon from "@mui/icons-material/Science"; // For Testing Screen
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import InventoryIcon from "@mui/icons-material/Inventory";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import HistoryIcon from "@mui/icons-material/History";
import LinkIcon from "@mui/icons-material/Link";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import SpeedIcon from "@mui/icons-material/Speed";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import QrCodeIcon from "@mui/icons-material/QrCode";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CloseIcon from "@mui/icons-material/Close";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
// MoreVertIcon removed

import PopUpTestDialog from "../components/PopUpTestDialog";
import StationHistoryDialog from "../components/StationHistoryDialog";
import WorkerPicker from "../components/WorkerPicker";

export interface TestStationTypeOption {
  id: number;
  name: string;
}
export interface TestStationOption {
  id: number;
  name: string;
  typeId: number;
  status: number;
  isResearch: boolean;
}

type Item = {
  itemId: number;
  itemTypeId: number;
  serialNo: number;
  makat: number;
  model: string;
  manufacturerName: string;
  manufacturerNo: number;
  currentStatus: number; // 1=InTest, 2=InQueue, 3=Finished, 4=WaitingResearch, 5=InResearch
  currentRouteStep: number;
  createdAt: string;
  processingStartTime: string | null;
  qStartTime: string | null;
  finishedAt: string | null;
  isFinished: boolean;
  itemStatusDesc: string | null;
  itemTypeDesc: string | null;
  routeSteps: number[] | null;
  routeNumber: number;
  customerCode: string | null;
  parentItemId?: number | null;
  hasChildren?: boolean;
  connectedItems?: { itemId: number; serialNo: string | null }[] | null;
  total_steps?: number; // Added if available from API, otherwise we might not show progress bar correctly
};

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
}: {
  item: Item;
  onAddTestResult: (item: Item) => void;
  onStartTest: (itemId: number) => Promise<void>;
  onRefresh: () => void;
  index: number;
  highlighted?: boolean;
}) {
  const theme = useTheme();
  const baseTimeString =
    item.currentStatus === 1 || item.currentStatus === 5
      ? item.processingStartTime
      : item.currentStatus === 2 || item.currentStatus === 4
        ? item.qStartTime
        : null;

  const elapsedTime = useElapsedTime(baseTimeString);
  const isInTest = item.currentStatus === 1 || item.currentStatus === 5;
  const isWaiting = item.currentStatus === 2 || item.currentStatus === 4;

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
          borderRadius: 4,
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(20px)",
          border: highlighted ? "2px solid #2196f3" : "1px solid rgba(255, 255, 255, 0.8)",
          boxShadow: highlighted
            ? "0 0 0 4px rgba(33, 150, 243, 0.25), 0 8px 32px 0 rgba(31, 38, 135, 0.12)"
            : "0 8px 32px 0 rgba(31, 38, 135, 0.07)",
          transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
          overflow: "visible", // for badges if needed
          position: "relative",
          "&:hover": {
            transform: "translateY(-8px)",
            boxShadow: highlighted
              ? "0 0 0 4px rgba(33, 150, 243, 0.35), 0 12px 40px 0 rgba(31, 38, 135, 0.18)"
              : "0 12px 40px 0 rgba(31, 38, 135, 0.15)",
            zIndex: 2,
            "& .action-button": {
                transform: "scale(1.05)",
            }
          },
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
                    right: 12,
                    fontWeight: 700,
                    zIndex: 3,
                    boxShadow: "0 4px 12px rgba(33, 150, 243, 0.4)",
                }}
            />
        )}
        {/* Card Header Gradient Line */}
        <Box 
            sx={{ 
                height: 6, 
                width: "100%", 
                background: isWaiting 
                    ? "linear-gradient(90deg, #FFC107 0%, #FF9800 100%)" 
                    : "linear-gradient(90deg, #2196F3 0%, #21CBF3 100%)",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
            }} 
        />

        <CardContent sx={{ p: 3, flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            
            {/* Header: ID and Status */}
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
               <Box>
                    <Typography variant="h5" fontWeight="800" color="text.primary" sx={{ letterSpacing: "-0.5px" }}>
                        #{item.itemId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" fontWeight="500">
                        {item.model}
                    </Typography>
               </Box>
               
               <Chip
                 label={item.itemStatusDesc || "סטטוס לא ידוע"}
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
                          <Typography variant="body2" fontWeight="600">{item.serialNo}</Typography>
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
                          <Typography variant="body2" fontWeight="600">{item.customerCode || "-"}</Typography>
                      </Stack>
                 </Grid>
                 <Grid size={{ xs: 6 }}>
                      <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">שלב נוכחי</Typography>
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <SpeedIcon sx={{ fontSize: 18, color: "primary.main" }} />
                                <Typography variant="body2" fontWeight="700" color="text.primary">{item.currentRouteStep}</Typography>
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

                {(item.parentItemId || item.hasChildren) && (
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
                    {item.connectedItems && item.connectedItems.length > 0 ? (
                        item.connectedItems.map((conn) => (
                          <MenuItem key={conn.itemId} onClick={handleMenuClose} dense>
                             <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
                                <QrCodeIcon fontSize="small" color="action" />
                                <Box>
                                    <Typography variant="subtitle2">#{conn.itemId}</Typography>
                                    <Typography variant="caption" color="text.secondary">S/N: {conn.serialNo || '-'}</Typography>
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
                    await onStartTest(item.itemId);
                    onRefresh();
                  } else if (isInTest) {
                    onAddTestResult(item);
                  }
                }}
                sx={{
                  mt: 2,
                  py: 1.2,
                  borderRadius: 3,
                  fontWeight: 700,
                  textTransform: "none",
                  fontSize: "1rem",
                  boxShadow: isWaiting 
                    ? "0 4px 14px 0 rgba(255, 152, 0, 0.39)"
                    : "0 4px 14px 0 rgba(33, 150, 243, 0.39)",
                  background: isWaiting
                    ? "linear-gradient(45deg, #FFC107 30%, #FF9800 90%)"
                    : "linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)",
                  transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
                  "&:hover": {
                     boxShadow: isWaiting
                        ? "0 6px 20px 0 rgba(255, 152, 0, 0.5)"
                        : "0 6px 20px 0 rgba(33, 150, 243, 0.5)",
                  }
                }}
                endIcon={isWaiting ? <PlayArrowRoundedIcon /> : <CheckCircleOutlineIcon />}
            >
              {isWaiting ? (item.currentStatus === 4 ? "התחל מחקר" : "התחל בדיקה") : "סיום ודיווח"}
            </Button>
        </CardContent>
      </Card>
    </Grow>
  );
}

// --- Main Page Component ---
export default function TestingPage() {
  const [stationTypes, setStationTypes] = React.useState<TestStationTypeOption[]>([]);
  const [selectedStationType, setSelectedStationType] = React.useState<TestStationTypeOption | null>(null);
  const [stations, setStations] = React.useState<TestStationOption[]>([]);
  const [selectedStation, setSelectedStation] = React.useState<TestStationOption | null>(null);
  const [items, setItems] = React.useState<Item[]>([]);
  const [stationTypesLoading, setStationTypesLoading] = React.useState(false);
  const [stationsLoading, setStationsLoading] = React.useState(false);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<Item | null>(null);
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
  const pendingScanStationRef = React.useRef<TestStationOption | null>(null);

  const filteredItems = React.useMemo(() => {
    const base = filterMakat
      ? items.filter((item) =>
          item.makat?.toString().includes(filterMakat) ||
          item.serialNo?.toString().includes(filterMakat) ||
          item.itemId?.toString().includes(filterMakat)
        )
      : items;

    // Hoist the scanned item to the front of the list (if present).
    if (highlightedItemId == null) return base;
    const idx = base.findIndex((it) => Number(it.itemId) === Number(highlightedItemId));
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
          const list: TestStationOption[] = Array.isArray(data) ? data : [];
          setStations(list);
          // If a scan flow staged a target station for this type, honor it
          // instead of clearing the selection (avoids a flicker / lost selection).
          const pending = pendingScanStationRef.current;
          if (pending && list.some((s) => s.id === pending.id)) {
            const fresh = list.find((s) => s.id === pending.id)!;
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
        const res = await fetch(`/api/testing/items?stationId=${selectedStation.id}`);
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

  const handleAddTestResult = (item: Item) => {
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
        const stationOption = stations.find((s) => s.id === data.stationId);
        if (!stationOption) {
          setScanError("העמדה של הפריט לא נמצאה ברשימה הטעונה");
          return;
        }
        setSelectedStation(stationOption);
      } else {
        // Stage the target station and let the stationType effect adopt it once stations load.
        pendingScanStationRef.current = {
          id: data.stationId,
          name: "",
          typeId: data.stationTypeId,
          status: 0,
          isResearch: false,
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
        body: JSON.stringify({ itemId, stationId: selectedStation.id }),
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
      const res = await fetch(`/api/testing/items?stationId=${selectedStation.id}`);
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
    const routeStepsLength = selectedItem.routeSteps?.length || 0;
    if (routeStepsLength === 0) throw new Error("Route steps information is missing.");

    const response = await fetch("/api/testing/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ItemID: selectedItem.itemId,
        StationID: selectedStation.id,
        CurrentRouteStep: selectedItem.currentRouteStep,
        RouteStepsLength: routeStepsLength,
        QueueStartTime: selectedItem.createdAt,
        ProcessingStartTime: selectedItem.processingStartTime,
        ItemTypeId: selectedItem.itemTypeId,
        CreatedAt: selectedItem.createdAt,
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
      const isResearchStatus = selectedItem.currentStatus === 5;
      const isFinishRoute = testData.finishRoute === true;
      
      setNextStationInfo({
        isLastStation: result.isLastStation || false,
        nextStation: result.nextStation || undefined,
        finishedFromResearch: isResearchStatus && isFinishRoute,
        finishedAtStep: selectedItem.currentRouteStep,
      });
      setNextStationDialogOpen(true);
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100vh", // Use minHeight to allow scrolling
        bgcolor: "#f0f2f5", // Light grey clean background
        backgroundImage: "radial-gradient(#e0e0e0 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden", // Prevent horizontal overflow
      }}
    >
        {/* Header Section */}
        <Paper
          elevation={0}
          sx={{
            py: 2,
            px: 3,
            bgcolor: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(0,0,0,0.05)",
            position: "sticky",
            top: 0,
            zIndex: 100,
          }}
        >
          <Container maxWidth="xl" disableGutters>
              <Grid container spacing={3} alignItems="center">
                  <Grid size={{ xs: 12, md: 3 }}>
                      <Stack direction="row" alignItems="center" spacing={6}>
                          <Box 
                            sx={{ 
                                width: 48, 
                                height: 48, 
                                borderRadius: 3, 
                                background: "linear-gradient(135deg, #1A237E 0%, #0D47A1 100%)",
                                display: "flex", 
                                alignItems: "center", 
                                justifyContent: "center",
                                boxShadow: "0 8px 16px rgba(13, 71, 161, 0.2)"
                            }}
                          >
                               <ScienceIcon sx={{ fontSize: 28, color: "white" }} />
                          </Box>
                          <Box>
                             <Typography variant="h5" fontWeight="800" sx={{ background: "-webkit-linear-gradient(45deg, #1A237E, #0D47A1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                                 מסך בדיקות
                             </Typography>
                             <Typography variant="body2" color="text.secondary" fontWeight="500">
                                 ניהול תהליך בדיקה ודיווח
                             </Typography>
                          </Box>
                      </Stack>
                  </Grid>

                  <Grid size={{ xs: 12, md: 9 }}>
                     <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: '100%' }}>
                        <Autocomplete
                          options={stationTypes}
                          getOptionLabel={(option) => option.name}
                          value={selectedStationType}
                          onChange={(_, n) => { setHighlightedItemId(null); setSelectedStationType(n); if (!n) { setStations([]); setSelectedStation(null); setItems([]); } }}
                          loading={stationTypesLoading}
                          fullWidth
                          renderInput={(params) => 
                            <TextField 
                                {...params} 
                                label="בחר סוג עמדה" 
                                variant="outlined" 
                                sx={{ 
                                    bgcolor: "white", 
                                    borderRadius: 2,
                                    "& .MuiOutlinedInput-input": {
                                        paddingLeft: "50px !important",
                                        paddingRight: "14px !important"
                                    },
                                    "& .MuiInputLabel-root": {
                                        paddingLeft: "50px !important",
                                        width: "calc(100% - 50px)"
                                    }
                                }} 
                            />
                          }
                        />
                        <Autocomplete
                          options={stations.filter((s) => s.status !== 3)}
                          getOptionLabel={(option) => option.name}
                          value={selectedStation}
                          onChange={(_, n) => { setHighlightedItemId(null); setSelectedStation(n); }}
                          loading={stationsLoading}
                          disabled={!selectedStationType}
                          fullWidth
                          renderInput={(params) =>
                            <TextField
                                {...params}
                                label="בחר עמדה פעילה"
                                variant="outlined" 
                                sx={{ 
                                    bgcolor: "white", 
                                    borderRadius: 2,
                                    "& .MuiOutlinedInput-input": {
                                        paddingLeft: "50px !important",
                                        paddingRight: "14px !important"
                                    },
                                    "& .MuiInputLabel-root": {
                                        paddingLeft: "50px !important",
                                        width: "calc(100% - 50px)"
                                    }
                                }}
                            />
                          }
                        />
                        <Button
                          variant="contained"
                          onClick={() => { setScanError(null); setScanInput(""); setScannerOpen(true); }}
                          startIcon={<QrCodeScannerIcon />}
                          sx={{
                              minWidth: { xs: "100%", md: 180 },
                              borderRadius: 2,
                              fontWeight: 700,
                              textTransform: "none",
                              fontSize: "0.95rem",
                              py: 1.3,
                              background: "linear-gradient(135deg, #1A237E 0%, #0D47A1 100%)",
                              boxShadow: "0 4px 14px rgba(13, 71, 161, 0.35)",
                              "& .MuiButton-startIcon": {
                                  marginRight: 0,
                                  marginLeft: 1.5
                              },
                              "&:hover": {
                                  background: "linear-gradient(135deg, #0D47A1 0%, #1A237E 100%)",
                                  boxShadow: "0 6px 20px rgba(13, 71, 161, 0.5)",
                              }
                          }}
                        >
                          סרוק ברקוד
                        </Button>
                     </Stack>
                  </Grid>

                  {/* Page-level worker picker — single source of truth for any
                      action taken from this page (finish test, file actions). */}
                  <Grid size={{ xs: 12 }}>
                      <Box
                          sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                              p: 1.25,
                              borderRadius: 2,
                              bgcolor: activeWorkerId ? alpha("#1A237E", 0.04) : alpha("#FF9800", 0.08),
                              border: `1px solid ${activeWorkerId ? alpha("#1A237E", 0.1) : alpha("#FF9800", 0.25)}`,
                          }}
                      >
                          <Typography
                              variant="body2"
                              sx={{
                                  fontWeight: 700,
                                  color: activeWorkerId ? "text.primary" : "warning.dark",
                                  whiteSpace: "nowrap",
                              }}
                          >
                              {activeWorkerId ? "פעולות יתועדו על שם:" : "בחר עובד לפני תחילת עבודה:"}
                          </Typography>
                          <Box sx={{ flex: 1, maxWidth: 360 }}>
                              <WorkerPicker
                                  value={activeWorkerId}
                                  onChange={handleWorkerChange}
                                  hideHeader
                                  size="small"
                                  placeholder="בחר עובד..."
                              />
                          </Box>
                      </Box>
                  </Grid>
              </Grid>
          </Container>
        </Paper>

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
                                     {selectedStation.name}
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

                        {/* Items Grid */}
                        {itemsLoading ? (
                            <Grid container spacing={3}>
                                {[1, 2, 3, 4].map((i) => (
                                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={i}>
                                        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 4 }} />
                                    </Grid>
                                ))}
                            </Grid>
                        ) : filteredItems.length > 0 ? (
                            <Grid container spacing={3} paddingBottom={4}>
                                {filteredItems.map((item, index) => (
                                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2.4 }} key={`${item.itemId}-${index}`}>
                                        <ItemCard
                                            item={item}
                                            onAddTestResult={handleAddTestResult}
                                            onStartTest={handleStartTest}
                                            onRefresh={handleRefreshItems}
                                            index={index}
                                            highlighted={highlightedItemId != null && Number(item.itemId) === Number(highlightedItemId)}
                                        />
                                    </Grid>
                                ))}
                            </Grid>
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

        {/* Dialogs */}
        <PopUpTestDialog
           open={dialogOpen}
           onClose={() => setDialogOpen(false)}
           itemId={selectedItem?.itemId || 0}
           stationId={selectedStation?.id || 0}
           itemName={selectedItem?.model}
           currentStatus={selectedItem?.currentStatus}
           workerId={activeWorkerId}
           workerName={activeWorkerName}
           onSubmit={handleSubmitTestResult}
        />

        {selectedStation && (
            <StationHistoryDialog
                open={historyDialogOpen}
                onClose={() => setHistoryDialogOpen(false)}
                stationId={selectedStation.id}
                stationName={selectedStation.name}
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
