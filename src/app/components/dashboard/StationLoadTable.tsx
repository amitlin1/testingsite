"use client";
import * as React from "react";
import {
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Box,
  Skeleton,
  Chip,
  alpha,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  DialogTitle,
  IconButton,
  Paper,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { TableChart as TableChartIcon } from "@/components/ui/icons";
import { BarChart as BarChartIcon } from "@/components/ui/icons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from "recharts";
import { StationLoadRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import StationHistoryDialog from "./StationHistoryDialog";

interface StationLoadTableProps {
  data: StationLoadRow[];
  loading: boolean;
  viewMode: "table" | "chart";
  onViewModeChange: (mode: "table" | "chart") => void;
}

// Custom Tooltip for Bar Chart
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <Box
        sx={{
          bgcolor: "rgba(255, 255, 255, 0.95)",
          border: "1px solid #ccc",
          p: 1.5,
          borderRadius: 1,
          direction: "rtl",
          boxShadow: 3,
        }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
          {label}
        </Typography>
        {payload.map((entry: any, index: number) => (
          <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: entry.color }} />
            <Typography variant="body2" sx={{ color: "text.primary" }}>
              {entry.name}: {entry.value}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  }
  return null;
};

export default function StationLoadTable({ data, loading, viewMode, onViewModeChange }: StationLoadTableProps) {
  const theme = useTheme();
  // const [viewMode, setViewMode] = React.useState<"table" | "chart">("table"); // Removed internal viewMode state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedStation, setSelectedStation] = React.useState<StationLoadRow | null>(null);

  const handleRowClick = (station: StationLoadRow) => {
    setSelectedStation(station);
    setHistoryOpen(true);
  };



  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  if (loading) {
    return (
      <Paper elevation={0} sx={{ height: "100%", p: 2, bgcolor: "transparent" }}>
        <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
        <Skeleton variant="rectangular" height="100%" />
      </Paper>
    );
  }

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) {
      return "-";
    }
    return formatDuration(minutes * 60 * 1000, "short");
  };

  // חישוב רוחב הגרף לפי כמות הנתונים
  const chartWidth = Math.max(data.length * 80, 600); // מינימום 600px, או 80px לעמדה

  // Render content component (used both in card and dialog)
  const renderContent = (isDialog = false) => (
    <>
      {viewMode === "table" ? (
        <TableContainer
          sx={{
            width: "100%",
            maxWidth: "100%",
            flex: 1,
            overflowX: "auto",
            overflowY: "auto",
            direction: "rtl",
            minHeight: 0,
            height: "100%",
          }}
        >
          <Table size="small" stickyHeader sx={{ width: "100%", minWidth: 500, direction: "rtl" }}>
            <TableHead sx={{ position: "sticky", top: 0, zIndex: 1 }}>
              <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>עמדה</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>בהמתנה</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>בעבודה</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>זמן תור ממוצע</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>סה&quot;כ טופל</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: "center", py: 4, direction: "rtl" }}>
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                      אין נתונים
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow
                    key={row.stationId}
                    hover
                    onClick={(e) => { e.stopPropagation(); handleRowClick(row); }}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Box sx={{ direction: "rtl", textAlign: "right" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                          {row.stationName}
                        </Typography>
                        {row.stationTypeName && (
                          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right", display: "block" }}>
                            {row.stationTypeName}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Chip
                        label={row.itemsInQueue}
                        size="small"
                        sx={{
                          bgcolor: row.itemsInQueue > 0 ? alpha("#ff9800", 0.1) : alpha("#9e9e9e", 0.1),
                          color: row.itemsInQueue > 0 ? "#ff9800" : "#9e9e9e",
                          fontWeight: 600,
                          minWidth: 32,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Chip
                        label={row.itemsInTest}
                        size="small"
                        sx={{
                          bgcolor: row.itemsInTest > 0 ? alpha("#1976d2", 0.1) : alpha("#9e9e9e", 0.1),
                          color: row.itemsInTest > 0 ? "#1976d2" : "#9e9e9e",
                          fontWeight: 600,
                          minWidth: 32,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Typography variant="body2" sx={{ textAlign: "right" }}>{formatMinutes(row.averageCurrentQueueTimeMinutes)}</Typography>
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                        {row.totalProcessedInPeriod}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box
          onClick={!isDialog ? handleOpenDialog : undefined}
          sx={{
            width: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            direction: "ltr",
            cursor: isDialog ? "default" : "pointer",
          }}
        >
          <Box sx={{ width: chartWidth, height: "100%", p: 1, minHeight: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{
                  top: 20,
                  right: 30,
                  left: 20,
                  bottom: 60, // Increased bottom margin for labels
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="stationName"
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
                  height={60}
                />
                <YAxis tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 5, paddingTop: 0, marginTop: -10 }} />
                <Bar
                  dataKey="itemsInQueue"
                  name="בהמתנה"
                  fill="#ff9800"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
                <Bar
                  dataKey="itemsInTest"
                  name="בעבודה"
                  fill="#1976d2"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
    </>
  );

  return (
    <Paper elevation={0} sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "transparent" }}>
      {renderContent(false)}

      <StationHistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        station={selectedStation}
      />
    </Paper>
  );
}
