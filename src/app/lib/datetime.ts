/**
 * Centralized datetime utilities for consistent time handling across the application.
 * 
 * Strategy:
 * - All timestamps in DB are stored in UTC
 * - APIs always send/receive time as ISO 8601 strings in UTC (ending with Z)
 * - Frontend converts for display according to user's timezone (default: Asia/Jerusalem)
 */

/**
 * Display timezone - can be changed to browser default or another timezone
 */
export const DISPLAY_TIMEZONE = "Asia/Jerusalem";

/**
 * Normalizes a date value to UTC ISO string.
 * Handles various input formats (Date, string, null, undefined).
 * 
 * @param date - Date value to normalize (can be Date, string, null, or undefined)
 * @returns UTC ISO string (e.g., "2025-11-25T19:45:00.000Z") or null if input is null/undefined
 */
export function normalizeToUtcIso(date: Date | string | null | undefined): string | null {
  if (!date) {
    return null;
  }

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return null;
    }

    return dateObj.toISOString();
  } catch (error) {
    console.error("Error normalizing date to UTC ISO:", error);
    return null;
  }
}

/**
 * Formats a UTC ISO string for display in the configured timezone.
 * 
 * @param utcIsoString - UTC ISO string (e.g., "2025-11-25T19:45:00.000Z")
 * @param options - Intl.DateTimeFormatOptions for custom formatting
 * @returns Formatted date string in local timezone, or "-" if input is invalid
 */
export function formatUtcToLocal(
  utcIsoString: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!utcIsoString) {
    return "-";
  }

  try {
    const date = new Date(utcIsoString);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "-";
    }

    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: DISPLAY_TIMEZONE,
    };

    return new Intl.DateTimeFormat("he-IL", {
      ...defaultOptions,
      ...options,
    }).format(date);
  } catch (error) {
    console.error("Error formatting UTC to local:", error);
    return "-";
  }
}

/**
 * Formats a UTC ISO string for display with date and time (full format).
 * 
 * @param utcIsoString - UTC ISO string
 * @returns Formatted string like "25/11/2025, 21:45:00" or "-"
 */
export function formatDateTime(utcIsoString: string | null | undefined): string {
  return formatUtcToLocal(utcIsoString);
}

/**
 * Formats a UTC ISO string for display with date only.
 * 
 * @param utcIsoString - UTC ISO string
 * @returns Formatted string like "25/11/2025" or "-"
 */
export function formatDate(utcIsoString: string | null | undefined): string {
  return formatUtcToLocal(utcIsoString, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: undefined,
    minute: undefined,
    second: undefined,
  });
}

/**
 * Formats a UTC ISO string for display with time only.
 * 
 * @param utcIsoString - UTC ISO string
 * @returns Formatted string like "21:45:00" or "-"
 */
export function formatTime(utcIsoString: string | null | undefined): string {
  return formatUtcToLocal(utcIsoString, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: undefined,
    month: undefined,
    day: undefined,
  });
}

/**
 * Gets current UTC time as ISO string.
 * 
 * @returns Current UTC time as ISO string (e.g., "2025-11-25T19:45:00.000Z")
 */
export function getCurrentUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Converts a local datetime input (from datetime-local input) to UTC ISO string.
 * 
 * @param localDateTimeString - Local datetime string from input (e.g., "2025-11-25T21:45")
 * @returns UTC ISO string or null if input is invalid
 */
export function localDateTimeToUtcIso(localDateTimeString: string | null | undefined): string | null {
  if (!localDateTimeString) {
    return null;
  }

  try {
    // Create date from local string (browser interprets as local time)
    const localDate = new Date(localDateTimeString);

    if (isNaN(localDate.getTime())) {
      return null;
    }

    return localDate.toISOString();
  } catch (error) {
    console.error("Error converting local datetime to UTC ISO:", error);
    return null;
  }
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * 
 * @param milliseconds - Duration in milliseconds
 * @param format - Format style: "short" (e.g., "12m 30s") or "long" (e.g., "01:23:45")
 * @returns Formatted duration string or "-" if input is invalid
 */
export function formatDuration(milliseconds: number | null | undefined, format: "short" | "long" = "long"): string {
  if (milliseconds === null || milliseconds === undefined || isNaN(milliseconds) || milliseconds < 0) {
    return "-";
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (format === "short") {
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  } else {
    // Long format: HH:MM:SS
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
}
