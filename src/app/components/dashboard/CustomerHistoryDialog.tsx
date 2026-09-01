"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { aggregateEntityHistoryWeekly } from "@/app/lib/metrics/history-fold";
import PeriodCombobox from "../common/PeriodCombobox";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { ShowChart as ShowChartIcon } from "@/components/ui/icons";
import { BarChart as BarChartIcon } from "@/components/ui/icons";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CustomerPerformanceRow } from "@/types/dashboard";

interface CustomerHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerPerformanceRow | null;
}

/** The weekly fold, one definition for all four dialogs:
 *  src/app/lib/metrics/history-fold.ts. It used to be a module-private copy in
 *  each of these files — four copies of the arithmetic that decides what a
 *  manager reads, none of them reachable from a test. Q2א's counts are
 *  averaged, Q2ב's cumulative line is taken at its LAST value (§5.3ב) and the
 *  additive per-day count is summed. Module scope keeps the reference stable so
 *  memoised callbacks can depend on it safely. */
const aggregateToWeekly = (dailyData: any[]) =>
  aggregateEntityHistoryWeekly(dailyData, "finishedItems");

export default function CustomerHistoryDialog({
  open,
  onClose,
  customer,
}: CustomerHistoryDialogProps) {
  const theme = useTheme();
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const [period, setPeriod] = React.useState<"alldays" | "12months" | "3years">("alldays");
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  const fetchHistory = React.useCallback(async () => {
    if (!customer) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/dashboard/customers/${customer.customerId}/history?period=${period}`);
      if (res.ok) {
        const result = await res.json();
        
        // NO ZERO-DAY FILTER. It used to drop every day on which the customer had
        // nothing standing, and recharts then drew a straight segment from the
        // day before to the day after — a quiet carry-forward across a stretch
        // of real, measured zeros (§5.0(7)). The ledger answers every day in the
        // window, so a zero here is a fact and it is drawn as one.
        const filteredResult: any[] = result;
        
        // Aggregate if too many data points
        let processedData = filteredResult;
        if (filteredResult.length > 30) {
          // Check if last point is today (live data)
          const lastPoint = filteredResult[filteredResult.length - 1];
          const hasToday = lastPoint?.isToday;
          
          if (hasToday) {
            // Aggregate everything EXCEPT the last point
            const historicalData = filteredResult.slice(0, -1);
            const aggregatedHistory = aggregateToWeekly(historicalData);
            processedData = [...aggregatedHistory, lastPoint];
          } else {
            processedData = aggregateToWeekly(filteredResult);
          }
        }
        
        const formattedData = processedData.map((item: any) => ({
          ...item,
          displayDate: item.isToday ? "היום" : new Date(item.date).toLocaleDateString("he-IL", {
            day: "2-digit",
            month: "2-digit",
            year: period === "3years" ? "2-digit" : undefined,
          }),
        }));
        setData(formattedData);
      }
    } catch (error) {
      console.error("Failed to fetch history", error);
    } finally {
      setLoading(false);
    }
  }, [customer, period]);

  React.useEffect(() => {
    if (open && customer) {
      fetchHistory();
    }
  }, [open, customer, fetchHistory]);

  const handleChartTypeChange = (
    event: React.MouseEvent<HTMLElement>,
    newChartType: "line" | "bar" | null
  ) => {
    if (newChartType !== null) {
      setChartType(newChartType);
    }
  };

  if (!customer) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: "80vh", display: "flex", flexDirection: "column", direction: "rtl" },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6">היסטוריית לקוח: {customer.customerCode}</Typography>
            <Typography variant="caption" color="text.secondary">{customer.customerName}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <PeriodCombobox
            value={period}
            onChange={setPeriod}
            options={[
              { id: "alldays", name: "כל הימים" },
              { id: "12months", name: "12 חודשים אחרונים" },
              { id: "3years", name: "3 שנים (מוגבל ל-13 חודשים)" },
            ]}
          />
          <ToggleButtonGroup
            value={chartType}
            exclusive
            onChange={handleChartTypeChange}
            size="small"
            sx={{ direction: "ltr" }}
          >
            <ToggleButton value="line">
              <ShowChartIcon />
            </ToggleButton>
            <ToggleButton value="bar">
              <BarChartIcon />
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
            <CircularProgress />
          </Box>
        ) : data.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
            <Typography color="text.secondary">אין נתונים היסטוריים ללקוח זה</Typography>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "line" ? (
                <LineChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                  <YAxis tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="itemsInQueue" name="ממתינים" stroke="#ff9800" strokeWidth={2} />
                  <Line type="monotone" dataKey="itemsInTest" name="בבדיקה" stroke="#1976d2" strokeWidth={2} />
                  <Line type="monotone" dataKey="itemsWaitingForResearch" name="ממתין למחקר" stroke="#9c27b0" strokeWidth={2} />
                  <Line type="monotone" dataKey="itemsInResearch" name="במחקר" stroke="#673ab7" strokeWidth={2} />
                  <Line type="monotone" dataKey="finishedItems" name="הושלמו (מצטבר)" stroke="#2e7d32" strokeWidth={2} />
                  {/* §3.1 — an item whose status has no metric_state row. A slice of
                      its own, so a status added through the settings screen is
                      visible instead of silently uncounted. */}
                  <Line type="monotone" dataKey="_new_unmapped" name="סטטוס לא ידוע" stroke="#607d8b" strokeWidth={2} strokeDasharray="4 2" />
                </LineChart>
              ) : (
                <BarChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                  <YAxis tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="itemsInQueue" name="ממתינים" fill="#ff9800" stackId="a" />
                  <Bar dataKey="itemsInTest" name="בבדיקה" fill="#1976d2" stackId="a" />
                  <Bar dataKey="itemsWaitingForResearch" name="ממתין למחקר" fill="#9c27b0" stackId="a" />
                  <Bar dataKey="itemsInResearch" name="במחקר" fill="#673ab7" stackId="a" />
                  <Bar dataKey="_new_unmapped" name="סטטוס לא ידוע" fill="#607d8b" stackId="a" />
                  {/* Q2ב is cumulative and Q2א is a snapshot; stacking them would
                      add a running total onto a standing population. Its own
                      bar, outside the stack. */}
                  <Bar dataKey="finishedItems" name="הושלמו (מצטבר)" fill="#2e7d32" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
