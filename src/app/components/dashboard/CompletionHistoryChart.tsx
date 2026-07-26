"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import {
  Typography,
  Box,
  Skeleton,
  useTheme,
  ToggleButton,
  ToggleButtonGroup,
} from "@/components/ui";
import SearchableCombobox from "../common/SearchableCombobox";
import { TableChart as TableChartIcon } from "@/components/ui/icons";
import { ShowChart as ShowChartIcon } from "@/components/ui/icons";
import { BarChart as BarChartIcon } from "@/components/ui/icons";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { usePeriodFilter } from "@/app/lib/hooks/usePeriodFilter";

export default function CompletionHistoryChart() {
  const theme = useTheme();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any[]>([]);
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const periodFilter = usePeriodFilter(); // Default to "12 Months" or whatever hook default is

  // Extract unique shipment codes from data to generate lines/bars
  const shipmentCodes = React.useMemo(() => {
    const codes = new Set<string>();
    data.forEach(item => {
        Object.keys(item).forEach(key => {
            if (key !== 'date' && key !== 'formattedDate') codes.add(key);
        });
    });
    return Array.from(codes).sort();
  }, [data]);

  // Generate colors for shipments
  const getColor = (index: number) => {
    const colors = [
        "#1976d2", "#2e7d32", "#ed6c02", "#9c27b0", "#d32f2f", 
        "#0288d1", "#388e3c", "#f57c00", "#7b1fa2", "#d81b60"
    ];
    return colors[index % colors.length];
  };

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { startDate, endDate } = periodFilter;
        if (!startDate || !endDate) return;

        const response = await apiFetch(
          `/api/dashboard/stats/completion-history?startDate=${startDate}&endDate=${endDate}`
        );
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("Error fetching completion history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [periodFilter.startDate, periodFilter.endDate]);

  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", {
      month: "short",
      year: "numeric",
    });
  };

  const chartData = data.map((item) => ({
    ...item,
    formattedDate: formatDateLabel(item.date),
  }));

  if (loading) {
    return (
      <Box sx={{ width: "100%", height: "100%", p: 2 }}>
        <Skeleton variant="text" width="40%" height={32} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" width="100%" height={250} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", direction: "rtl", p: 2 }}>
      <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
         {/* Period Filter */}
         <SearchableCombobox<(typeof periodFilter.periodOptions)[number]>
            value={periodFilter.selectedPeriod || periodFilter.periodOptions[0]}
            onChange={(newValue) => { if (newValue) periodFilter.handlePeriodChange(newValue); }}
            options={periodFilter.periodOptions}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) =>
               option.type === value.type && option.value === value.value
            }
            floatingLabel="בחר תקופה"
            width={200}
            disableClearable
          />
          
          <ToggleButtonGroup
            value={chartType}
            exclusive
            onChange={(e, newType) => { if (newType) setChartType(newType); }}
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
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {typeof window !== 'undefined' && (
          <ResponsiveContainer width="100%" height="100%">
          {chartType === "line" ? (
             <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                    dataKey="formattedDate" 
                    tick={{ fontSize: 12 }} 
                    interval={chartData.length > 15 ? 2 : 0}
                />
                <YAxis unit="%" domain={[0, 100]} />
                <Tooltip 
                    contentStyle={{ direction: "rtl", textAlign: "right" }}
                    formatter={(value: any, name: any) => [`${value}%`, name] as any}
                    labelStyle={{ fontWeight: "bold", marginBottom: 5 }}
                />
                <Legend />
                {shipmentCodes.map((code, index) => (
                    <Line
                        key={code}
                        type="monotone"
                        dataKey={code}
                        name={code}
                        stroke={getColor(index)}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                    />
                ))}
            </LineChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                    dataKey="formattedDate" 
                    tick={{ fontSize: 12 }} 
                    interval={chartData.length > 15 ? 2 : 0}
                />
                <YAxis unit="%" domain={[0, 100]} />
                <Tooltip 
                    contentStyle={{ direction: "rtl", textAlign: "right" }}
                    formatter={(value: any, name: any) => [`${value}%`, name] as any}
                    labelStyle={{ fontWeight: "bold", marginBottom: 5 }}
                />
                <Legend />
                {shipmentCodes.map((code, index) => (
                    <Bar
                        key={code}
                        dataKey={code}
                        name={code}
                        fill={getColor(index)}
                        maxBarSize={50}
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
