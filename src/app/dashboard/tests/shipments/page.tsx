"use client";
// Imports updated
import * as React from "react";
import { ToggleButton, ToggleButtonGroup, Box, Typography, Alert } from "@/components/ui";
import { TableChart as TableChartIcon } from "@/components/ui/icons";
import { BarChart as BarChartIcon } from "@/components/ui/icons";
import { Business as BusinessIcon } from "@/components/ui/icons";
import { Category as CategoryIcon } from "@/components/ui/icons";
import { ShipmentTrackingRow, DateRangePreset, CustomerOption, DashboardFilters } from "@/types/dashboard";
import { formatDate, getCurrentUtcIso } from "@/app/lib/datetime";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import ShipmentTrackingTable from "@/app/components/dashboard/ShipmentTrackingTable";
// Business and Category removed

export default function ShipmentsPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
  const [customStartDate, setCustomStartDate] = React.useState<string>("");
  const [customEndDate, setCustomEndDate] = React.useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerOption | null>(null);
  const [viewMode, setViewMode] = React.useState<"table" | "chart">("table"); // New State

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
    showAllHistory: false,
  });

  const [data, setData] = React.useState<ShipmentTrackingRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, itemTypes, loading: optionsLoading } = useDashboardOptions();

  // Sync customer selection
  React.useEffect(() => {
    setFilters(prev => ({ ...prev, customerId: selectedCustomer?.id || null }));
  }, [selectedCustomer]);

  const prevDatePresetRef = React.useRef<DateRangePreset>(datePreset);
  React.useEffect(() => {
    if (prevDatePresetRef.current !== datePreset) {
      prevDatePresetRef.current = datePreset;
      setFilters(prev => (prev.shipmentId ? { ...prev, shipmentId: null } : prev));
    }
  }, [datePreset]);

  // Handle View Mode Change
  const handleViewChange = (
    event: React.MouseEvent<HTMLElement>,
    newView: "table" | "chart" | null
  ) => {
    if (newView !== null) {
      setViewMode(newView);
    }
  };

  const fetchData = React.useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset, customStartDate, customEndDate);
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);

    try {
      const res = await fetch(`/api/dashboard/tests/shipments?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch shipments");
      const json = await res.json();
      setData(json);
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
        <FilterContainer
          actions={
            <Box sx={{ display: "flex", gap: 1 }}>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={handleViewChange}
                size="small"
                aria-label="view mode"
                sx={{ direction: "ltr" }}
              >
                <ToggleButton value="table" aria-label="table view">
                  <TableChartIcon fontSize="small" />
                </ToggleButton>
                <ToggleButton value="chart" aria-label="chart view">
                  <BarChartIcon fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
              <CompletedShipmentsToggle
                showSent={filters.showAllHistory || false}
                onChange={(val) => setFilters(prev => ({ ...prev, showAllHistory: val }))}
              />
            </Box>
          }
          extraFilters={
            <>
              <SelectFilter
                label="סוג פריט"
                options={itemTypes}
                value={itemTypes.find(t => t.id === filters.itemTypeId) || null}
                onChange={(val) => setFilters(prev => ({ ...prev, itemTypeId: val?.id ? Number(val.id) : null }))}
                loading={optionsLoading}
                width={180}
                icon={<CategoryIcon fontSize="small" />}
              />
            </>
          }
        >
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
            width={200}
            icon={<BusinessIcon fontSize="small" />}
          />
        </FilterContainer>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ flex: 1, minHeight: 0, mt: 1, display: "flex", flexDirection: "column" }}>
        <ShipmentTrackingTable
          data={data}
          loading={loading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </Box>
    </Box>
  );
}
