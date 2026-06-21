import { DateRangePreset } from "@/types/dashboard";

/**
 * Calculates a date range from a preset or custom dates.
 * Shared across all dashboard pages.
 */
export function getDateRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (preset === "custom") {
    if (!customStart || !customEnd) return { startDate: "", endDate: "" };
    const [startYear, startMonth, startDay] = customStart.split("-").map(Number);
    const [endYear, endMonth, endDay] = customEnd.split("-").map(Number);
    startDate = new Date(startYear, startMonth - 1, startDay);
    endDate = new Date(endYear, endMonth - 1, endDay);

    if (customStart === customEnd) {
      startDate.setHours(7, 0, 0, 0);
      endDate.setHours(16, 0, 0, 0);
    } else {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }
  } else {
    switch (preset) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0, 0);
        break;
      case "last7days":
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "last30days":
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 29);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        endDate = new Date();
        startDate = new Date();
    }
  }

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}
