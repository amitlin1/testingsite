"use client";
import * as React from "react";
import { Typography, Box, Skeleton, useTheme, Paper } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { StationLoadRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import StationHistoryDialog from "./StationHistoryDialog";
import DataTable, { type Column as DTColumn } from "@/components/DataTable";

interface StationLoadTableProps {
  data: StationLoadRow[];
  loading: boolean;
  viewMode: "table" | "chart";
  onViewModeChange: (mode: "table" | "chart") => void;
}

function Count({ n }: { n: number }) {
  return <span style={{ fontWeight: n > 0 ? 600 : 400, color: n > 0 ? "#1d1d1f" : "#9a9aa0", fontVariantNumeric: "tabular-nums" }}>{n}</span>;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <Box sx={{ bgcolor: "rgba(255,255,255,0.95)", border: "1px solid #e0e0e0", p: 1.5, borderRadius: "var(--r-sm)", direction: "rtl" }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{label}</Typography>
        {payload.map((entry: any, index: number) => (
          <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: entry.color }} />
            <Typography variant="body2">{entry.name}: {entry.value}</Typography>
          </Box>
        ))}
      </Box>
    );
  }
  return null;
};

export default function StationLoadTable({ data, loading, viewMode }: StationLoadTableProps) {
  const theme = useTheme();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedStation, setSelectedStation] = React.useState<StationLoadRow | null>(null);

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return "-";
    return formatDuration(minutes * 60 * 1000, "short");
  };

  const chartWidth = Math.max(data.length * 80, 600);

  const columns: DTColumn<StationLoadRow>[] = [
    {
      key: "station", header: "עמדה", nowrap: true,
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.stationName}</div>
          {r.stationTypeName && <div style={{ fontSize: 12, color: "#7a7a7a" }}>{r.stationTypeName}</div>}
        </div>
      ),
    },
    { key: "queue", header: "בהמתנה", nums: true, cell: (r) => <Count n={r.itemsInQueue} /> },
    { key: "test", header: "בעבודה", nums: true, cell: (r) => <Count n={r.itemsInTest} /> },
    { key: "avgQueue", header: "זמן תור ממוצע", nowrap: true, muted: true, cell: (r) => formatMinutes(r.averageCurrentQueueTimeMinutes) },
    { key: "processed", header: "סה\"כ טופל", nums: true, bold: true, cell: (r) => r.totalProcessedInPeriod },
  ];

  if (loading) {
    return (
      <Paper elevation={0} sx={{ height: "100%", p: 2, bgcolor: "transparent" }}>
        <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
        <Skeleton variant="rectangular" height="100%" />
      </Paper>
    );
  }

  return (
    <Paper elevation={0} sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "transparent" }}>
      {viewMode === "table" ? (
        <DataTable
          columns={columns}
          rows={data}
          getRowKey={(r) => r.stationId}
          onRowClick={(r) => { setSelectedStation(r); setHistoryOpen(true); }}
          minWidth={500}
          maxHeight="100%"
          plain
          empty={<div style={{ fontSize: 15 }}>אין נתונים</div>}
        />
      ) : (
        <Box sx={{ width: "100%", overflowX: "auto", overflowY: "hidden", direction: "ltr" }}>
          <Box sx={{ width: chartWidth, height: "100%", p: 1, minHeight: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                <XAxis dataKey="stationName" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 12, fill: theme.palette.text.secondary as string }} height={60} />
                <YAxis tick={{ fontSize: 12, fill: theme.palette.text.secondary as string }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 5, paddingTop: 0, marginTop: -10 }} />
                <Bar dataKey="itemsInQueue" name="בהמתנה" fill="#8ab4e8" radius={[4, 4, 0, 0]} maxBarSize={50} />
                <Bar dataKey="itemsInTest" name="בעבודה" fill="#0066cc" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}

      <StationHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} station={selectedStation} />
    </Paper>
  );
}
