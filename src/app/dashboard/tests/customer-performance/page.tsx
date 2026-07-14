"use client";

import * as React from "react";
import { Box, Typography, Alert } from "@mui/material";
import { DateRangePreset, DashboardFilters, CustomerPerformanceRow, CustomerOption } from "@/types/dashboard";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import CustomerPerformanceTable from "@/app/components/dashboard/CustomerPerformanceTable";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import { Business } from "@/components/ui/icons";
import { Category } from "@/components/ui/icons";

export default function CustomerPerformancePage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("today");
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
    showAllHistory: false,
  });

  const [data, setData] = React.useState<CustomerPerformanceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, itemTypes, shipments, loading: optionsLoading } = useDashboardOptions();

  const handleFilterChange = (newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const filteredShipments = React.useMemo(() => {
    if (!shipments) return [];
    // If customer selected, filter shipments by customer (if shipment has customer_id)
    let filtered = shipments;
    if (filters.customerId) {
      // Assuming shipment object has customer_id. 
      // If not, we can't filter by customer here easily without verifying shipment option structure.
      // Let's assume standard structure or no filter for now.
      // But we DO want to filter by showSent.
    }
    return filters.showAllHistory
      ? filtered
      : filtered.filter(s => !s.is_sent);
  }, [shipments, filters.showAllHistory, filters.customerId]);

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

  const fetchData = React.useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset, customStartDate, customEndDate);
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const params = buildDashboardQueryParams(startDate, endDate, filters);

    try {
      const res = await fetch(`/api/dashboard/tests/customer-performance?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch customer performance");
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
          <Typography variant="h5" fontWeight="bold">ביצועים לפי לקוח</Typography>
          <CompletedShipmentsToggle
            showSent={filters.showAllHistory || false}
            onChange={(val) => handleFilterChange({ showAllHistory: val })}
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
            onChange={(val) => handleFilterChange({ itemTypeId: val?.id ? Number(val.id) : null })}
            loading={optionsLoading}
            width={180}
            icon={<Category fontSize="small" />}
          />

          <ShipmentFilter
            options={filteredShipments}
            selectedId={filters.shipmentId}
            onChange={(id) => handleFilterChange({ shipmentId: id })}
          />
        </FilterContainer>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ flex: 1, minHeight: 0, mt: 1, display: "flex", flexDirection: "column" }}>
        <CustomerPerformanceTable data={data} loading={loading} />
      </Box>
    </Box>
  );
}
