"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { aggregateStationHistoryWeekly } from "@/app/lib/metrics/history-fold";
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
import { StationLoadRow } from "@/types/dashboard";

interface StationHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  station: StationLoadRow | null;
}

/** The weekly fold, one definition for all four dialogs:
 *  src/app/lib/metrics/history-fold.ts. The station variant folds three kinds of
 *  column three ways — the point-in-time counts are averaged, `totalProcessed`
 *  is summed, and the four §2.8 duration columns are sample-weighted averages
 *  over the days that HAVE a measurement, staying null for a week in which
 *  nothing closed (§5.0(7)). Module scope keeps the reference stable so memoised
 *  callbacks can depend on it safely. */
const aggregateToWeekly = (dailyData: any[]) => aggregateStationHistoryWeekly(dailyData);

/** §5.4: "the queue belongs to the TYPE, not the station". A waiting item
 *  carries no station_id at all (§3.6 enforces it), so a line called "this
 *  station's queue" could only ever have been zero. The items counted here are
 *  waiting for this station's TYPE and are shared with every station of it —
 *  the name has to say so. */
const QUEUE_LABEL = "בתור לסוג התחנה";

/** Minutes get a unit and one decimal; counts stay whole. A duration with no
 *  measurement renders as "אין מדידה", never as 0. */
const formatMetric = (value: any, name: any): [string, string] => {
  const isDuration = typeof name === "string" && name.startsWith("זמן");
  if (value === null || value === undefined) return [isDuration ? "אין מדידה" : "-", name];
  return [isDuration ? `${Number(value).toFixed(1)} דק'` : String(value), name];
};

export default function StationHistoryDialog({
  open,
  onClose,
  station,
}: StationHistoryDialogProps) {
  const theme = useTheme();
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const [period, setPeriod] = React.useState<"alldays" | "12months" | "3years">("alldays");
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  const fetchHistory = React.useCallback(async () => {
    if (!station) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/dashboard/stations/${station.stationId}/history?period=${period}`);
      if (res.ok) {
        const result = await res.json();
        
        // NO ZERO-DAY FILTER. It used to drop every day on which the station
        // stood idle, and recharts then drew a straight segment from the day
        // before to the day after — a quiet carry-forward across a stretch of
        // real, measured zeros (§5.0(7)). An idle day is information about a
        // station, and it is drawn as one.
        const filteredResult: any[] = result;
        
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
  }, [station, period]);

  React.useEffect(() => {
    if (open && station) {
      fetchHistory();
    }
  }, [open, station, fetchHistory]);

  const handleChartTypeChange = (
    event: React.MouseEvent<HTMLElement>,
    newChartType: "line" | "bar" | null
  ) => {
    if (newChartType !== null) {
      setChartType(newChartType);
    }
  };

  if (!station) return null;

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
            <Typography variant="h6">היסטוריית עמדה: {station.stationName}</Typography>
            {station.stationTypeName && (
              <Typography variant="caption" color="text.secondary">{station.stationTypeName}</Typography>
            )}
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
            <Typography color="text.secondary">אין נתונים היסטוריים לעמדה זו</Typography>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "line" ? (
                <LineChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                  {/* Counts left, minutes right. One axis for both would make a
                      36-minute average dwarf every count on the chart. */}
                  <YAxis yAxisId="count" tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                  <YAxis yAxisId="minutes" orientation="right" unit=" ד'" tick={{ fontSize: 12, fill: '#666' }} />
                  <Tooltip formatter={formatMetric} />
                  <Legend />
                  <Line yAxisId="count" type="monotone" dataKey="_new_sharedTypeQueue" name={QUEUE_LABEL} stroke="#ff9800" strokeWidth={2} />
                  <Line yAxisId="count" type="monotone" dataKey="itemsInTest" name="בבדיקה" stroke="#1976d2" strokeWidth={2} />
                  <Line yAxisId="count" type="monotone" dataKey="_new_inResearch" name="במחקר" stroke="#673ab7" strokeWidth={2} />
                  <Line yAxisId="count" type="monotone" dataKey="totalProcessed" name="טופלו" stroke="#2e7d32" strokeWidth={2} />
                  {/* §3.1 — a status with no metric_state row. Its own slice. */}
                  <Line yAxisId="count" type="monotone" dataKey="_new_unmapped" name="סטטוס לא ידוע" stroke="#607d8b" strokeWidth={2} strokeDasharray="4 2" />
                  {/* §2.8 — TWO CLOCKS, never one. `wall` is what happened to the
                      customer; `work` is the part the lab controls, counted only
                      inside the hours on the work-calendar screen. They diverge by
                      ~4x here and that divergence is the signal. connectNulls is
                      deliberately OFF: a day on which nothing closed carries null,
                      and it must read as a gap, not as a line drawn through it. */}
                  <Line yAxisId="minutes" type="monotone" dataKey="_new_waitWallMin" name="זמן המתנה" stroke="#e65100" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line yAxisId="minutes" type="monotone" dataKey="_new_waitWorkMin" name="זמן המתנה בפועל" stroke="#e65100" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />
                  <Line yAxisId="minutes" type="monotone" dataKey="_new_handleWallMin" name="זמן טיפול" stroke="#00695c" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line yAxisId="minutes" type="monotone" dataKey="_new_handleWorkMin" name="זמן טיפול בפועל" stroke="#00695c" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />
                </LineChart>
              ) : (
                <BarChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                  <YAxis yAxisId="count" tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                  <YAxis yAxisId="minutes" orientation="right" unit=" ד'" tick={{ fontSize: 12, fill: '#666' }} />
                  <Tooltip formatter={formatMetric} />
                  <Legend />
                  <Bar yAxisId="count" dataKey="_new_sharedTypeQueue" name={QUEUE_LABEL} fill="#ff9800" />
                  <Bar yAxisId="count" dataKey="itemsInTest" name="בבדיקה" fill="#1976d2" />
                  <Bar yAxisId="count" dataKey="_new_inResearch" name="במחקר" fill="#673ab7" />
                  <Bar yAxisId="count" dataKey="totalProcessed" name="טופלו" fill="#2e7d32" />
                  <Bar yAxisId="count" dataKey="_new_unmapped" name="סטטוס לא ידוע" fill="#607d8b" />
                  {/* Both clocks again — §2.8 admits no chart type where only one
                      of the pair is shown. */}
                  <Bar yAxisId="minutes" dataKey="_new_waitWallMin" name="זמן המתנה" fill="#e65100" />
                  <Bar yAxisId="minutes" dataKey="_new_waitWorkMin" name="זמן המתנה בפועל" fill="#ffb74d" />
                  <Bar yAxisId="minutes" dataKey="_new_handleWallMin" name="זמן טיפול" fill="#00695c" />
                  <Bar yAxisId="minutes" dataKey="_new_handleWorkMin" name="זמן טיפול בפועל" fill="#80cbc4" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
