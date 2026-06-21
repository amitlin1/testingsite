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
  LinearProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { CustomerPerformanceRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import CustomerHistoryDialog from "./CustomerHistoryDialog";

interface CustomerPerformanceTableProps {
  data: CustomerPerformanceRow[];
  loading: boolean;
}

export default function CustomerPerformanceTable({ data, loading }: CustomerPerformanceTableProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerPerformanceRow | null>(null);

  const handleRowClick = (customer: CustomerPerformanceRow) => {
    setSelectedCustomer(customer);
    setHistoryOpen(true);
  };

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) {
      return "-";
    }
    return formatDuration(minutes * 60 * 1000, "short");
  };

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

  // Render content component (used both in card and dialog)
  const renderContent = (isDialog = false) => (
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
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>לקוח</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>סה&quot;כ פריטים</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתינים</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>בבדיקה</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>ממתין למחקר</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>במחקר</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>הושלמו</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>אחוז הצלחה</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>פריטים במסלול</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl", bgcolor: "#f5f5f5" }}>זמן ממוצע</TableCell>
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
                  key={row.customerId} 
                  hover
                  onClick={(e) => { e.stopPropagation(); handleRowClick(row); }}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Box sx={{ direction: "rtl", textAlign: "right" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                        {row.customerCode}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right", display: "block" }}>
                        {row.customerName}
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
                      label={row.finishedItems}
                      size="small"
                      sx={{
                        bgcolor: row.finishedItems > 0 ? alpha("#2e7d32", 0.1) : alpha("#9e9e9e", 0.1),
                        color: row.finishedItems > 0 ? "#2e7d32" : "#9e9e9e",
                        fontWeight: 600,
                        minWidth: 32,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl", minWidth: 120 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexDirection: "row-reverse" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 40, textAlign: "left" }}>
                        {row.successPercentage}%
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={row.successPercentage}
                        sx={{
                          flex: 1,
                          height: 8,
                          borderRadius: 1,
                          bgcolor: alpha("#e0e0e0", 0.3),
                          "& .MuiLinearProgress-bar": {
                            bgcolor: row.successPercentage >= 80 ? "#2e7d32" : row.successPercentage >= 50 ? "#1976d2" : "#ff9800",
                          },
                        }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl", minWidth: 140 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexDirection: "row-reverse" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 50, textAlign: "left" }}>
                        {row.itemsInRoutesPercentage}% ({row.itemsInRoutes})
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={row.itemsInRoutesPercentage}
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
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ textAlign: "right" }}>
                      {formatMinutes(row.averageTimeMinutes)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
  );

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
          ביצועים לפי לקוח
          <IconButton
            onClick={handleCloseDialog}
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
          {renderContent(true)}
        </DialogContent>
      </Dialog>

      <CustomerHistoryDialog 
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        customer={selectedCustomer}
      />
    </>
  );
}

