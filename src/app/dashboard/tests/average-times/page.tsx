"use client";

import * as React from "react";
import { Box, Typography, Alert } from "@mui/material";
import { DateRangePreset, DashboardFilters, AverageTimesPoint, AverageTimesPeriod, CustomerOption } from "@/types/dashboard";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import FilterContainer from "@/app/components/dashboard/filters/FilterContainer";
import DateFilter from "@/app/components/dashboard/filters/DateFilter";
import SelectFilter from "@/app/components/dashboard/filters/SelectFilter";
import AccessTime from "@mui/icons-material/AccessTime";
import Business from "@mui/icons-material/Business";
import Category from "@mui/icons-material/Category";
import AverageTimesChart from "@/app/components/dashboard/AverageTimesChart";
import ShipmentFilter from "@/app/components/dashboard/filters/ShipmentFilter";
import CompletedShipmentsToggle from "@/app/components/dashboard/filters/CompletedShipmentsToggle";
import SearchFilter from "@/app/components/dashboard/filters/SearchFilter";

export default function AverageTimesPage() {
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>("last30days"); // Default to longer range
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

  const [averageTimesPeriod, setAverageTimesPeriod] = React.useState<AverageTimesPeriod>("daily");
  const [data, setData] = React.useState<AverageTimesPoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { customers, itemTypes, shipments, loading: optionsLoading } = useDashboardOptions();

  const handleFilterChange = (newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const filteredShipments = React.useMemo(() => {
    if (!shipments) return [];
    return filters.showSent 
      ? shipments 
      : shipments.filter(s => !s.is_sent);
  }, [shipments, filters.showSent]);

  React.useEffect(() => {
    setFilters(prev => ({ ...prev, customerId: selectedCustomer?.id || null }));
  }, [selectedCustomer]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    // Period Logic override: compute date range based on selected period
    const avgEnd = new Date();
    const avgStart = new Date();

    if (averageTimesPeriod === "daily") {
        avgStart.setDate(avgEnd.getDate() - 30);
    } else if (averageTimesPeriod === "monthly") {
        avgStart.setMonth(avgEnd.getMonth() - 12);
    } else if (averageTimesPeriod === "quarterly") {
        avgStart.setFullYear(avgEnd.getFullYear() - 3);
    }

    const params = buildDashboardQueryParams(avgStart.toISOString(), avgEnd.toISOString(), filters);
    if (filters.showSent) params.set("showAllHistory", "true");
    // Average times specific
    params.set("period", averageTimesPeriod);


    try {
        const res = await fetch(`/api/dashboard/tests/average-times?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch average times");
        const json = await res.json();
        setData(json);
        setLastRefresh(getCurrentUtcIso());
    } catch (err) {
        setError(err instanceof Error ? err.message : "Error fetching data");
    } finally {
        setLoading(false);
    }
  }, [filters, averageTimesPeriod]); // Dependency on period, not datePreset directly for this specific chart usually

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);



  return (
    <Box sx={{ p: 2, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Box sx={{ flexShrink: 0 }}>
             <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                 <Typography variant="h5" fontWeight="bold">זמנים ממוצעים</Typography>
                 <CompletedShipmentsToggle 
                    showSent={filters.showSent || false}
                    onChange={(val) => handleFilterChange({ showSent: val })}
                 />
             </Box>
            <FilterContainer>
                <DateFilter 
                  preset={datePreset} 
                  onPresetChange={(newPreset) => {
                      setDatePreset(newPreset);
                  }}
                  customStart={customStartDate}
                  onCustomStartChange={setCustomStartDate}
                  customEnd={customEndDate}
                  onCustomEndChange={setCustomEndDate}
                />
                
                <SelectFilter
                  label="תקופה"
                  options={[
                      { id: "daily", name: "יומי" },
                      { id: "monthly", name: "חודשי" },
                      { id: "quarterly", name: "רבעוני" }
                  ]}
                  value={{ id: averageTimesPeriod, name: averageTimesPeriod === "daily" ? "יומי" : averageTimesPeriod === "monthly" ? "חודשי" : "רבעוני" }}
                  onChange={(val) => setAverageTimesPeriod(val?.id as AverageTimesPeriod || "daily")}
                  width={150}
                  icon={<AccessTime />}
                />

                <SelectFilter
                  label="לקוח"
                  options={customers}
                  value={selectedCustomer}
                  onChange={(val) => setSelectedCustomer(val as CustomerOption | null)}
                  loading={optionsLoading}
                  width={200}
                  icon={<Business fontSize="small" />}
                />

                 <SelectFilter
                   label="סוג פריט"
                   options={itemTypes}
                   value={itemTypes.find(t => t.id === filters.itemTypeId) || null}
                   onChange={(val) => handleFilterChange({ itemTypeId: val?.id ? Number(val.id) : null })}
                   width={180}
                   icon={<Category fontSize="small" />}
                 />
                 
                 <ShipmentFilter
                    options={filteredShipments}
                    selectedId={filters.shipmentId}
                    onChange={(id) => handleFilterChange({ shipmentId: id })}
                 />

                  <SearchFilter
                   label="מזהה פריט (סריאלי)"
                   value={filters.itemSerial || ""}
                   onChange={(val) => handleFilterChange({ itemSerial: val || null })}
                   width={180}
                   placeholder="חפש סריאלי..."
                />

                  <SearchFilter
                   label="מס' עובד"
                   value={filters.workerId || ""}
                   onChange={(val) => handleFilterChange({ workerId: val || null })}
                   width={150}
                   placeholder="חפש עובד..."
                />
            </FilterContainer>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ flex: 1, minHeight: 0, mt: 1 }}>
             <AverageTimesChart 
                data={data} 
                loading={loading} 
                period={averageTimesPeriod}
                onPeriodChange={setAverageTimesPeriod}
             />
        </Box>
    </Box>
  );
}
