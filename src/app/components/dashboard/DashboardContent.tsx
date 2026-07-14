"use client";
import * as React from "react";
import { Grid, Paper, Typography, alpha } from "@/components/ui";
import { 
  DashboardKpis, 
  // TimeSeriesPoint, // COMMENTED: TimeSeriesChart component is disabled
  StationLoadRow, 
  SlowItemRow,
  ShipmentTrackingRow,
  ItemTypeTrackingRow,
  StatusDistribution,
  CustomerPerformanceRow,
  // DailyTrendPoint, // COMMENTED: DailyTrendsChart disabled
  AverageTimesPoint,
  AverageTimesPeriod
} from "@/types/dashboard";
import KpiCards from "@/app/components/dashboard/KpiCards";
// import TimeSeriesChart from "@/app/components/dashboard/TimeSeriesChart"; // COMMENTED: Component disabled - user doesn't want it
import StationLoadTable from "@/app/components/dashboard/StationLoadTable";
import SlowItemsTable from "@/app/components/dashboard/SlowItemsTable";
import ShipmentTrackingTable from "@/app/components/dashboard/ShipmentTrackingTable";
import ItemTypeTrackingTable from "@/app/components/dashboard/ItemTypeTrackingTable";
import StatusDistributionChart from "@/app/components/dashboard/StatusDistributionChart";
import CustomerPerformanceTable from "@/app/components/dashboard/CustomerPerformanceTable";
// import DailyTrendsChart from "@/app/components/dashboard/DailyTrendsChart"; // COMMENTED: DailyTrendsChart disabled - shipment_snapshots_daily table missing
import AverageTimesChart from "@/app/components/dashboard/AverageTimesChart";

interface DashboardContentProps {
  kpis: DashboardKpis | null;
  // timeSeries: TimeSeriesPoint[]; // REMOVED: TimeSeriesChart component is disabled - user doesn't want it
  stationLoad: StationLoadRow[];
  slowItems: SlowItemRow[];
  shipments: ShipmentTrackingRow[];
  itemTypes: ItemTypeTrackingRow[];
  statusDistribution: StatusDistribution[];
  customerPerformance: CustomerPerformanceRow[];
  // dailyTrends: DailyTrendPoint[]; // COMMENTED: DailyTrendsChart disabled
  averageTimes: AverageTimesPoint[];
  averageTimesPeriod: AverageTimesPeriod;
  onAverageTimesPeriodChange: (period: AverageTimesPeriod) => void;
  loading: boolean;
  error: string | null;
  filters?: {
    customerId: number | null;
    shipmentId: number | null;
    itemTypeId: number | null;
    testStationId: number | null;
  };
}

export default function DashboardContent({
  kpis,
  // timeSeries, // COMMENTED: TimeSeriesChart component is disabled
  stationLoad,
  slowItems,
  shipments,
  itemTypes,
  statusDistribution,
  customerPerformance,
  // dailyTrends, // COMMENTED: DailyTrendsChart disabled
  averageTimes,
  averageTimesPeriod,
  onAverageTimesPeriodChange,
  loading,
  error,
  filters,
}: DashboardContentProps) {
  const [stationLoadViewMode, setStationLoadViewMode] = React.useState<"table" | "chart">("table");
  const [shipmentTrackingViewMode, setShipmentTrackingViewMode] = React.useState<"table" | "chart">("table");

  return (
    <>
      {/* Error message */}
      {error && (
        <Paper
          elevation={1}
          sx={{
            p: 1.5,
            mb: 2,
            bgcolor: alpha("#E53935", 0.1),
            border: `1px solid ${alpha("#E53935", 0.3)}`,
            borderRadius: 2,
            direction: "rtl",
          }}
        >
          <Typography color="error" sx={{ fontWeight: 500, textAlign: "right", fontSize: { xs: "0.875rem", sm: "0.9rem" }, direction: "rtl" }}>
            {error}
          </Typography>
        </Paper>
      )}

      {/* KPI Cards */}
      <KpiCards kpis={kpis} loading={loading} />

      {/* Charts and Tables */}
      <Grid container spacing={2} sx={{ width: "100%", maxWidth: "100%", margin: 0, direction: "rtl" }}>
        {/* Time Series Chart - COMMENTED: Component disabled - user doesn't want it */}
        {/* <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <TimeSeriesChart data={timeSeries} loading={loading} />
        </Grid> */}

        {/* Daily Trends Chart - COMMENTED: DailyTrendsChart disabled - shipment_snapshots_daily table missing */}
        {/* <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <DailyTrendsChart data={dailyTrends} loading={loading} />
        </Grid> */}

        {/* Average Times Chart */}
        <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <AverageTimesChart 
            data={averageTimes} 
            loading={loading} 
            period={averageTimesPeriod}
            onPeriodChange={onAverageTimesPeriodChange}
          />
        </Grid>

        {/* Status Distribution Chart and Shipment Tracking Table - Side by Side */}
        <Grid size={{ xs: 12, md: 6 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <StatusDistributionChart data={statusDistribution} loading={loading} filters={filters} />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <ShipmentTrackingTable 
            data={shipments} 
            loading={loading} 
            viewMode={shipmentTrackingViewMode}
            onViewModeChange={setShipmentTrackingViewMode}
          />
        </Grid>

        {/* Item Type Tracking Table */}
        <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <ItemTypeTrackingTable data={itemTypes} loading={loading} />
        </Grid>

        {/* Station Load Table */}
        <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <StationLoadTable 
            data={stationLoad} 
            loading={loading} 
            viewMode={stationLoadViewMode}
            onViewModeChange={setStationLoadViewMode}
          />
        </Grid>

        {/* Customer Performance Table */}
        <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <CustomerPerformanceTable data={customerPerformance} loading={loading} />
        </Grid>

        {/* Slow Items Table */}
        <Grid size={{ xs: 12 }} sx={{ width: "100%", maxWidth: "100%", minHeight: 0 }}>
          <SlowItemsTable data={slowItems} loading={loading} />
        </Grid>
      </Grid>
    </>
  );
}
