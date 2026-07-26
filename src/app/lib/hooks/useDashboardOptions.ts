"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { CustomerOption, Option } from "@/types/dashboard";

export interface DashboardOptions {
  customers: CustomerOption[];
  stations: Option[];
  stationTypes: Option[];
  itemTypes: Option[];
  shipments: any[];
  loading: boolean;
}

/**
 * Shared hook to fetch filter dropdown options for dashboard pages.
 * Fetches customers, stations, station types, item types, and shipments once on mount.
 */
export function useDashboardOptions(): DashboardOptions {
  const [customers, setCustomers] = React.useState<CustomerOption[]>([]);
  const [stations, setStations] = React.useState<Option[]>([]);
  const [stationTypes, setStationTypes] = React.useState<Option[]>([]);
  const [itemTypes, setItemTypes] = React.useState<Option[]>([]);
  const [shipments, setShipments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [customersRes, stationsRes, stationTypesRes, itemTypesRes, shipmentsRes] =
          await Promise.all([
            apiFetch("/api/customers"),
            apiFetch("/api/stations"),
            apiFetch("/api/testing/stations/types"),
            apiFetch("/api/item-types"),
            apiFetch("/api/shipments"),
          ]);

        if (customersRes.ok) setCustomers(await customersRes.json());
        if (stationsRes.ok) setStations(await stationsRes.json());
        if (stationTypesRes.ok) setStationTypes(await stationTypesRes.json());
        if (itemTypesRes.ok) setItemTypes(await itemTypesRes.json());
        if (shipmentsRes.ok) setShipments(await shipmentsRes.json());
      } catch (error) {
        console.error("Error fetching dashboard options:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchOptions();
  }, []);

  return { customers, stations, stationTypes, itemTypes, shipments, loading };
}
