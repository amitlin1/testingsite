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
// NO usePeriodFilter IMPORT. The hook (and the date-periods helpers underneath
// it) built its range with `new Date()` + `setHours()` + `toISOString().split('T')[0]`
// — the process's LOCAL midnight rendered as a UTC calendar day, which names
// YESTERDAY east of Greenwich and stretches the window by a day at each end on a
// UTC container. §7.2 defines the business day as
// `(ts AT TIME ZONE 'Asia/Jerusalem')::date`, and that is what these three
// helpers produce, via the IANA rules in Intl rather than a hardcoded +02/+03.
// The hook is deleted in this stage (§8 stage 6) and this was its last caller.

/** §6.3 — every dashboard picker is capped at 13 months back. */
const UI_MONTH_CAP = 13;

const JERUSALEM_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 'YYYY-MM-DD' in Asia/Jerusalem — the JS twin of the DB's business_date(). */
const businessDay = (at: Date = new Date()) => JERUSALEM_DAY.format(at);

/** Civil-date arithmetic, never `Date + n*86400000`: that leaks an hour across
 *  each of Israel's two DST transitions a year (§7.3). */
const shiftDay = (day: string, { days = 0, months = 0 }: { days?: number; months?: number }) => {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastOfMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const anchor = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, lastOfMonth)));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
};

interface PeriodOption {
  label: string;
  type: "days" | "months" | "years" | "year";
  value: number | string;
}

/** The window a preset asks for. The server applies the 13-month cap and reports
 *  it in X-Metrics-Period-Capped rather than silently shortening the answer, so
 *  asking for more than the cap is honest here — but a YEAR entirely outside the
 *  cap would collapse to a single day, so those are not offered at all. */
const rangeFor = (option: PeriodOption, today = businessDay()) => {
  if (option.type === "year") {
    return { startDate: `${option.value}-01-01`, endDate: `${option.value}-12-31` };
  }
  const n = Math.max(1, Math.trunc(Number(option.value)));
  const start =
    option.type === "days"
      ? shiftDay(today, { days: -(n - 1) })
      : option.type === "months"
        ? shiftDay(shiftDay(today, { months: -n }), { days: 1 })
        : shiftDay(shiftDay(today, { months: -12 * n }), { days: 1 });
  return { startDate: start, endDate: today };
};

const buildPeriodOptions = (today = businessDay()): PeriodOption[] => {
  const capFloor = shiftDay(shiftDay(today, { months: -UI_MONTH_CAP }), { days: 1 });
  const thisYear = Number(today.slice(0, 4));
  const options: PeriodOption[] = [
    { label: "30 ימים אחרונים", type: "days", value: 30 },
    { label: "12 חודשים אחרונים", type: "months", value: 12 },
    { label: "13 חודשים (המרבי)", type: "months", value: UI_MONTH_CAP },
  ];
  for (const year of [thisYear, thisYear - 1]) {
    // Offered only if some of it is still inside the cap.
    if (`${year}-12-31` >= capFloor) options.push({ label: `שנת ${year}`, type: "year", value: String(year) });
  }
  return options;
};

export default function CompletionHistoryChart() {
  const theme = useTheme();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any[]>([]);
  const [chartType, setChartType] = React.useState<"line" | "bar">("line");
  const periodOptions = React.useMemo(() => buildPeriodOptions(), []);
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodOption>(() => buildPeriodOptions()[0]);

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

  const { startDate, endDate } = React.useMemo(() => rangeFor(selectedPeriod), [selectedPeriod]);

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
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
  }, [startDate, endDate]);

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
         <SearchableCombobox<PeriodOption>
            value={selectedPeriod}
            onChange={(newValue) => { if (newValue) setSelectedPeriod(newValue); }}
            options={periodOptions}
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
