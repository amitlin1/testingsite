"use client";
import * as React from "react";
import { Paper, Typography, Box, Skeleton, useTheme, Dialog, DialogContent, DialogTitle, IconButton, alpha } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  TooltipProps,
} from "recharts";
import { StatusDistribution } from "@/types/dashboard";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import StatusDistributionHistoryChart from "./StatusDistributionHistoryChart";

interface StatusDistributionChartProps {
  data: StatusDistribution[];
  loading: boolean;
  filters?: {
    customerId: number | null;
    shipmentId: number | null;
    itemTypeId: number | null;
    testStationId: number | null;
  };
}

// Custom Tooltip for Pie Chart
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    return (
      <Paper elevation={3} sx={{ p: 1.5, bgcolor: "rgba(255, 255, 255, 0.95)", direction: "rtl" }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
          {data.name}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.primary" }}>
          כמות: {data.value}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.primary" }}>
          אחוז: {data.payload?.percentage || 0}%
        </Typography>
      </Paper>
    );
  }
  return null;
};

  // Custom Label for Pie Chart
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.1) return null; // Only show for > 10%

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight="bold"
      style={{ pointerEvents: 'none' }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function StatusDistributionChart({ data, loading, filters }: StatusDistributionChartProps) {
  const theme = useTheme();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const handleOpenHistoryDialog = (e: React.MouseEvent) => {
    e.stopPropagation(); 
    setHistoryDialogOpen(true);
  };

  const handleCloseHistoryDialog = () => {
    setHistoryDialogOpen(false);
  };

  const getStatusColor = (status: string): string => {
    const colorMap: { [key: string]: string } = {
      "1": "#1976d2", // Blue
      "2": "#ff9800", // Orange
      "3": "#2e7d32", // Green
      "4": "#9c27b0", // Purple
      "5": "#d32f2f", // Red
    };
    return colorMap[status] || "#9e9e9e";
  };

  if (loading) {
    return (
      <DashboardCard title="התפלגות לפי סטטוס">
        <Box sx={{ p: 2, flex: 1, height: "100%", minHeight: 300 }}>
          <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
          <Skeleton variant="circular" width="80%" height="80%" sx={{ mx: "auto", maxHeight: 300, maxWidth: 300 }} />
        </Box>
      </DashboardCard>
    );
  }

  if (data.length === 0) {
    return (
      <DashboardCard title="התפלגות לפי סטטוס">
        <Box sx={{ p: 2, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, height: "100%" }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", direction: "rtl" }}>
            אין נתונים לתצוגה
          </Typography>
        </Box>
      </DashboardCard>
    );
  }

  const chartData = data.map((item) => ({
    name: item.statusName,
    value: item.count,
    percentage: item.percentage,
    status: item.status,
  }));

  const colors = chartData.map((item) => getStatusColor(item.status));

  const renderContent = (isDialog = false) => {
    const totalItems = data.reduce((sum, item) => sum + (item.count || 0), 0);

    return (
      <Box 
        onClick={!isDialog ? handleOpenDialog : undefined}
        sx={{ 
          width: "100%", 
          height: isDialog ? 500 : "100%", 
          minHeight: isDialog ? 500 : 300, 
          p: 2, 
          direction: "ltr",
          cursor: isDialog ? "default" : "pointer",
          position: "relative",
          display: "flex",
          flexDirection: isDialog ? "row" : "column",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {!isDialog && (
          <IconButton
            onClick={handleOpenHistoryDialog}
            size="small"
            sx={{
              position: "absolute",
              top: 0,
              right: 8,
              zIndex: 10,
              bgcolor: alpha(theme.palette.action.active, 0.05),
              "&:hover": { bgcolor: alpha(theme.palette.action.active, 0.1) }
            }}
            title="היסטוריה"
          >
            <HistoryIcon />
          </IconButton>
        )}
          
          {/* Chart Container - Flex 1 to take available space */}
          <Box sx={{ width: isDialog ? "60%" : "100%", flex: 1, minHeight: 0, position: "relative" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderCustomLabel}
                  innerRadius={isDialog ? "50%" : "45%"}
                  outerRadius={isDialog ? "80%" : "75%"}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index]} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
             
             <Box
                sx={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  textAlign: "center",
                  pointerEvents: "none",
                }}
              >
                <Typography variant="h4" fontWeight={700} color="text.primary">
                  {totalItems}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  סה"כ
                </Typography>
              </Box>
          </Box>

          {/* Legend Container - Fixed or Auto height */}
          <Box sx={{ 
              width: isDialog ? "40%" : "100%", 
              mt: isDialog ? 0 : 2,
              pl: isDialog ? 4 : 0,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              direction: "rtl",
              maxHeight: isDialog ? "100%" : 120,
              overflowY: "auto",
              pr: 1,
              flexShrink: 0 // Prevent shrinking
          }}>
              {chartData.map((entry, index) => (
                  <Box key={index} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: colors[index] }} />
                          <Typography variant="body2" sx={{ fontWeight: 500, color: "text.primary" }}>
                              {entry.name}
                          </Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: "text.primary" }}>
                              {entry.value}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 35, textAlign: "left" }}>
                              ({entry.percentage}%)
                          </Typography>
                      </Box>
                  </Box>
              ))}
          </Box>
      </Box>
    );
  };
  return (
    <>
      <Paper elevation={0} sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "transparent" }}>
        {renderContent(false)}
      </Paper>

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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              onClick={handleOpenHistoryDialog}
              size="small"
              sx={{ bgcolor: alpha("#000", 0.04), "&:hover": { bgcolor: alpha("#000", 0.08) } }}
              title="היסטוריה"
            >
              <HistoryIcon />
            </IconButton>
            <IconButton
              onClick={handleCloseDialog}
              size="small"
              sx={{ bgcolor: alpha("#000", 0.04), "&:hover": { bgcolor: alpha("#000", 0.08) } }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          התפלגות לפי סטטוס
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

      {/* Dialog for history chart */}
      <Dialog
        open={historyDialogOpen}
        onClose={handleCloseHistoryDialog}
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
          היסטוריית התפלגות לפי סטטוס
          <IconButton
            onClick={handleCloseHistoryDialog}
            size="small"
            sx={{ bgcolor: alpha("#000", 0.04), "&:hover": { bgcolor: alpha("#000", 0.08) } }}
          >
            <CloseIcon />
          </IconButton>
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
          <StatusDistributionHistoryChart filters={filters} />
        </DialogContent>
      </Dialog>
    </>
  );
}

