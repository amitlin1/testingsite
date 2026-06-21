/**
 * Shared status ID to Hebrew name mapping.
 * Used across dashboard components and API routes.
 */
export const STATUS_NAMES: Record<number, string> = {
  1: "בבדיקה",
  2: "ממתין",
  3: "הושלם",
  4: "ממתין למחקר",
  5: "במחקר",
};

/**
 * Get status name by ID (string or number).
 * Falls back to "סטטוס {id}" for unknown statuses.
 */
export function getStatusName(statusId: string | number): string {
  const id = typeof statusId === "string" ? parseInt(statusId, 10) : statusId;
  return STATUS_NAMES[id] || `סטטוס ${statusId}`;
}

/**
 * All known status names as an array (for ensuring chart lines exist).
 */
export const ALL_STATUS_NAMES = Object.values(STATUS_NAMES);
