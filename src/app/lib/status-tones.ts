/**
 * One status → tone map, so every screen paints an item status the same way
 * (the Items table, the item history, the summary tiles, the testing queue).
 * The tones follow the package artboards' STATES: waiting is amber, in test is
 * blue, done is green. Text stays ink; the tone colours a dot or a fill.
 */
import { STATUS_NAMES } from "./status-names";

export type StatusTone = "waiting" | "active" | "done" | "neutral";

export const STATUS_TONE: Record<number, StatusTone> = {
  1: "active",   // בבדיקה
  2: "waiting",  // ממתין
  3: "done",     // הושלם
  4: "waiting",  // ממתין למחקר
  5: "active",   // במחקר
  6: "waiting",  // ממתין לפריטי המארז
};

export function toneOfStatus(statusId: number | string | null | undefined): StatusTone {
  const id = typeof statusId === "string" ? parseInt(statusId, 10) : statusId;
  return (id != null && STATUS_TONE[id]) || "neutral";
}

/** Dot / fill colour per tone (graphics: each clears 3:1 on white). */
export const TONE_DOT: Record<StatusTone, string> = {
  waiting: "var(--color-status-late)",
  active: "var(--color-primary)",
  done: "var(--color-status-approved)",
  neutral: "var(--color-ink-muted-48)",
};

export { STATUS_NAMES };
