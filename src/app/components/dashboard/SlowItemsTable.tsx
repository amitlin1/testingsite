"use client";
import * as React from "react";
import { Box, Skeleton, Dialog, DialogContent, DialogTitle, IconButton, Paper } from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { SlowItemRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import DataTable, { type Column as DTColumn } from "@/components/DataTable";

interface SlowItemsTableProps {
  data: SlowItemRow[];
  loading: boolean;
}

export default function SlowItemsTable({ data, loading }: SlowItemsTableProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return "-";
    return formatDuration(minutes * 60 * 1000, "short");
  };

  const columns: DTColumn<SlowItemRow>[] = [
    {
      key: "item", header: "פריט", nowrap: true,
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>#{r.itemId}</div>
          <div style={{ fontSize: 12, color: "#7a7a7a" }}>מס׳ סידורי: {r.serialNo} · מק״ט: {r.makat}</div>
          {r.model && <div style={{ fontSize: 12, color: "#7a7a7a" }}>דגם: {r.model}</div>}
        </div>
      ),
    },
    { key: "station", header: "עמדה", nowrap: true, cell: (r) => r.stationName || "-" },
    { key: "step", header: "שלב", muted: true, nowrap: true, cell: (r) => `שלב ${r.routeStep}` },
    { key: "queue", header: "זמן תור", nowrap: true, cell: (r) => formatMinutes(r.queueTimeMinutes) },
    { key: "proc", header: "זמן עיבוד", nowrap: true, cell: (r) => formatMinutes(r.processingTimeMinutes) },
    { key: "total", header: "סה\"כ זמן", nowrap: true, bold: true, nums: true, cell: (r) => formatMinutes(r.totalTimeMinutes) },
    { key: "worker", header: "עובד", muted: true, nowrap: true, cell: (r) => (r.workerId ? `עובד #${r.workerId}` : "-") },
  ];

  const renderTable = (isDialog: boolean) => (
    <div onClick={!isDialog ? () => setDialogOpen(true) : undefined} style={{ cursor: isDialog ? "default" : "pointer", height: "100%" }}>
      <DataTable
        columns={columns}
        rows={data}
        getRowKey={(r, i) => `${r.itemId}-${i}`}
        minWidth={800}
        maxHeight="100%"
        plain
        empty={<div style={{ fontSize: 15 }}>אין נתונים</div>}
      />
    </div>
  );

  if (loading) {
    return (
      <DashboardCard title="פריטים איטיים / בעייתיים">
        <Box sx={{ p: 2, flex: 1, height: "100%" }}>
          <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2, ml: "auto" }} />
          <Skeleton variant="rectangular" height="100%" />
        </Box>
      </DashboardCard>
    );
  }

  return (
    <>
      <Paper elevation={0} sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "transparent" }}>
        {renderTable(false)}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth
        PaperProps={{ sx: { maxHeight: "90vh", height: "90vh", display: "flex", flexDirection: "column" } }}>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          פריטים איטיים / בעייתיים
          <IconButton onClick={() => setDialogOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 2, minHeight: 0 }}>
          {renderTable(true)}
        </DialogContent>
      </Dialog>
    </>
  );
}
