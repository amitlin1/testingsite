"use client";
import * as React from "react";
import { Typography, Box, Skeleton, Dialog, DialogContent, DialogTitle, IconButton, Paper } from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { CustomerPerformanceRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import CustomerHistoryDialog from "./CustomerHistoryDialog";
import DataTable, { ProgressCell, type Column as DTColumn } from "@/components/DataTable";

interface CustomerPerformanceTableProps {
  data: CustomerPerformanceRow[];
  loading: boolean;
}

/** Count cell — bold ink when non-zero, muted when zero (Shifthouse: no colour coding). */
function Count({ n }: { n: number }) {
  return <span style={{ fontWeight: n > 0 ? 600 : 400, color: n > 0 ? "#1d1d1f" : "#9a9aa0", fontVariantNumeric: "tabular-nums" }}>{n}</span>;
}

export default function CustomerPerformanceTable({ data, loading }: CustomerPerformanceTableProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerPerformanceRow | null>(null);

  const handleCloseDialog = () => setDialogOpen(false);

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return "-";
    return formatDuration(minutes * 60 * 1000, "short");
  };

  const columns: DTColumn<CustomerPerformanceRow>[] = [
    {
      key: "customer", header: "לקוח", nowrap: true,
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.customerCode}</div>
          <div style={{ fontSize: 12, color: "#7a7a7a" }}>{r.customerName}</div>
        </div>
      ),
    },
    { key: "total", header: "סה\"כ פריטים", nums: true, cell: (r) => <Count n={r.totalItems} /> },
    { key: "queue", header: "ממתינים", nums: true, cell: (r) => <Count n={r.itemsInQueue} /> },
    { key: "test", header: "בבדיקה", nums: true, cell: (r) => <Count n={r.itemsInTest} /> },
    { key: "waitRes", header: "ממתין למחקר", nums: true, cell: (r) => <Count n={r.itemsWaitingForResearch} /> },
    { key: "research", header: "במחקר", nums: true, cell: (r) => <Count n={r.itemsInResearch} /> },
    { key: "finished", header: "הושלמו", nums: true, cell: (r) => <Count n={r.finishedItems} /> },
    { key: "success", header: "אחוז הצלחה", width: 160, cell: (r) => <ProgressCell pct={r.successPercentage} text={`${r.successPercentage}%`} /> },
    { key: "routes", header: "פריטים במסלול", width: 180, cell: (r) => <ProgressCell pct={r.itemsInRoutesPercentage} text={`${r.itemsInRoutesPercentage}% (${r.itemsInRoutes})`} /> },
    { key: "avg", header: "זמן ממוצע", nowrap: true, muted: true, cell: (r) => formatMinutes(r.averageTimeMinutes) },
  ];

  const renderTable = () => (
    <DataTable
      columns={columns}
      rows={data}
      getRowKey={(r) => r.customerId}
      onRowClick={(r) => { setSelectedCustomer(r); setHistoryOpen(true); }}
      minWidth={1100}
      maxHeight="100%"
      plain
      empty={<div style={{ fontSize: 15 }}>אין נתונים</div>}
    />
  );

  if (loading) {
    return (
      <DashboardCard title="ביצועים לפי לקוח">
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
        {renderTable()}
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="lg" fullWidth
        PaperProps={{ sx: { maxHeight: "90vh", height: "90vh", display: "flex", flexDirection: "column" } }}>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          ביצועים לפי לקוח
          <IconButton onClick={handleCloseDialog}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 2, minHeight: 0 }}>
          {renderTable()}
        </DialogContent>
      </Dialog>

      <CustomerHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} customer={selectedCustomer} />
    </>
  );
}
