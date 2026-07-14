"use client";
import * as React from "react";
import { Paper, Typography, Box, Skeleton, useTheme, Dialog, DialogContent, DialogTitle, IconButton, alpha } from "@mui/material";
import { Close as CloseIcon } from "@/components/ui/icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TimeSeriesPoint } from "@/types/dashboard";
import DashboardCard from "@/app/components/dashboard/DashboardCard";

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  loading: boolean;
}

// Custom Tooltip Component
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number }) => {
  if (active && payload && payload.length && label) {
    const date = new Date(Number(label));
    const timeStr = date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    
    return (
      <Paper elevation={3} sx={{ p: 1.5, bgcolor: "rgba(255, 255, 255, 0.95)", direction: "rtl" }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
          {timeStr}
        </Typography>
        {payload.map((entry: TooltipEntry, index: number) => (
          <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: entry.color }} />
            <Typography variant="body2" sx={{ color: "text.primary" }}>
              {entry.name}: {Number(entry.value).toFixed(2)} שעות
            </Typography>
          </Box>
        ))}
      </Paper>
    );
  }
  return null;
};

export default function TimeSeriesChart({ data, loading }: TimeSeriesChartProps) {
  const theme = useTheme();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  if (loading) {
    return (
      <DashboardCard title="מגמת זמני תור ועיבוד">
        <Box sx={{ p: 2, flex: 1, height: 320 }}>
          <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        </Box>
      </DashboardCard>
    );
  }

  if (data.length === 0) {
    return (
      <DashboardCard title="מגמת זמני תור ועיבוד">
        <Box sx={{ p: 2, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", direction: "rtl" }}>
            אין נתונים לתצוגה
          </Typography>
        </Box>
      </DashboardCard>
    );
  }

  // Transform data for Recharts
  const chartData = data.map((point) => ({
    timestamp: new Date(point.timestamp).getTime(), // Use timestamp number for X-axis logic
    queueHours: (point.queueTimeMinutes ?? 0) / 60,
    processingHours: (point.processingTimeMinutes ?? 0) / 60,
  }));

  // Custom X-Axis Tick Formatter
  const formatXAxis = (tickItem: number) => {
    const date = new Date(tickItem);
    return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  };

  // Render content component (used both in card and dialog)
  const renderContent = (isDialog = false) => (
    <Box 
      onClick={!isDialog ? handleOpenDialog : undefined}
      sx={{ 
        width: "100%", 
        height: isDialog ? 500 : 320,
        direction: "ltr",
        p: 0,
        pb: 1,
        cursor: isDialog ? "default" : "pointer",
        "& .recharts-wrapper": {
          fontFamily: theme.typography.fontFamily,
        }
      }}
    >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#e0e0e0" />
            <XAxis 
              dataKey="timestamp" 
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatXAxis}
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickMargin={10}
              interval="preserveStartEnd"
            />
            <YAxis 
              tickFormatter={(value) => value.toFixed(1)}
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              width={40}
              label={{ 
                value: 'שעות', 
                angle: -90, 
                position: 'insideLeft', 
                style: { textAnchor: 'middle', fill: theme.palette.text.secondary, fontSize: 12 } 
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              verticalAlign="top" 
              align="right" 
              height={36}
              wrapperStyle={{ paddingRight: 20 }}
            />
            <Line
              name="זמן תור"
              type="monotone"
              dataKey="queueHours"
              stroke="#1976d2"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              isAnimationActive={true}
            />
            <Line
              name="זמן עיבוד"
              type="monotone"
              dataKey="processingHours"
              stroke="#2e7d32"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              isAnimationActive={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
  );

  return (
    <>
      <DashboardCard title="מגמת זמני תור ועיבוד">
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
          מגמת זמני תור ועיבוד
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
    </>
  );
}
