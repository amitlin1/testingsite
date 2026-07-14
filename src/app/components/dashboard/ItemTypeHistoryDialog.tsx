"use client";

import * as React from "react";
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
import { ItemTypeTrackingRow } from "@/types/dashboard";

interface ItemTypeHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  itemType: ItemTypeTrackingRow | null;
}

export default function ItemTypeHistoryDialog({
  open,
  onClose,
  itemType,
}: ItemTypeHistoryDialogProps) {
  const theme = useTheme();
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const [period, setPeriod] = React.useState<"alldays" | "12months" | "3years">("alldays");
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && itemType) {
      fetchHistory();
    }
  }, [open, itemType, period]);

  const fetchHistory = async () => {
    if (!itemType) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/item-types/${itemType.itemTypeId}/history?period=${period}`);
      if (res.ok) {
        const result = await res.json();
        
        // Filter out data points where all values are zero
        const filteredResult = result.filter((item: any) => 
          (item.itemsInQueue || 0) > 0 || 
          (item.itemsInTest || 0) > 0 || 
          (item.itemsWaitingForResearch || 0) > 0 || 
          (item.itemsInResearch || 0) > 0 || 
          (item.itemsFinished || 0) > 0
        );
        
        // Aggregate to weekly if too many data points (more than 30)
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
  };

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
      const avg = (key: string) => Math.round(
        items.reduce((sum, item) => sum + (parseFloat(item[key]) || 0), 0) / items.length
      );
      
      return {
        date: weekKey,
        itemsInQueue: avg('itemsInQueue'),
        itemsInTest: avg('itemsInTest'),
        itemsWaitingForResearch: avg('itemsWaitingForResearch'),
        itemsInResearch: avg('itemsInResearch'),
        itemsFinished: avg('itemsFinished'),
        itemsInRoutes: avg('itemsInRoutes'),
        totalItems: avg('totalItems'),
        completionPercentage: avg('completionPercentage'),
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

  if (!itemType) return null;

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
            <Typography variant="h6">היסטוריית סוג פריט: {itemType.itemTypeDesc}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>תקופה</InputLabel>
            <Select
              value={period}
              label="תקופה"
              onChange={(e) => setPeriod(e.target.value as "alldays" | "12months" | "3years")}
            >
              <MenuItem value="alldays">כל הימים</MenuItem>
              <MenuItem value="12months">12 חודשים אחרונים</MenuItem>
              <MenuItem value="3years">3 שנים (רבעוני)</MenuItem>
            </Select>
          </FormControl>
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
            <Typography color="text.secondary">אין נתונים היסטוריים לסוג פריט זה</Typography>
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
                  <Line type="monotone" dataKey="itemsFinished" name="הושלמו" stroke="#2e7d32" strokeWidth={2} />
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
                  <Bar dataKey="itemsFinished" name="הושלמו" fill="#2e7d32" stackId="a" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
