"use client";
import * as React from "react";
import { Paper, Typography, Box, Skeleton, useTheme, Dialog, DialogContent, DialogTitle, IconButton, alpha } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
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
import { DailyTrendPoint } from "@/types/dashboard";
import DashboardCard from "@/app/components/dashboard/DashboardCard";

interface DailyTrendsChartProps {
  data: DailyTrendPoint[];
  loading: boolean;
}

// Custom Tooltip Component
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <Paper elevation={3} sx={{ p: 1.5, bgcolor: "rgba(255, 255, 255, 0.95)", direction: "rtl" }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
          {label}
        </Typography>
        {payload.map((entry: TooltipEntry, index: number) => (
          <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: entry.color }} />
            <Typography variant="body2" sx={{ color: "text.primary" }}>
              {entry.name}: {Number(entry.value).toLocaleString('he-IL')}
            </Typography>
          </Box>
        ))}
      </Paper>
    );
  }
  return null;
};

export default function DailyTrendsChart({ data, loading }: DailyTrendsChartProps) {
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
      <DashboardCard title="מגמות יומיות">
        <Box sx={{ p: 2, flex: 1, height: 400 }}>
          <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        </Box>
      </DashboardCard>
    );
  }

  if (data.length === 0) {
    return (
      <DashboardCard title="מגמות יומיות">
        <Box sx={{ p: 2, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", direction: "rtl" }}>
            אין נתונים לתצוגה
          </Typography>
        </Box>
      </DashboardCard>
    );
  }

  // Transform data for Recharts
  // Detect if data is monthly/quarterly by checking date pattern
  // Use 'every' because 'some' will return true for daily data if it includes the 1st of the month
  const isMonthlyOrQuarterly = data.length > 0 && data.every(p => {
    const date = new Date(p.date);
    return date.getDate() === 1; // First day of month/quarter
  });
  
  const chartData = data.map((point) => {
    const date = new Date(point.date);
    let dateLabel: string;
    
    // Show "היום" (Today) for the live data point
    if (point.isToday) {
      dateLabel = "היום";
    } else if (isMonthlyOrQuarterly) {
      // Check if it's quarterly (Q1, Q2, Q3, Q4)
      const month = date.getMonth();
      if (month === 0 || month === 3 || month === 6 || month === 9) {
        // Quarterly - show quarter and year
        const quarter = Math.floor(month / 3) + 1;
        dateLabel = `Q${quarter} ${date.getFullYear()}`;
      } else {
        // Monthly - show month and year
        dateLabel = date.toLocaleDateString("he-IL", { month: "short", year: "numeric" });
      }
    } else {
      // Daily - show day and month
      dateLabel = date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
    }
    
    return {
      date: dateLabel,
      fullDate: point.date,
      itemsStarted: point.itemsStarted,
      itemsFinished: point.itemsFinished,
      itemsInQueue: point.itemsInQueue,
      itemsInTest: point.itemsInTest,
      itemsWaitingForResearch: point.itemsWaitingForResearch,
      itemsInResearch: point.itemsInResearch,
    };
  });

  // Render content component (used both in card and dialog)
  const renderContent = (isDialog = false) => (
      <Box 
      onClick={!isDialog ? handleOpenDialog : undefined}
      sx={{ 
        width: "100%", 
        height: isDialog ? 500 : 400,
        direction: "ltr",
        p: 2,
        pt: 1,
        cursor: isDialog ? "default" : "pointer",
        "& .recharts-wrapper": {
          fontFamily: theme.typography.fontFamily,
        },
        "& .recharts-legend-wrapper": {
           direction: "rtl",
           textAlign: "right"
        }
      }}
    >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 20, right: 10, left: 10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickMargin={10}
              interval="preserveStartEnd"
              stroke="#e0e0e0"
              padding={{ left: 10, right: 10 }}
            />
            <YAxis 
              width={40}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: theme.palette.text.secondary, fontWeight: 600 }}
              stroke={theme.palette.text.secondary}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: theme.palette.divider, strokeWidth: 1, strokeDasharray: "4 4" }} />
            <Legend 
              verticalAlign="top" 
              align="right" 
              height={40}
              iconType="circle"
              wrapperStyle={{ right: 0, top: 0, paddingBottom: 10 }}
            />
            <Line
              name="בבדיקה"
              type="monotone"
              dataKey="itemsInTest"
              stroke="#1976d2" // Blue
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
            <Line
              name="הושלמו"
              type="monotone"
              dataKey="itemsFinished"
              stroke="#2e7d32" // Green
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
            <Line
              name="ממתינים"
              type="monotone"
              dataKey="itemsInQueue"
              stroke="#ed6c02" // Orange
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
            <Line
              name="ממתין למחקר"
              type="monotone"
              dataKey="itemsWaitingForResearch"
              stroke="#9c27b0" // Purple
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
            <Line
              name="במחקר"
              type="monotone"
              dataKey="itemsInResearch"
              stroke="#d32f2f" // Red
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
  );

  return (
    <>
      <DashboardCard title="מגמות יומיות">
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
          מגמות יומיות
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

