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
  Tooltip as MuiTooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import TableChartIcon from "@mui/icons-material/TableChart";
import BarChartIcon from "@mui/icons-material/BarChart";
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
import { ShipmentTrackingRow } from "@/types/dashboard";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import { formatDate } from "@/app/lib/datetime";
import ShipmentHistoryDialog from "./ShipmentHistoryDialog";
import CompletionHistoryChart from "./CompletionHistoryChart";
import TimelineIcon from '@mui/icons-material/Timeline';

interface ShipmentTrackingTableProps {
  data: ShipmentTrackingRow[];
  loading: boolean;
  viewMode: "table" | "chart";
  onViewModeChange: (mode: "table" | "chart") => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

// Custom Tooltip for Bar Chart
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
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
        {payload.map((entry, index: number) => (
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

export default function ShipmentTrackingTable({ data, loading, viewMode, onViewModeChange }: ShipmentTrackingTableProps) {
  const theme = useTheme();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedShipment, setSelectedShipment] = React.useState<ShipmentTrackingRow | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [completionHistoryOpen, setCompletionHistoryOpen] = React.useState(false);

  const handleOpenDialog = (shipment: ShipmentTrackingRow) => {
    setSelectedShipment(shipment);
    setHistoryOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedShipment(null);
  };

  const handleViewModeChange = (
    event: React.MouseEvent<HTMLElement>,
    newMode: "table" | "chart" | null
  ) => {
    if (newMode !== null) {
      onViewModeChange(newMode);
    }
    event.stopPropagation(); // Prevent triggering dialog open
  };

  // Action Component (Toggle Buttons)
  const action = (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
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

    {/* <MuiTooltip title="היסטוריית אחוזי השלמה">
       <IconButton onClick={() => setCompletionHistoryOpen(true)} size="small" sx={{ ml: 1 }}>
          <TimelineIcon />
       </IconButton>
    </MuiTooltip> */}
  </Box>
  );

  if (loading) {
    return (
      <Box sx={{ p: 2, flex: 1, height: "100%" }}>
        <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
        <Skeleton variant="rectangular" height="100%" />
      </Box>
    );
  }

  // חישוב רוחב הגרף לפי כמות הנתונים
  const chartWidth = Math.max(data.length * 100, 600);

  // פונקציה לקצר שם משלוח (מקסימום 10 תווים)
  const truncateShipmentCode = (code: string, maxLength: number = 10): string => {
    if (code.length <= maxLength) return code;
    return code.substring(0, maxLength) + "...";
  };

  // Custom tick renderer for XAxis with tooltip on hover
  const renderCustomTick = (props: any) => {
    const { x, y, payload } = props;
    const fullText = payload.value;
    const truncatedText = truncateShipmentCode(fullText, 10);
    const needsTruncation = fullText.length > 10;
    
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
  const renderContent = (isDialog = false) => {
    if (viewMode === "chart" && !isDialog) {
        const chartData = data
            .filter(d => d.totalItems > 0)
            .map(d => ({
                code: d.shipmentCode.toString(),
                completed: d.itemsFinished,
                total: d.totalItems,
                completion: Math.round((d.itemsFinished / d.totalItems) * 100)
            }))
            .slice(0, 20); // Limit to top 20 for readability

      return (
        <Box sx={{ width: "100%", height: "100%", minHeight: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="code" 
                angle={-45} 
                textAnchor="end" 
                interval={0} 
                height={60} 
                tick={{ fontSize: 12 }}
              />
              <YAxis />
              <Tooltip />
              <Legend verticalAlign="top"/>
              <Bar dataKey="total" name="סה&quot;כ פריטים" fill="#9e9e9e" />
              <Bar dataKey="completed" name="הושלמו" fill="#2e7d32" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      );
    }

    return (
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
        <Table size="small" stickyHeader sx={{ width: "100%", minWidth: 1100, direction: "rtl" }}>
          <TableHead sx={{ position: "sticky", top: 0, zIndex: 1 }}>
            <TableRow sx={{ bgcolor: "#f5f5f5" }}>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>קוד משלוח</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>תאריך</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>לקוח</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>סה&quot;כ פריטים</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתינים</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>בבדיקה</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתין למחקר</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>במחקר</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>הושלמו</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>אחוז השלמה</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} sx={{ textAlign: "center", py: 4, direction: "rtl" }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                  אין נתונים
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
              data.map((row) => (
                <TableRow 
                  key={row.shipmentId} 
                  hover 
                  onClick={() => handleOpenDialog(row)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                      {row.shipmentCode}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ textAlign: "right" }}>
                      {formatDate(row.shipmentDate)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Box sx={{ direction: "rtl", textAlign: "right" }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, textAlign: "right" }}>
                        {row.customerName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right", display: "block" }}>
                        {row.customerCode}
                      </Typography>
                    </Box>
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
                          {row.completionPercentage}%
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={row.completionPercentage}
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: 1,
                            bgcolor: alpha("#e0e0e0", 0.3),
                            "& .MuiLinearProgress-bar": {
                              bgcolor: row.completionPercentage === 100 ? "#2e7d32" : row.completionPercentage >= 50 ? "#1976d2" : "#ff9800",
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
    );
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {renderContent(false)}

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
          מעקב משלוחים
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
      
      <ShipmentHistoryDialog 
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        shipment={selectedShipment}
      />

      <Dialog
        open={completionHistoryOpen}
        onClose={() => setCompletionHistoryOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: { height: "70vh", display: "flex", flexDirection: "column", direction: "rtl" },
        }}
      >
        <DialogTitle sx={{ borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between" }}>
            היסטוריית אחוזי השלמה
            <IconButton onClick={() => setCompletionHistoryOpen(false)}>
                <CloseIcon />
            </IconButton>
        </DialogTitle>
        <DialogContent sx={{ flex: 1, p: 2 }}>
            <CompletionHistoryChart />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
