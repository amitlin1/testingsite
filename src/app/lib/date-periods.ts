/**
 * Utility functions for calculating date ranges based on period selections
 * Works with daily snapshots - returns available data within the requested period
 */

export type PeriodType = "days" | "months" | "years" | "year";

export interface PeriodOption {
  label: string;
  type: PeriodType;
  value: number | string; // number for days/months/years, string for specific year (e.g. "2024")
}

/**
 * Calculate start and end dates based on period option
 * Returns dates that can be used to query snapshots
 */
export function calculatePeriodDates(period: PeriodOption): { startDate: string; endDate: string } {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const endDate = today.toISOString().split('T')[0];
  let startDate = "";

  switch (period.type) {
    case "days":
      const daysStart = new Date(today);
      daysStart.setDate(daysStart.getDate() - (period.value as number));
      daysStart.setHours(0, 0, 0, 0);
      startDate = daysStart.toISOString().split('T')[0];
      break;

    case "months":
      const monthsStart = new Date(today);
      monthsStart.setMonth(monthsStart.getMonth() - (period.value as number));
      monthsStart.setHours(0, 0, 0, 0);
      startDate = monthsStart.toISOString().split('T')[0];
      break;

    case "years":
      const yearsStart = new Date(today);
      yearsStart.setFullYear(yearsStart.getFullYear() - (period.value as number));
      yearsStart.setHours(0, 0, 0, 0);
      startDate = yearsStart.toISOString().split('T')[0];
      break;

    case "year":
      // Specific year - from Jan 1 to Dec 31
      const year = parseInt(period.value as string);
      startDate = `${year}-01-01`;
      const endDateForYear = new Date(year, 11, 31, 23, 59, 59);
      endDateForYear.setHours(23, 59, 59, 999);
      const endDateStr = endDateForYear.toISOString().split('T')[0];
      return { startDate, endDate: endDateStr };

    default:
      // Default: 30 days
      const defaultStart = new Date(today);
      defaultStart.setDate(defaultStart.getDate() - 30);
      defaultStart.setHours(0, 0, 0, 0);
      startDate = defaultStart.toISOString().split('T')[0];
  }

  return { startDate, endDate };
}

/**
 * Build period options list with available years
 */
export function buildPeriodOptions(availableYears: number[]): PeriodOption[] {
  const options: PeriodOption[] = [
    { label: "30 ימים אחרונים", type: "days", value: 30 },
    { label: "12 חודשים אחרונים", type: "months", value: 12 },
    { label: "3 שנים אחרונות", type: "years", value: 3 },
  ];

  // Add year options
  availableYears.forEach((year) => {
    options.push({
      label: `שנת ${year}`,
      type: "year",
      value: String(year),
    });
  });

  return options;
}

