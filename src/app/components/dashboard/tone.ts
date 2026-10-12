import { DASH_COLORS } from "@/app/lib/dashboard/format";

/**
 * The threshold functions in lib/dashboard/format (deltaTone, stuckTone…)
 * return the status FILL colours — right for a sparkline stroke or a bar. Text
 * painted in a status colour uses its *-ink token instead (AA on white), so a
 * tone that colours TEXT goes through here. Only green differs: the amber tone
 * is already the warning ink, and red is the destructive ink.
 */
export function textTone(tone: string): string {
  return tone === DASH_COLORS.green ? "var(--color-success-ink)" : tone;
}
