"use client";

import * as React from "react";
import { Box, Typography, Alert } from "@mui/material";
import { DateRangePreset, DashboardFilters, SlowItemRow } from "@/types/dashboard";
import {
  Category,
  AccountTree,
  Place,
  Info,
  Badge,
  QrCode
} from "@/components/ui/icons";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import SlowItemsTable from "@/app/components/dashboard/SlowItemsTable";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import StatusFilterComponent from "@/app/components/dashboard/filters/StatusFilter";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import SearchFilter from "@/app/components/dashboard/filters/SearchFilter";

export default function SlowItemsPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
  const [customStartDate, setCustomStartDate] = React.useState<string>("");
  const [customEndDate, setCustomEndDate] = React.useState<string>("");
  const [lastRefresh, setLastRefresh] = React.useState<string | null>(null);
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
    showAllHistory: false, // Ensure this matches type if needed, or remove if optional
  });

  const [data, setData] = React.useState<SlowItemRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { itemTypes, stationTypes, shipments } = useDashboardOptions();

  // Sync date preset logic
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

  const filteredShipments = React.useMemo(() => {
      if (!shipments) return [];
      return filters.showSent 
        ? shipments 
        : shipments.filter(s => !s.is_sent);
  }, [shipments, filters.showSent]);

  const fetchData = React.useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset, customStartDate, customEndDate);
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);
    if (filters.showSent) params.set("showAllHistory", "true");
    // Slow items specific
    params.append("limit", "50"); // Fetch top 50 slow items

    try {
        const res = await fetch(`/api/dashboard/tests/slow-items?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch slow items");
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
    <Box sx={{ p: 2, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Box sx={{ flexShrink: 0 }}>
            <FilterContainer
              actions={
                <Box sx={{ display: "flex", gap: 1 }}>
                  <CompletedShipmentsToggle 
                    showSent={filters.showSent || false}
                    onChange={(val) => handleFilterChange({ showSent: val })}
                  />
                </Box>
              }
              extraFilters={
                <>
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
                  
                  <ShipmentFilter
                     options={filteredShipments}
                     selectedId={filters.shipmentId}
                     onChange={(id) => handleFilterChange({ shipmentId: id })}
                  />
                  
                  <StatusFilterComponent
                    value={filters.status}
                    onChange={(val) => handleFilterChange({ status: val })}
                    icon={<Info fontSize="small" />}
                  />

                   <SearchFilter
                    label="מס' עובד"
                    value={filters.workerId || ""}
                    onChange={(val) => handleFilterChange({ workerId: val || null })}
                    width={150}
                    placeholder="חפש עובד..."
                    icon={<Badge fontSize="small" />}
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
            </FilterContainer>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ flex: 1, minHeight: 0, mt: 1 }}>
             <SlowItemsTable data={data} loading={loading} />
        </Box>
    </Box>
  );
}
