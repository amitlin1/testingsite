"use client";

import * as React from "react";
import { Box, Typography, Alert, Grid } from "@/components/ui";
import { DateRangePreset, DashboardFilters, StatusDistribution, CustomerOption } from "@/types/dashboard";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import StatusDistributionChart from "@/app/components/dashboard/StatusDistributionChart";
import StatusDistributionHistoryChart from "@/app/components/dashboard/StatusDistributionHistoryChart";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import { Business, Category, Timeline } from "@/components/ui/icons";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";

export default function StatusDistributionPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
  const [historyPeriod, setHistoryPeriod] = React.useState<"30days" | "12months" | "3years">("30days");
  const [customStartDate, setCustomStartDate] = React.useState<string>("");
  const [customEndDate, setCustomEndDate] = React.useState<string>("");
  const [lastRefresh, setLastRefresh] = React.useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerOption | null>(null);
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
    showSent: false,
  });

  const [data, setData] = React.useState<StatusDistribution[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, itemTypes, shipments, loading: optionsLoading } = useDashboardOptions();

  React.useEffect(() => {
    setFilters(prev => ({ ...prev, customerId: selectedCustomer?.id || null }));
  }, [selectedCustomer]);

  const filteredShipments = React.useMemo(() => {
    if (!shipments) return [];
    return filters.showSent
      ? shipments
      : shipments.filter(s => !s.is_sent);
  }, [shipments, filters.showSent]);

  const prevDatePresetRef = React.useRef<DateRangePreset>(datePreset);
  React.useEffect(() => {
    if (prevDatePresetRef.current !== datePreset) {
      prevDatePresetRef.current = datePreset;
      setFilters(prev => (prev.shipmentId ? { ...prev, shipmentId: null } : prev));
    }
  }, [datePreset]);

  const fetchData = React.useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset, customStartDate, customEndDate);
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);
    if (filters.showSent) params.set("showAllHistory", "true");

    try {
      const res = await fetch(`/api/dashboard/tests/status-distribution?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch status distribution");
      const json = await res.json();
      setData(json);
      setLastRefresh(getCurrentUtcIso());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching data");
    } finally {
      setLoading(false);
    }
  }, [datePreset, customStartDate, customEndDate, filters]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);



  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flexShrink: 0 }}>
        <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="h5" fontWeight="bold">התפלגות סטטוסים</Typography>
          <CompletedShipmentsToggle
            showSent={filters.showSent || false}
            onChange={(val) => setFilters(prev => ({ ...prev, showSent: val }))}
          />
        </Box>
        <FilterContainer>
          <DateFilter
            preset={datePreset}
            onPresetChange={setDatePreset}
            customStart={customStartDate}
            onCustomStartChange={setCustomStartDate}
            customEnd={customEndDate}
            onCustomEndChange={setCustomEndDate}
          />

          <SelectFilter
            label="לקוח"
            options={customers}
            value={selectedCustomer}
            onChange={(val) => setSelectedCustomer(val as CustomerOption | null)}
            loading={optionsLoading}
            width={220}
            icon={<Business fontSize="small" />}
          />

          <SelectFilter
            label="סוג פריט"
            options={itemTypes}
            value={itemTypes.find(t => t.id === filters.itemTypeId) || null}
            onChange={(val) => setFilters(prev => ({ ...prev, itemTypeId: val?.id ? Number(val.id) : null }))}
            loading={optionsLoading}
            width={180}
            icon={<Category fontSize="small" />}
          />

          <ShipmentFilter
            options={filteredShipments}
            selectedId={filters.shipmentId}
            onChange={(id) => setFilters(prev => ({ ...prev, shipmentId: id }))}
          />

          <SelectFilter
            label="תקופה למגמות"
            options={[
              { id: "30days", name: "30 ימים אחרונים" },
              { id: "12months", name: "12 חודשים אחרונים" },
              { id: "3years", name: "3 שנים" }
            ]}
            value={{ id: historyPeriod, name: historyPeriod === "30days" ? "30 ימים אחרונים" : historyPeriod === "12months" ? "12 חודשים אחרונים" : "3 שנים" }}
            onChange={(val) => val && setHistoryPeriod(val.id as any)}
            loading={false}
            width={200}
            icon={<Timeline fontSize="small" />}
            disableClearable
          />
        </FilterContainer>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ flex: 1, minHeight: 0, mt: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
          {/* Left Column: Current Distribution (Pie) - 40% */}
          <Grid size={{ xs: 12, md: 5, lg: 4 }} sx={{ height: { xs: "500px", md: "100%" } }}>
            <StatusDistributionChart data={data} loading={loading} filters={filters} />
          </Grid>

          {/* Right Column: History Trends (Selected Period) - 60% */}
          <Grid size={{ xs: 12, md: 7, lg: 8 }} sx={{ height: "100%" }}>
            <StatusDistributionHistoryChart
              filters={filters}
              type={historyPeriod === "12months" ? "bar" : "line"}
              period={historyPeriod}
            />
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
