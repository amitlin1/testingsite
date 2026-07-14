"use client";

import * as React from "react";
import { Box, Typography, Alert, CircularProgress, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { DateRangePreset, DashboardFilters, StationLoadRow } from "@/types/dashboard";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import {
  Business,
  Category,
  AccountTree,
  Place,
  Info
} from "@/components/ui/icons";
import { TableChart as TableChartIcon } from "@/components/ui/icons";
import { BarChart as BarChartIcon } from "@/components/ui/icons";
import StationLoadTable from "@/app/components/dashboard/StationLoadTable";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import StatusFilterComponent from "@/app/components/dashboard/filters/StatusFilter";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";

export default function StationLoadPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");
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
    showSent: false
  });

  const [data, setData] = React.useState<StationLoadRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, stations, stationTypes, itemTypes, shipments } = useDashboardOptions();

  const { startDate, endDate } = getDateRange(datePreset, customStart, customEnd);

  // Clear shipmentId on date change
  const prevDatePresetRef = React.useRef<DateRangePreset>(datePreset);
  React.useEffect(() => {
    if (prevDatePresetRef.current !== datePreset) {
      prevDatePresetRef.current = datePreset;
      setFilters(prev => (prev.shipmentId ? { ...prev, shipmentId: null } : prev));
    }
  }, [datePreset]);

  const handleFilterChange = (newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  // Handle View Mode Change
  const handleViewChange = (
    event: React.MouseEvent<HTMLElement>,
    newView: "table" | "chart" | null
  ) => {
    if (newView !== null) {
      setViewMode(newView);
    }
  };

  const filteredShipments = React.useMemo(() => {
    if (!shipments) return [];
    return filters.showSent
      ? shipments
      : shipments.filter(s => !s.is_sent);
  }, [shipments, filters.showSent]);

  const fetchData = React.useCallback(async () => {
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);

    try {
      const res = await fetch(`/api/dashboard/tests/by-station?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch station load data");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching data");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, filters]);

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
                showSent={filters.showSent || false}
                onChange={(val) => handleFilterChange({ showSent: val })}
              />
            </Box>
          }
          extraFilters={
            <>
              <SelectFilter
                label="סוג עמדה"
                options={stationTypes}
                value={stationTypes.find(t => t.id === filters.testStationTypeId) || null}
                onChange={(val) => handleFilterChange({ testStationTypeId: val ? Number(val.id) : null })}
                width={180}
                icon={<AccountTree fontSize="small" />}
              />
              <SelectFilter
                label="לקוח"
                options={customers}
                value={customers.find(c => c.id === filters.customerId) || null}
                onChange={(val) => handleFilterChange({ customerId: val ? Number(val.id) : null })}
                width={180}
                icon={<Business fontSize="small" />}
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
            label="עמדה"
            options={stations}
            value={stations.find(s => s.id === filters.testStationId) || null}
            onChange={(val) => handleFilterChange({ testStationId: val ? Number(val.id) : null })}
            width={180}
            icon={<Place fontSize="small" />}
          />

          <ShipmentFilter
            options={filteredShipments}
            selectedId={filters.shipmentId}
            onChange={(id) => handleFilterChange({ shipmentId: id })}
          />

          <SelectFilter
            label="סוג פריט"
            options={itemTypes}
            value={itemTypes.find(t => t.id === filters.itemTypeId) || null}
            onChange={(val) => handleFilterChange({ itemTypeId: val ? Number(val.id) : null })}
            width={180}
            icon={<Category fontSize="small" />}
          />
        </FilterContainer>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ flex: 1, minHeight: 0, mt: 1, display: "flex", flexDirection: "column" }}>
        <StationLoadTable
          data={data}
          loading={loading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </Box>
    </Box>
  );
}
