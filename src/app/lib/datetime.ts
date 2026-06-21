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

/**
 * Calculates the total work duration between two timestamps, considering only work hours (07:00 - 15:30).
 * Weekends are NOT excluded (as per current requirement).
 * 
 * @param startIso - Start timestamp (UTC ISO string)
 * @param endIso - End timestamp (UTC ISO string)
 * @returns Duration in milliseconds, or 0 if invalid
 */
export function calculateWorkDuration(startIso: string | null | undefined, endIso: string | null | undefined): number {
  if (!startIso || !endIso) return 0;

  const start = new Date(startIso);
  const end = new Date(endIso);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (start >= end) return 0;

  let totalMs = 0;
  const current = new Date(start);

  // Work start/end minutes from midnight (07:00 = 420, 15:30 = 930)
  const WORK_START_MIN = 7 * 60;
  const WORK_END_MIN = 15 * 60 + 30;

  const getIlMinutes = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(d);

    let h = 0, m = 0;
    parts.forEach(p => {
      if (p.type === 'hour') h = parseInt(p.value);
      if (p.type === 'minute') m = parseInt(p.value);
    });
    if (h === 24) h = 0;
    return h * 60 + m;
  };

  // Limit iterations to avoid infinite loops (max 100 days approx)
  let safety = 0;
  while (current < end && safety < 100000) {
    safety++;
    const currentMinutes = getIlMinutes(current);

    if (currentMinutes >= WORK_START_MIN && currentMinutes < WORK_END_MIN) {
      const minsLeftInWorkDay = WORK_END_MIN - currentMinutes;

      // Check if end is today (simple check: if time diff is less than remaining work day)
      // Actually, more robust: check if end is within "minsLeftInWorkDay" minutes.
      const diffMs = end.getTime() - current.getTime();
      const remainingWorkMs = minsLeftInWorkDay * 60 * 1000;

      if (diffMs <= remainingWorkMs) {
        // End is within this work block (or at least strictly before the end of work day)
        // But wait, "strictly before" in time doesn't mean same day, but if diff is small enough, it effectively is.
        // Actually, if diffMs <= remainingWorkMs, and we are currently in work hours,
        // and the "end" time assumes continuous time...
        // YES, if we are in work hours, any time forward up to end of work hours IS work time.
        // Since `end` is just a timestamp, if `end` is closer than the end of the workday, then all that duration is work time.
        totalMs += diffMs;
        break;
      } else {
        // The end is further away than the end of this work day.
        // Add the full remainder of this work day.
        totalMs += remainingWorkMs;
        // Advance current to end of work day + 1ms/minute?
        // Or just advance by remainingWorkMs.
        current.setTime(current.getTime() + remainingWorkMs);
        // Now current is at 15:30.
      }
    }

    // Move to next valid start time?
    // If current is at 15:30, move to tomorrow 07:00?
    // Or just step 1 hour if we are outside work hours.
    const check = getIlMinutes(current);
    if (check >= WORK_END_MIN || check < WORK_START_MIN) {
      // Outside work hours.
      // Move forward 15 mins?
      current.setTime(current.getTime() + 15 * 60 * 1000);
    }
  }

  return totalMs;
}

