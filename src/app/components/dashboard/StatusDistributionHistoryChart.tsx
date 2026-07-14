"use client";

import * as React from "react";
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
} from "@mui/material";
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
import { getStatusName, ALL_STATUS_NAMES } from "@/app/lib/status-names";

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
  const [loading, setLoading] = React.useState(false);

  // Sync props to state if provided
  React.useEffect(() => {
    if (type) setChartType(type);
  }, [type]);

  React.useEffect(() => {
    if (initialPeriod) setPeriod(initialPeriod);
  }, [initialPeriod]);

  React.useEffect(() => {
    fetchHistory();
  }, [period, filters]);

  const fetchHistory = async () => {
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

      const res = await fetch(`/api/dashboard/tests/status-distribution/history?${params.toString()}`);
      if (res.ok) {
        const result = await res.json();
        
        // Filter out data points where all values are zero
        const filteredResult = result.filter((item: any) => 
          item.statuses && item.statuses.some((s: any) => (s.count || 0) > 0)
        );
        
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
          };
          
          // Add status counts
          if (item.statuses) {
            item.statuses.forEach((s: any) => {
              const statusName = getStatusName(s.status);
              chartPoint[statusName] = s.count || 0;
            });
          }
          
          // Ensure all statuses exist (for consistent chart lines)
          ALL_STATUS_NAMES.forEach(name => {
            if (chartPoint[name] === undefined) chartPoint[name] = 0;
          });
          
          return chartPoint;
        });
        
        setData(formattedData);
      }
    } catch (error) {
      console.error("Failed to fetch history", error);
    } finally {
      setLoading(false);
    }
  };

  // getStatusName imported from @/app/lib/status-names

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
      // Aggregate statuses
      const statusTotals: { [key: string]: number } = {};
      let count = 0;
      
      items.forEach(item => {
        if (item.statuses) {
          item.statuses.forEach((s: any) => {
            statusTotals[s.status] = (statusTotals[s.status] || 0) + (s.count || 0);
          });
          count++;
        }
      });
      
      // Average the totals
      const avgStatuses = Object.entries(statusTotals).map(([status, total]) => ({
        status,
        count: Math.round(total / count),
      }));
      
      return {
        date: weekKey,
        statuses: avgStatuses,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

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
          
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>בחר תקופה</InputLabel>
            <Select
              value={period}
              label="בחר תקופה"
              onChange={(e) => setPeriod(e.target.value as "30days" | "12months" | "3years")}
            >
              <MenuItem value="30days">30 ימים אחרונים</MenuItem>
              <MenuItem value="12months">12 חודשים אחרונים</MenuItem>
              <MenuItem value="3years">3 שנים</MenuItem>
            </Select>
          </FormControl>
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
                <Line type="monotone" dataKey="ממתין" name="ממתינים" stroke="#ff9800" strokeWidth={2} />
                <Line type="monotone" dataKey="בבדיקה" name="בבדיקה" stroke="#1976d2" strokeWidth={2} />
                <Line type="monotone" dataKey="ממתין למחקר" name="ממתין למחקר" stroke="#9c27b0" strokeWidth={2} />
                <Line type="monotone" dataKey="במחקר" name="במחקר" stroke="#673ab7" strokeWidth={2} />
                <Line type="monotone" dataKey="הושלם" name="הושלמו" stroke="#2e7d32" strokeWidth={2} />
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 20, right: 30, left: 70, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="displayDate" padding={{ left: 10, right: 10 }} />
                <YAxis tick={{ fontSize: 14, fontWeight: 'bold', fill: '#333' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ממתין" name="ממתינים" fill="#ff9800" stackId="a" />
                <Bar dataKey="בבדיקה" name="בבדיקה" fill="#1976d2" stackId="a" />
                <Bar dataKey="ממתין למחקר" name="ממתין למחקר" fill="#9c27b0" stackId="a" />
                <Bar dataKey="במחקר" name="במחקר" fill="#673ab7" stackId="a" />
                <Bar dataKey="הושלם" name="הושלמו" fill="#2e7d32" stackId="a" />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
}
