"use client";
import * as React from "react";
import {
  Paper,
  Typography,
  Box,
  Skeleton,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
  alpha,
  Autocomplete,
  TextField,
  Stack,
} from "@/components/ui";
import { Fullscreen as FullscreenIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { AccessTime as AccessTimeIcon } from "@/components/ui/icons";
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
import { AverageTimesPoint, AverageTimesPeriod } from "@/types/dashboard";

interface AverageTimesChartProps {
  data: AverageTimesPoint[];
  loading: boolean;
  period: AverageTimesPeriod;
  onPeriodChange: (period: AverageTimesPeriod) => void;
}

const PERIOD_OPTIONS: { id: AverageTimesPeriod; label: string }[] = [
  { id: "daily", label: "יומי" },
  { id: "monthly", label: "חודשי" },
  { id: "quarterly", label: "רבעוני" },
];

// Format minutes to a readable string
function formatMinutes(minutes: number | null): string {
  if (minutes === null || isNaN(minutes)) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)} שניות`;
  if (minutes < 60) return `${minutes.toFixed(1)} דקות`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours} שעות ${mins > 0 ? `${mins} דקות` : ""}`.trim();
}

// Custom tooltip component
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <Paper
      elevation={3}
      sx={{
        p: 1.5,
        direction: "rtl",
        bgcolor: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(10px)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {label}
      </Typography>
      {payload.map((entry: any, index: number) => (
        <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: entry.color,
            }}
          />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {entry.name}: {formatMinutes(entry.value)}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}

export default function AverageTimesChart({
  data,
  loading,
  period,
  onPeriodChange,
}: AverageTimesChartProps) {
  const [fullSize, setFullSize] = React.useState(false);

  // Format date label based on period
  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (period === "daily") {
      return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
    } else if (period === "monthly") {
      return date.toLocaleDateString("he-IL", { month: "short", year: "2-digit" });
    } else {
      const quarter = Math.ceil((date.getMonth() + 1) / 3);
      return `Q${quarter} ${date.getFullYear().toString().slice(-2)}`;
    }
  };

  // Process data for chart display
  const chartData = data.map((point) => ({
    ...point,
    dateLabel: formatDateLabel(point.date),
    avgWaitingMinutes: point.avgWaitingMinutes ?? 0,
    avgProcessingMinutes: point.avgProcessingMinutes ?? 0,
  }));

  const selectedPeriodOption = PERIOD_OPTIONS.find((opt) => opt.id === period) || PERIOD_OPTIONS[0];

  const renderChart = (height: number | string) => (
    <ResponsiveContainer width="100%" height={height as any}>
      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 11, fill: "#666" }}
          tickLine={false}
          axisLine={{ stroke: "#e0e0e0" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#666" }}
          tickLine={false}
          axisLine={{ stroke: "#e0e0e0" }}
          tickFormatter={(value) => `${value.toFixed(0)}ד'`}
          label={{
            value: "דקות",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle", fill: "#666", fontSize: 12 },
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ direction: "rtl", paddingTop: 10 }}
          formatter={(value) => <span style={{ color: "#333", fontSize: 12 }}>{value}</span>}
        />
        <Line
          type="monotone"
          dataKey="avgWaitingMinutes"
          name="זמן המתנה"
          stroke="#ff9800"
          strokeWidth={2}
          dot={{ fill: "#ff9800", strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="avgProcessingMinutes"
          name="זמן טיפול"
          stroke="#2196f3"
          strokeWidth={2}
          dot={{ fill: "#2196f3", strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <Paper
        elevation={1}
        sx={{
          p: 2,
          height: "100%",
          minHeight: 300,
          borderRadius: 2,
          bgcolor: "white",
          direction: "rtl",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}


        {/* Chart */}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <Skeleton variant="rectangular" height="100%" sx={{ borderRadius: 2 }} />
          ) : data.length === 0 ? (
            <Box
              sx={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: alpha("#000", 0.02),
                borderRadius: 2,
              }}
            >
              <Typography color="text.secondary">אין נתונים להצגה</Typography>
            </Box>
          ) : (
            renderChart("100%")
          )}
        </Box>
      </Paper>

      {/* Full size dialog */}
      <Dialog
        open={fullSize}
        onClose={() => setFullSize(false)}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            direction: "rtl",
          },
        }}
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AccessTimeIcon sx={{ color: "primary.main" }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              זמני המתנה וטיפול ממוצעים
            </Typography>
          </Stack>
          <IconButton onClick={() => setFullSize(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {loading ? (
            <Skeleton variant="rectangular" height={500} sx={{ borderRadius: 2 }} />
          ) : (
            renderChart(500)
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
