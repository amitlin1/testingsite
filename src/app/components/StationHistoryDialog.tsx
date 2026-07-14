"use client";
import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  CircularProgress,
  Chip,
  Stack,
  alpha,
} from "@/components/ui";
import { formatDateTime, formatTime } from "@/app/lib/datetime";
import { History as HistoryIcon } from "@/components/ui/icons";

type StationHistoryEntry = {
  logId: number;
  itemId: number;
  currentRouteStep: number;
  testStationId: number;
  queueStartTime: string | null;
  processingStartTime: string | null;
  processingEndTime: string | null;
  workerId: number | null;
  serialNo: number;
  makat: number;
  model: string;
  manufacturerName: string;
  manufacturerNo: number;
  itemTypeDesc: string | null;
};

type StationHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  stationId: number | null;
  stationName: string | null;
};

/**
 * Calculate duration between two timestamps in HH:MM:SS format
 */
function calculateDuration(
  startTime: string | null,
  endTime: string | null
): string {
  if (!startTime || !endTime) {
    return "-";
  }

  try {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    if (isNaN(start) || isNaN(end) || end < start) {
      return "-";
    }

    const diffSeconds = Math.floor((end - start) / 1000);
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } catch (error) {
    return "-";
  }
}

export default function StationHistoryDialog({
  open,
  onClose,
  stationId,
  stationName,
}: StationHistoryDialogProps) {
  const [history, setHistory] = React.useState<StationHistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch history when dialog opens and stationId is available
  React.useEffect(() => {
    if (!open || !stationId) {
      setHistory([]);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/testing/station-history?stationId=${stationId}`);
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to load history");
        }
        const data = await res.json();
        if (!cancelled) {
          setHistory(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "שגיאה בטעינת ההיסטוריה");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, stationId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      sx={{ direction: "rtl", "& .MuiDialog-paper": { width: "100%", maxWidth: { xs: "95%", sm: "90%", md: "900px" }, margin: { xs: 1 } } }}
    >
      <DialogTitle sx={{ direction: "rtl", textAlign: "right" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexDirection: "row-reverse" }}>
          <HistoryIcon sx={{ color: "primary.main" }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            היסטוריית בדיקות
            {stationName && ` - ${stationName}`}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ direction: "rtl", p: 0 }}>
        {loading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              py: 4,
            }}
          >
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box
            sx={{
              textAlign: "center",
              py: 4,
              px: 2,
            }}
          >
            <Typography color="error" sx={{ fontWeight: 500 }}>
              {error}
            </Typography>
          </Box>
        ) : history.length === 0 ? (
          <Box
            sx={{
              textAlign: "center",
              py: 4,
              px: 2,
            }}
          >
            <HistoryIcon
              sx={{ fontSize: 48, color: alpha("#455A64", 0.3), mb: 1.5 }}
            />
            <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 500 }}>
              לא נמצאו בדיקות קודמות לעמדה זו
            </Typography>
          </Box>
        ) : (
          <TableContainer
            component={Paper}
            sx={{
              width: "100%",
              maxWidth: "100%",
              maxHeight: "60vh",
              borderRadius: 0,
              boxShadow: "none",
              overflowX: "auto",
            }}
          >
            <Table stickyHeader size="small" sx={{ width: "100%", minWidth: 800 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    פריט
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    שלב
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    התחלת תור
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    התחלת עיבוד
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    סיום עיבוד
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    משך זמן
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: "right", direction: "rtl" }}>
                    עובד
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((entry) => {
                  const duration = calculateDuration(
                    entry.processingStartTime,
                    entry.processingEndTime
                  );
                  return (
                    <TableRow key={entry.logId} hover>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Stack spacing={0.5} sx={{ direction: "rtl" }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            #{entry.itemId}
                          </Typography>
                          <Chip
                            label={`מס' סידורי: ${entry.serialNo}`}
                            size="small"
                            sx={{
                              bgcolor: alpha("#455A64", 0.1),
                              color: "#455A64",
                              fontSize: "0.7rem",
                              height: 20,
                            }}
                          />
                          <Chip
                            label={`מקט: ${entry.makat}`}
                            size="small"
                            sx={{
                              bgcolor: alpha("#455A64", 0.1),
                              color: "#455A64",
                              fontSize: "0.7rem",
                              height: 20,
                            }}
                          />
                          {entry.itemTypeDesc && (
                            <Chip
                              label={`סוג: ${entry.itemTypeDesc}`}
                              size="small"
                              variant="outlined"
                              sx={{
                                borderColor: alpha("#455A64", 0.3),
                                color: "#455A64",
                                fontSize: "0.7rem",
                                height: 20,
                              }}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Chip
                          label={`שלב ${entry.currentRouteStep}`}
                          size="small"
                          sx={{
                            bgcolor: alpha("#1976d2", 0.1),
                            color: "#1976d2",
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Typography variant="body2">
                          {formatDateTime(entry.queueStartTime)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Typography variant="body2">
                          {formatDateTime(entry.processingStartTime)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Typography variant="body2">
                          {formatDateTime(entry.processingEndTime)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        <Chip
                          label={duration}
                          size="small"
                          sx={{
                            bgcolor: alpha("#455A64", 0.1),
                            color: "#455A64",
                            fontWeight: 600,
                            fontFamily: "monospace",
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", direction: "rtl" }}>
                        {entry.workerId ? (
                          <Chip
                            label={`עובד #${entry.workerId}`}
                            size="small"
                            sx={{
                              bgcolor: alpha("#455A64", 0.15),
                              color: "#455A64",
                              fontWeight: 600,
                            }}
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions sx={{ direction: "rtl", px: 2, py: 1.5 }}>
        <Button onClick={onClose} variant="contained">
          סגור
        </Button>
      </DialogActions>
    </Dialog>
  );
}

