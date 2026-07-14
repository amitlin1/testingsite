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
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
} from "@mui/material";
import { Close as CloseIcon } from "@/components/ui/icons";
import { SlowItemRow } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";

interface SlowItemsTableProps {
  data: SlowItemRow[];
  loading: boolean;
}

export default function SlowItemsTable({ data, loading }: SlowItemsTableProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

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

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) {
      return "-";
    }
    return formatDuration(minutes * 60 * 1000, "short");
  };

  // Render content component (used both in card and dialog)
  const renderContent = (isDialog = false) => (
    <TableContainer 
      onClick={!isDialog ? handleOpenDialog : undefined}
      sx={{ 
        width: "100%", 
        maxWidth: "100%", 
        maxHeight: isDialog ? "none" : "100%", 
        height: "100%",
        overflowX: "auto", 
        overflowY: "auto", 
        direction: "rtl",
        cursor: isDialog ? "default" : "pointer",
      }}
    >
        <Table stickyHeader size="small" sx={{ width: "100%", minWidth: 800, direction: "rtl" }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha("#455A64", 0.05) }}>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>פריט</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>עמדה</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>שלב</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>זמן תור</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>זמן עיבוד</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>סה&quot;כ זמן</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>עובד</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: "center", py: 4, direction: "rtl" }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                    אין נתונים
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, index) => (
                <TableRow key={`${row.itemId}-${index}`} hover>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Box sx={{ direction: "rtl", textAlign: "right" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
                        #{row.itemId}
                      </Typography>
                      <Chip
                        label={`מס' סידורי: ${row.serialNo}`}
                        size="small"
                        sx={{
                          bgcolor: alpha("#455A64", 0.1),
                          color: "#455A64",
                          fontSize: "0.7rem",
                          height: 20,
                          mt: 0.5,
                          direction: "rtl",
                        }}
                      />
                      <Chip
                        label={`מקט: ${row.makat}`}
                        size="small"
                        sx={{
                          bgcolor: alpha("#455A64", 0.1),
                          color: "#455A64",
                          fontSize: "0.7rem",
                          height: 20,
                          mt: 0.5,
                          ml: 0.5,
                          direction: "rtl",
                        }}
                      />
                      {row.model && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, textAlign: "right" }}>
                          דגם: {row.model}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ textAlign: "right" }}>{row.stationName || "-"}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Chip
                      label={`שלב ${row.routeStep}`}
                      size="small"
                      sx={{
                        bgcolor: alpha("#1976d2", 0.1),
                        color: "#1976d2",
                        fontWeight: 600,
                        direction: "rtl",
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ textAlign: "right" }}>{formatMinutes(row.queueTimeMinutes)}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Typography variant="body2" sx={{ textAlign: "right" }}>{formatMinutes(row.processingTimeMinutes)}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    <Chip
                      label={formatMinutes(row.totalTimeMinutes)}
                      size="small"
                      sx={{
                        bgcolor: alpha("#E53935", 0.1),
                        color: "#E53935",
                        fontWeight: 700,
                        fontFamily: "monospace",
                        direction: "rtl",
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                    {row.workerId ? (
                      <Chip
                        label={`עובד #${row.workerId}`}
                        size="small"
                        sx={{
                          bgcolor: alpha("#455A64", 0.15),
                          color: "#455A64",
                          fontWeight: 600,
                          direction: "rtl",
                          height: 20,
                          fontSize: "0.7rem",
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "right" }}>
                        -
                      </Typography>
                    )}
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
          פריטים איטיים / בעייתיים
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
    </>
  );
}
