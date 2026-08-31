"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import PeriodCombobox from "../common/PeriodCombobox";
import {
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
// NO status-names IMPORT. `getStatusName` mapped the legacy ids 1..5 to Hebrew
// and fell back to "סטטוס {id}" for anything else — so `unmapped`, whose wire
// `status` IS the string "unmapped", rendered as "סטטוס unmapped" and matched no
// <Line> at all: the slice §3.1 exists to make visible was the one slice the
// chart could not draw. The endpoint already sends `statusName` from
// metric_state.label_he (§2.1, §5.10) and `_new_stateKey` as a stable series
// key, so both come from the one source of truth now.

/** metric_state.state_key -> colour. A key not listed falls back to the grey
 *  reserved for "we do not know what this is", which is the honest colour for
 *  a state the vocabulary grew after this file was written. */
const STATE_COLORS: Record<string, string> = {
  testing: "#1976d2",
  queued: "#ff9800",
  queued_research: "#9c27b0",
  in_research: "#673ab7",
  done: "#2e7d32",
  unmapped: "#607d8b",
};
const UNKNOWN_STATE_COLOR = "#607d8b";

interface StatusDistributionHistoryChartProps {
  startDate?: string;
  endDate?: string;
  filters?: {
    customerId: number | null;
    shipmentId: number | null;
    itemTypeId: number | null;
    testStationId: number | null;
  };
  type?: "line" | "bar";
  period?: "30days" | "12months" | "3years";
  hideControls?: boolean;
}

/** Pure: collapses daily rows into weekly averages. Module scope keeps it
 *  referentially stable so memoised callbacks can depend on it safely.
 *
 *  It now carries `_new_stateKey`, `statusName` and `_new_series` through the
 *  fold instead of keying on the legacy numeric status: the label belongs to
 *  metric_state and a state with no legacy id (`unmapped`) has no number to key
 *  on at all.
 *
 *  The two series are summarised differently, because they are different kinds
 *  of number (§5.3): a `point_in_time` count is a standing population, so a week
 *  is its MEAN; a `cumulative` count is a running total of route_run closures
 *  (§5.3ב), so a week is its LAST value — averaging a monotone total would
 *  report mid-week as if it were the week's end. The old code averaged both. */
const aggregateToWeekly = (dailyData: any[]) => {
  const weeklyMap = new Map<string, any[]>();
  
  dailyData.forEach((item) => {
    const date = new Date(item.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, []);
    }
    weeklyMap.get(weekKey)!.push(item);
  });
  
  return Array.from(weeklyMap.entries()).map(([weekKey, items]) => {
    // One accumulator per state, keyed by metric_state.state_key.
    const acc = new Map<string, { meta: any; total: number; days: number; last: number }>();
    
    items.forEach(item => {
      if (!item.statuses) return;
      item.statuses.forEach((s: any) => {
        const key = s._new_stateKey ?? s.status;
        const a = acc.get(key) ?? { meta: s, total: 0, days: 0, last: 0 };
        a.meta = s;                       // the newest row wins the label
        a.total += s.count || 0;
        a.days += 1;
        a.last = s.count || 0;            // items are already in date order
        acc.set(key, a);
      });
    });
    
    const statuses = Array.from(acc.entries()).map(([key, a]) => ({
      status: a.meta.status,
      statusName: a.meta.statusName,
      _new_stateKey: key,
      _new_series: a.meta._new_series,
      count:
        a.meta._new_series === "cumulative"
          ? a.last
          : a.days > 0
            ? Math.round(a.total / a.days)
            : 0,
    }));
    
    return {
      date: weekKey,
      statuses,
    };
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

export default function StatusDistributionHistoryChart({
  startDate: propStartDate,
  endDate: propEndDate,
  filters,
  type,
  period: initialPeriod,
  hideControls = false,
}: StatusDistributionHistoryChartProps) {
  const theme = useTheme();
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const [period, setPeriod] = React.useState<"30days" | "12months" | "3years">("30days");
  const [data, setData] = React.useState<any[]>([]);
  /** Discovered from the response — see the comment where it is filled. */
  const [series, setSeries] = React.useState<Array<{ key: string; name: string; cumulative: boolean }>>([]);
  const [loading, setLoading] = React.useState(false);

  // Sync props to state if provided
  React.useEffect(() => {
    if (type) setChartType(type);
  }, [type]);

  React.useEffect(() => {
    if (initialPeriod) setPeriod(initialPeriod);
  }, [initialPeriod]);

  const fetchHistory = React.useCallback(async () => {
    setLoading(true);
    try {
      // Calculate date range based on period
      const endDate = new Date();
      const startDate = new Date();
      
      const activePeriod = initialPeriod || period;

      if (activePeriod === "3years") {
        startDate.setFullYear(startDate.getFullYear() - 3);
      } else if (activePeriod === "12months") {
        startDate.setMonth(startDate.getMonth() - 12);
      } else {
        startDate.setDate(startDate.getDate() - 30);
      }

      // Build URL with filters
      const params = new URLSearchParams();
      params.append("startDate", startDate.toISOString());
      params.append("endDate", endDate.toISOString());
      
      if (filters?.customerId) params.append("customerId", filters.customerId.toString());
      if (filters?.shipmentId) params.append("shipmentId", filters.shipmentId.toString());
      if (filters?.itemTypeId) params.append("itemTypeId", filters.itemTypeId.toString());
      if (filters?.testStationId) params.append("testStationId", filters.testStationId.toString());

      const res = await apiFetch(`/api/dashboard/tests/status-distribution/history?${params.toString()}`);
      if (res.ok) {
        const result = await res.json();
        
        // NO ZERO-DAY FILTER. It dropped every day on which the lab held
        // nothing, and recharts then drew a straight segment from the day
        // before to the day after — a quiet carry-forward across a stretch of
        // real, measured zeros (§5.0(7)). Q2א answers every civil day in the
        // window, so a zero is a fact about that day and is drawn as one.
        const filteredResult: any[] = result;
        
        let processedData = filteredResult;
        
        // If too many points, aggregate to weekly (except for the "today" point)
        if (filteredResult.length > 30) {
          const lastPoint = filteredResult[filteredResult.length - 1];
          const hasToday = lastPoint?.isToday;
          
          if (hasToday) {
            const historicalData = filteredResult.slice(0, -1);
            const aggregatedHistory = aggregateToWeekly(historicalData);
            processedData = [...aggregatedHistory, lastPoint];
          } else {
            processedData = aggregateToWeekly(filteredResult);
          }
        }
        
        // Format data for chart
        const formattedData = processedData.map((item: any) => {
          const chartPoint: any = {
            displayDate: item.isToday ? "היום" : new Date(item.date).toLocaleDateString("he-IL", {
              day: "2-digit",
              month: "2-digit",
              year: (initialPeriod || period) === "3years" ? "2-digit" : undefined,
            }),
            date: item.date,
            _series: (item.statuses ?? []).map((s: any) => ({
              key: s._new_stateKey ?? s.status,
              name: s.statusName ?? s._new_stateKey ?? String(s.status),
              cumulative: s._new_series === "cumulative",
            })),
          };
          
          // Keyed by metric_state.state_key, not by the Hebrew label: two
          // states could in principle share a label, and `unmapped` has no
          // legacy id to key on at all.
          if (item.statuses) {
            item.statuses.forEach((s: any) => {
              chartPoint[s._new_stateKey ?? s.status] = s.count || 0;
            });
          }
          
          return chartPoint;
        });
        
        // The series are DISCOVERED from the response, not hardcoded. A state
        // added to metric_state through the settings screen (§3.1: "the fix is
        // one INSERT + a rebuild — no DDL and no deploy") appears here without
        // a second edit, and `unmapped` appears the moment an item lands in it.
        const seen = new Map<string, { key: string; name: string; cumulative: boolean }>();
        formattedData.forEach((point: any) => {
          (point._series ?? []).forEach((sd: any) => {
            if (!seen.has(sd.key)) seen.set(sd.key, sd);
          });
        });
        setSeries([...seen.values()]);
        setData(formattedData);
      }
    } catch (error) {
      console.error("Failed to fetch history", error);
    } finally {
      setLoading(false);
    }
  }, [period, filters, initialPeriod]);

  React.useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);


  const handleChartTypeChange = (
    event: React.MouseEvent<HTMLElement>,
    newChartType: "line" | "bar" | null
  ) => {
    if (newChartType !== null) {
      setChartType(newChartType);
    }
  };

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", direction: "rtl" }}>
      {/* Header with controls */}
      {!hideControls && (
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, px: 2, pt: 2 }}>
          <ToggleButtonGroup
            value={chartType}
            exclusive
            onChange={handleChartTypeChange}
            size="small"
            sx={{ direction: "ltr" }}
          >
            <ToggleButton value="bar">
              <BarChartIcon />
            </ToggleButton>
            <ToggleButton value="line">
              <ShowChartIcon />
            </ToggleButton>
          </ToggleButtonGroup>
          
          <PeriodCombobox
            value={period}
            onChange={setPeriod}
            label="בחר תקופה"
            options={[
              { id: "30days", name: "30 ימים אחרונים" },
              { id: "12months", name: "12 חודשים אחרונים" },
              { id: "3years", name: "3 שנים" },
            ]}
          />
        </Box>
      )}

      {/* Chart content */}
      <Box sx={{ flex: 1, minHeight: 0, px: 2, pb: 2 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <CircularProgress />
          </Box>
        ) : data.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", flexDirection: "column", gap: 2 }}>
            <Typography color="text.secondary">אין נתונים לתצוגה עבור התקופה ושילוב הסינונים שנבחרו</Typography>
            {/* Render an empty chart to show axes/structure */}
            <Box sx={{ width: "100%", height: "80%", opacity: 0.3, pointerEvents: "none" }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[]} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="displayDate" />
                        <YAxis />
                        <Legend />
                    </LineChart>
                </ResponsiveContainer>
            </Box>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "line" ? (
              <LineChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                <YAxis tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                <Tooltip />
                <Legend />
                {/* The five hardcoded lines are gone. `unmapped` could never
                    match one of them (§3.1), and a sixth state would have needed
                    a deploy to become visible. */}
                {series.map((sd) => (
                  <Line
                    key={sd.key}
                    type="monotone"
                    dataKey={sd.key}
                    name={sd.cumulative ? `${sd.name} (מצטבר)` : sd.name}
                    stroke={STATE_COLORS[sd.key] ?? UNKNOWN_STATE_COLOR}
                    strokeWidth={2}
                    strokeDasharray={sd.key === "unmapped" ? "4 2" : undefined}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                <YAxis tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                <Tooltip />
                <Legend />
                {/* Only the point-in-time states stack: they partition one
                    population at one instant, so their bars add up to it. The
                    cumulative closure count (§5.3ב) is a running total of things
                    that have LEFT that population — stacking it on top would
                    invent a bar height that means nothing. */}
                {series.map((sd) => (
                  <Bar
                    key={sd.key}
                    dataKey={sd.key}
                    name={sd.cumulative ? `${sd.name} (מצטבר)` : sd.name}
                    fill={STATE_COLORS[sd.key] ?? UNKNOWN_STATE_COLOR}
                    stackId={sd.cumulative ? undefined : "a"}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
}
