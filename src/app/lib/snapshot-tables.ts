/**
 * Utility functions for selecting the correct snapshot table based on date range
 */

/**
 * Determine which snapshot table to use based on date range
 * - <= 90 days: daily snapshots
 * - > 90 days and <= 365 days: monthly snapshots
 * - > 365 days: quarterly snapshots
 */
export function getSnapshotTableName(baseTableName: string, startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff > 90) {
    // More than 3 months - use monthly (Quarterly logic will filter this data later)
    return `${baseTableName}_monthly`;
  } else {
    // <= 90 days - use daily
    return baseTableName;
  }
}

/**
 * Get snapshot table names for all snapshot types
 */
export const SNAPSHOT_TABLES = {
  shipment: 'shipment_snapshots',
  customer: 'customer_snapshots',
  station: 'station_snapshots',
  itemType: 'item_type_snapshots',
  statusDistribution: 'status_distribution_snapshots',
  kpi: 'kpi_snapshots',
} as const;

