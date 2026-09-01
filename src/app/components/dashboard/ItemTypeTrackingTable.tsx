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
  LinearProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
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
import { ItemTypeTrackingRow } from "@/types/dashboard";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import ItemTypeHistoryDialog from "./ItemTypeHistoryDialog";


interface ItemTypeTrackingTableProps {
  data: ItemTypeTrackingRow[];
  loading: boolean;
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

/** A percentage whose denominator was 0 arrives as null — an entity with no
 *  items has no completion rate. Rendered as "-", and the bar left empty: the
 *  JSX used to print the string "null%" and hand LinearProgress a null value. */
function formatPct(pct: number | null): string {
  return pct === null || pct === undefined ? "-" : `${pct}%`;
}

export default function ItemTypeTrackingTable({ data, loading }: ItemTypeTrackingTableProps) {
  const theme = useTheme();
  const [viewMode, setViewMode] = React.useState<"table" | "chart">("table");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedItemType, setSelectedItemType] = React.useState<ItemTypeTrackingRow | null>(null);

  const handleRowClick = (item: ItemTypeTrackingRow) => {
    setSelectedItemType(item);
    setHistoryOpen(true);
  };

  const handleViewModeChange = (
    event: React.MouseEvent<HTMLElement>,
    newMode: "table" | "chart" | null
  ) => {
    if (newMode !== null) {
      setViewMode(newMode);
    }
    event.stopPropagation(); // Prevent triggering dialog open
  };

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  // Action Component (Toggle Buttons)
  const action = (
    <ToggleButtonGroup
      value={viewMode}
      exclusive
      onChange={handleViewModeChange}
      size="small"
      aria-label="view mode"
      sx={{ direction: "ltr" }}
    >
      <ToggleButton value="table" aria-label="table view">
        <TableChartIcon fontSize="small" />
      </ToggleButton>
      <ToggleButton value="chart" aria-label="chart view">
        <BarChartIcon fontSize="small" />
      </ToggleButton>
    </ToggleButtonGroup>
  );

  if (loading) {
    return (
      <DashboardCard title="מעקב לפי סוג פריט" action={action}>
        <Box sx={{ p: 2, flex: 1 }}>
          <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
          <Skeleton variant="rectangular" height={300} />
        </Box>
      </DashboardCard>
    );
  }

  // חישוב רוחב הגרף לפי כמות הנתונים
  const chartWidth = Math.max(data.length * 100, 600);

  // פונקציה לקצר שם סוג פריט (מקסימום 15 תווים)
  const truncateItemTypeDesc = (desc: string, maxLength: number = 15): string => {
    if (desc.length <= maxLength) return desc;
    return desc.substring(0, maxLength) + "...";
  };

  // Custom tick renderer for XAxis with tooltip on hover
  const renderCustomTick = (props: any) => {
    const { x, y, payload } = props;
    const fullText = payload.value;
    const truncatedText = truncateItemTypeDesc(fullText, 15);
    const needsTruncation = fullText.length > 15;
    
    return (
      <g transform={`translate(${x},${y})`}>
        {needsTruncation ? (
          <title>{fullText}</title>
        ) : null}
        <text
          x={0}
          y={0}
          dy={16}
          textAnchor="end"
          fill={theme.palette.text.secondary}
          fontSize={12}
          transform="rotate(-45)"
          style={{ cursor: needsTruncation ? "help" : "default" }}
        >
          {truncatedText}
        </text>
      </g>
    );
  };

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
            maxHeight: isDialog ? "none" : 400,
          }}
        >
          <Table size="small" stickyHeader sx={{ width: "100%", minWidth: 1000, direction: "rtl" }}>
            <TableHead sx={{ position: "sticky", top: 0, zIndex: 1 }}>
              <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>סוג פריט</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>סה&quot;כ פריטים</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתינים</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>בבדיקה</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתין למחקר</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>במחקר</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>הושלמו</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>אחוז השלמה</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>פריטים במסלול</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} sx={{ textAlign: "center", py: 4, direction: "rtl" }}>
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                      אין נתונים
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow 
                    key={row.itemTypeId} 
                    hover
                    onClick={(e) => { e.stopPropagation(); handleRowClick(row); }}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                        {row.itemTypeDesc}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                        {row.totalItems}
                      </Typography>
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
                      <Chip
                        label={row.itemsWaitingForResearch}
                        size="small"
                        sx={{
                          bgcolor: row.itemsWaitingForResearch > 0 ? alpha("#9c27b0", 0.1) : alpha("#9e9e9e", 0.1),
                          color: row.itemsWaitingForResearch > 0 ? "#9c27b0" : "#9e9e9e",
                          fontWeight: 600,
                          minWidth: 32,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Chip
                        label={row.itemsInResearch}
                        size="small"
                        sx={{
                          bgcolor: row.itemsInResearch > 0 ? alpha("#673ab7", 0.1) : alpha("#9e9e9e", 0.1),
                          color: row.itemsInResearch > 0 ? "#673ab7" : "#9e9e9e",
                          fontWeight: 600,
                          minWidth: 32,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                      <Chip
                        label={row.itemsFinished}
                        size="small"
                        sx={{
                          bgcolor: row.itemsFinished > 0 ? alpha("#2e7d32", 0.1) : alpha("#9e9e9e", 0.1),
                          color: row.itemsFinished > 0 ? "#2e7d32" : "#9e9e9e",
                          fontWeight: 600,
                          minWidth: 32,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl", minWidth: 120 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexDirection: "row-reverse" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 40, textAlign: "left" }}>
                          {formatPct(row.completionPercentage)}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={row.completionPercentage ?? 0}
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: 1,
                            bgcolor: alpha("#e0e0e0", 0.3),
                            "& .MuiLinearProgress-bar": {
                              bgcolor: row.completionPercentage === 100 ? "#2e7d32" : (row.completionPercentage ?? 0) >= 50 ? "#1976d2" : "#ff9800",
                            },
                          }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell sx={{ textAlign: "right", direction: "rtl", minWidth: 140 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexDirection: "row-reverse" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 50, textAlign: "left" }}>
                          {formatPct(row.itemsInRoutesPercentage)} ({row.itemsInRoutes})
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={row.itemsInRoutesPercentage ?? 0}
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: 1,
                            bgcolor: alpha("#e0e0e0", 0.3),
                            "& .MuiLinearProgress-bar": {
                              bgcolor: "#1976d2",
                            },
                          }}
                        />
                      </Box>
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
          <Box sx={{ width: chartWidth, height: isDialog ? 420 : 280, p: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{
                  top: 10,
                  right: 30,
                  left: 20,
                  bottom: 60,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="itemTypeDesc"
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  tick={renderCustomTick}
                  height={60}
                />
                <YAxis tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 5, paddingTop: 0, marginTop: -10 }} />
                <Bar
                  dataKey="itemsInQueue"
                  name="ממתינים"
                  fill="#ff9800"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
                <Bar
                  dataKey="itemsInTest"
                  name="בבדיקה"
                  fill="#1976d2"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
                <Bar
                  dataKey="itemsWaitingForResearch"
                  name="ממתין למחקר"
                  fill="#9c27b0"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
                <Bar
                  dataKey="itemsInResearch"
                  name="במחקר"
                  fill="#673ab7"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
                <Bar
                  dataKey="itemsFinished"
                  name="הושלמו"
                  fill="#2e7d32"
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
    <>
      <DashboardCard title="מעקב לפי סוג פריט" action={action}>
        {renderContent(false)}
      </DashboardCard>

      {/* Dialog for full-size view */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            maxHeight: "90vh",
            height: "90vh",
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            direction: "rtl",
            borderBottom: `1px solid ${alpha("#000", 0.1)}`,
            fontWeight: 700,
          }}
        >
          מעקב לפי סוג פריט
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {action}
            <IconButton
              onClick={handleCloseDialog}
              size="small"
              sx={{ bgcolor: alpha("#000", 0.04), "&:hover": { bgcolor: alpha("#000", 0.08) } }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            p: 2,
            direction: "rtl",
            minHeight: 0,
          }}
        >
          {renderContent(true)}
        </DialogContent>
      </Dialog>
      
      <ItemTypeHistoryDialog 
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        itemType={selectedItemType}
      />
    </>
  );
}
