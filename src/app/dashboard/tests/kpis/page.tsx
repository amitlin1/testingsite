"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { Box, Paper, Typography, Grid, Card, CardContent, CircularProgress, Alert } from "@/components/ui";
import { DateRangePreset, DashboardFilters, DashboardKpis } from "@/types/dashboard";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import {
  TrendingUp,
  TrendingDown,
  AccessTime,
  CheckCircle,
  Queue,
  Speed,
  Warning,
  Assessment,
  Person,
  Category,
  AccountTree,
  Business,
  Place,
  Info
} from "@/components/ui/icons";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import StatusFilterComponent from "@/app/components/dashboard/filters/StatusFilter";

const StatCard = ({ title, value, subtext, icon, color }: { title: string, value: string | number, subtext?: string, icon: React.ReactNode, color: string }) => (
  <Card elevation={0} sx={{ height: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider", transition: "transform 0.2s, box-shadow 0.2s", "&:hover": { transform: "translateY(-4px)", boxShadow: "0 8px 20px -6px rgba(0,0,0,0.1)" } }}>
    <CardContent sx={{ p: 3, display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" fontWeight="600" letterSpacing={1}>{title}</Typography>
          <Typography variant="h3" fontWeight="800" color="text.primary" sx={{ my: 1 }}>{value}</Typography>
        </Box>
        <Box sx={{ p: 1.5, borderRadius: "12px", bgcolor: `${color}15`, color: color, display: "flex" }}>
          {icon}
        </Box>
      </Box>
      {subtext && (
        <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {subtext}
        </Typography>
      )}
    </CardContent>
  </Card>
);

export default function APIsPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");

  const [filters, setFilters] = React.useState<DashboardFilters>({
    customerId: null,
    shipmentId: null,
    itemSerial: null,
    itemId: null,
    itemTypeId: null,
    testStationId: null,
    testStationTypeId: null,
    workerId: null,
    status: "all",
    showAllHistory: false
  });

  const [data, setData] = React.useState<DashboardKpis | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, stations, stationTypes, itemTypes, shipments } = useDashboardOptions();

  const { startDate, endDate } = getDateRange(datePreset, customStart, customEnd);

  // Sync customer selection
  // React.useEffect(() => {
  //   setFilters(prev => ({ ...prev, customerId: selectedCustomer?.id || null }));
  // }, [selectedCustomer]);

  // Clear shipmentId on date change
  const prevDatePresetRef = React.useRef<DateRangePreset>(datePreset);
  React.useEffect(() => {
    if (prevDatePresetRef.current !== datePreset) {
      prevDatePresetRef.current = datePreset;
      setFilters(prev => (prev.shipmentId ? { ...prev, shipmentId: null } : prev));
    }
  }, [datePreset]);

  // Filter change handlers
  const handleFilterChange = (newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const filteredShipments = React.useMemo(() => {
    if (!shipments) return [];
    return filters.showAllHistory
      ? shipments
      : shipments.filter(s => !s.is_sent);
  }, [shipments, filters.showAllHistory]);

  const fetchData = React.useCallback(async () => {
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);

    try {
      const res = await apiFetch(`/api/dashboard/tests/kpis?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      const json = await res.json();
      setData(json);
      // setLastRefresh(getCurrentUtcIso()); // removed as unused
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching data");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, filters]); // Corrected dependencies


  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh logic removed as state was removed



  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flexShrink: 0 }}>
        <FilterContainer
          actions={
            <Box sx={{ display: "flex", gap: 1 }}>
              <CompletedShipmentsToggle
                showSent={filters.showAllHistory || false}
                onChange={(val) => handleFilterChange({ showAllHistory: val })}
              />
            </Box>
          }
          extraFilters={
            <>
              <ShipmentFilter
                options={filteredShipments}
                selectedId={filters.shipmentId}
                onChange={(id) => handleFilterChange({ shipmentId: id })}
              />

              <SelectFilter
                label="סוג פריט"
                options={itemTypes}
                value={itemTypes.find(t => t.id === filters.itemTypeId) || null}
                onChange={(val) => handleFilterChange({ itemTypeId: val?.id ? Number(val.id) : null })}
                width={180}
                icon={<Category fontSize="small" />}
              />

              <SelectFilter
                label="סוג עמדה"
                options={stationTypes}
                value={stationTypes.find(t => t.id === filters.testStationTypeId) || null}
                onChange={(val) => handleFilterChange({ testStationTypeId: val?.id ? Number(val.id) : null })}
                width={180}
                icon={<AccountTree fontSize="small" />}
              />

              <SelectFilter
                label="עמדה"
                options={stations}
                value={stations.find(s => s.id === filters.testStationId) || null}
                onChange={(val) => handleFilterChange({ testStationId: val ? Number(val.id) : null })}
                width={180}
                icon={<Place fontSize="small" />}
              />

              <StatusFilterComponent
                value={filters.status || "all"}
                onChange={(val) => handleFilterChange({ status: val })}
                icon={<Info fontSize="small" />}
              />
            </>
          }
        >
          <DateFilter
            preset={datePreset}
            onPresetChange={setDatePreset}
            customStart={customStart}
            onCustomStartChange={setCustomStart}
            customEnd={customEnd}
            onCustomEndChange={setCustomEnd}
          />

          <SelectFilter
            label="לקוח"
            options={customers}
            value={customers.find(c => c.id === filters.customerId) || null}
            onChange={(val) => handleFilterChange({ customerId: val ? Number(val.id) : null })}
            width={220}
            placeholder="בחר לקוח"
            icon={<Business fontSize="small" />}
          />
        </FilterContainer>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ flex: 1, minHeight: 0, mt: 1, overflowY: "auto" }}>
        {loading && !data ? (
          <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>
        ) : data ? (
          <Grid container spacing={2}>
            {/* Row 1: High Level Counts */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="סה״כ עובד"
                value={data.totalItemsProcessed}
                icon={<CheckCircle fontSize="inherit" />}
                color="#2E7D32" // Green
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="בהמתנה"
                value={data.itemsCurrentlyInQueue}
                subtext="ממתין לבדיקה"
                icon={<Queue fontSize="inherit" />}
                color="#ED6C02" // Orange
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="בבדיקה"
                value={data.itemsCurrentlyInTest}
                subtext="בביצוע כרגע"
                icon={<Speed fontSize="inherit" />}
                color="#1976D2" // Blue
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="נכשל / החזרות"
                // Note: Assuming we might have this data or similar, for now placeholder or derived
                value="-"
                subtext="דורש טיפול"
                icon={<Warning fontSize="inherit" />}
                color="#D32F2F" // Red
              />
            </Grid>

            {/* Row 2: Averages */}
            <Grid size={{ xs: 12, md: 6 }}>
              <StatCard
                title="זמן המתנה ממוצע"
                value={`${Number(data.averageQueueTimeMinutes).toFixed(2)} דק'`}
                subtext="זמן המתנה לפני בדיקה"
                icon={<AccessTime fontSize="inherit" />}
                color="#9C27B0" // Purple
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <StatCard
                title="זמן ביצוע ממוצע"
                value={`${Number(data.averageProcessingTimeMinutes).toFixed(2)} דק'`}
                subtext="משך בדיקה בפועל"
                icon={<AccessTime fontSize="inherit" />}
                color="#009688" // Teal
              />
            </Grid>

            {/* Row 3: Busiest Station */}
            <Grid size={{ xs: 12 }}>
              <Card elevation={0} sx={{ borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: "divider" }}>
                <CardContent sx={{ p: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <Box sx={{ p: 2, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.04)" }}>
                    <Assessment sx={{ fontSize: 40, color: "text.secondary" }} />
                  </Box>
                  <Box>
                    <Typography variant="overline" color="text.secondary">העמדה העמוסה ביותר</Typography>
                    <Typography variant="h4" fontWeight="bold">{data.busiestStationName || "אין נתונים"}</Typography>
                    <Typography variant="body1" color="text.secondary">
                      עיבדה <b>{data.busiestStationCount}</b> פריטים בתקופה זו
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        ) : null}
      </Box>
    </Box>
  );
}
