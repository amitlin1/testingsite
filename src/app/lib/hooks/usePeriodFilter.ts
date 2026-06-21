"use client";
import * as React from "react";
import { PeriodOption, calculatePeriodDates, buildPeriodOptions } from "@/app/lib/date-periods";

/**
 * Custom hook for period filtering in dashboard charts
 * Provides period options, selected period, and calculated dates
 * 
 * Usage:
 * const { periodOptions, selectedPeriod, handlePeriodChange, startDate, endDate } = usePeriodFilter();
 */
export function usePeriodFilter() {
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodOption | null>(null);
  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");

  // Build period options directly - no need to fetch available dates
  // We'll generate options for current year and previous 2 years
  const periodOptions = React.useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2];
    return buildPeriodOptions(years);
  }, []);

  // Set default period (30 days) when options are loaded
  React.useEffect(() => {
    if (periodOptions.length > 0 && !selectedPeriod) {
      setSelectedPeriod(periodOptions[0]);
    }
  }, [periodOptions, selectedPeriod]);

  // Calculate dates when period changes
  React.useEffect(() => {
    if (selectedPeriod) {
      const dates = calculatePeriodDates(selectedPeriod);
      setStartDate(dates.startDate);
      setEndDate(dates.endDate);
    }
  }, [selectedPeriod]);

  const handlePeriodChange = (newPeriod: PeriodOption | null) => {
    setSelectedPeriod(newPeriod);
  };

  return {
    periodOptions,
    selectedPeriod,
    handlePeriodChange,
    startDate,
    endDate,
  };
}

