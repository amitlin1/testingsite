import { formatUtcToLocal } from "@/app/lib/datetime";

/*
 * One date vocabulary for the item screens (the items table, the item dialog,
 * its files panel and the item history page), so the same moment never reads
 * two ways on two screens. Both are thin presets over the app's one formatter
 * (formatUtcToLocal: he-IL, Asia/Jerusalem) — no new date logic here.
 * A missing value is an em dash, never "-" or "Invalid Date".
 */

const EM_DASH = "—";

/** Date + time without seconds — the screens compare moments, not ticks. */
export function formatMoment(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const s = formatUtcToLocal(iso, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: undefined,
    hour12: false,
  });
  return s === "-" ? EM_DASH : s;
}

/** Date only — table columns and the route stepper, where a time has no room. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const s = formatUtcToLocal(iso, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: undefined,
    minute: undefined,
    second: undefined,
  });
  return s === "-" ? EM_DASH : s;
}
