"use client";

import * as React from "react";
import { Box, Typography, Button } from "@mui/material";
import ScienceIcon from "@mui/icons-material/Science";
import PersonIcon from "@mui/icons-material/Person";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import WorkerPicker from "../WorkerPicker";

import type { StationLite } from "@/types";

type TestingDockProps = {
  hasStation: boolean;
  stationName: string | null;
  stationTypeName: string | null;
  itemCount: number;
  allStations: StationLite[];
  typeNameById: (typeId: number) => string;
  selectedStationId: number | null;
  onPickStation: (station: StationLite | null) => void;
  activeWorkerId: number | null;
  activeWorkerName: string;
  onWorkerChange: (id: number | null) => void;
  onScan: () => void;
};

/**
 * Auto-hiding context dock for the Testing screen (round-2 redesign).
 *
 * A slim always-visible strip (station + worker chip + hint) maximises board
 * space; hovering it reveals a panel with an all-stations search, the worker
 * picker, and the scan button. The panel is also pinned open when no station is
 * selected yet, or while any dropdown inside it is open (so it can't vanish
 * mid-selection) — mirroring the prototype's `dockHover || openCombo || !station`.
 */
export default function TestingDock({
  hasStation,
  stationName,
  stationTypeName,
  itemCount,
  allStations,
  typeNameById,
  selectedStationId,
  onPickStation,
  activeWorkerId,
  activeWorkerName,
  onWorkerChange,
  onScan,
}: TestingDockProps) {
  const [hover, setHover] = React.useState(false);
  const [stationOpen, setStationOpen] = React.useState(false);
  const [workerOpen, setWorkerOpen] = React.useState(false);

  const panelShow = hover || stationOpen || workerOpen || !hasStation;
  const hasWorker = activeWorkerId != null;

  const selectedStation = React.useMemo(
    () => allStations.find((s) => s.id === selectedStationId) ?? null,
    [allStations, selectedStationId]
  );

  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{ position: "sticky", top: 0, zIndex: 30 }}
    >
      {/* Slim peek strip */}
      <Box
        sx={{
          bgcolor: "rgba(245,245,247,0.9)",
          backdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <Box
          sx={{
            maxWidth: 1280,
            mx: "auto",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 3,
            py: 1,
          }}
        >
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: "8px",
              bgcolor: "#1d1d1f",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ScienceIcon sx={{ fontSize: 17 }} />
          </Box>
          <Box sx={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 1 }}>
            <Typography
              sx={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {hasStation ? stationName : "בחר עמדה לבדיקה"}
            </Typography>
            <Typography sx={{ fontSize: 12, color: "#7a7a7a", whiteSpace: "nowrap", display: { xs: "none", sm: "inline" } }}>
              {hasStation ? `${stationTypeName ?? ""} · ${itemCount} פריטים` : "רחף כאן לבחירת עמדה ועובד"}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              borderRadius: 9999,
              px: 1.4,
              py: 0.5,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              bgcolor: hasWorker ? "rgba(0,102,204,0.08)" : "rgba(217,118,6,0.10)",
              border: `1px solid ${hasWorker ? "rgba(0,102,204,0.22)" : "rgba(217,118,6,0.32)"}`,
              color: hasWorker ? "#0066cc" : "#9a5b06",
            }}
          >
            <PersonIcon sx={{ fontSize: 14 }} />
            {hasWorker ? activeWorkerName || "עובד" : "בחר עובד"}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: { xs: "none", md: "inline-flex" }, alignItems: "center", gap: 0.75, fontSize: 12, color: "#9a9aa0", whiteSpace: "nowrap" }}>
            <KeyboardArrowDownIcon sx={{ fontSize: 15 }} />
            שינוי עמדה ועובד
          </Box>
        </Box>
      </Box>

      {/* Hover-revealed panel */}
      <Box
        sx={{
          position: "absolute",
          insetInlineStart: 0,
          insetInlineEnd: 0,
          top: "100%",
          opacity: panelShow ? 1 : 0,
          transform: panelShow ? "translateY(0)" : "translateY(-8px)",
          pointerEvents: panelShow ? "auto" : "none",
          transition: "opacity 0.2s ease, transform 0.2s ease",
          bgcolor: "rgba(245,245,247,0.97)",
          backdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "rgba(0,0,0,0.12) 0 16px 30px -12px",
        }}
      >
        <Box
          sx={{
            maxWidth: 1280,
            mx: "auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 1.75,
            flexWrap: "wrap",
            px: 3,
            py: 1.75,
          }}
        >
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
                  <Typography sx={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: "#9a9aa0" }}>{typeNameById(o.typeId)}</Typography>
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
              placeholder="חפש עובד…"
              onOpen={() => setWorkerOpen(true)}
              onClose={() => setWorkerOpen(false)}
            />
          </Box>

          <Button
            variant="contained"
            onClick={onScan}
            startIcon={<QrCodeScannerIcon />}
            sx={{
              height: 44,
              borderRadius: "10px",
              bgcolor: "#1d1d1f",
              fontWeight: 600,
              px: 2.5,
              "&:hover": { bgcolor: "#000" },
              "& .MuiButton-startIcon": { marginRight: 0, marginLeft: 1 },
            }}
          >
            סרוק ברקוד
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
