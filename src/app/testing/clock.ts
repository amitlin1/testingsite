import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { netSecondsBetween, type WorkWindowsWire } from "@/app/lib/dashboard/work-clock";

// The testing screen's timers count NET time: only the seconds inside working
// hours, so a timer stands still at night, at the weekend and on a holiday.
// The working windows come from the work calendar (GET /api/work-clock/windows)
// — the same windows every dashboard figure is computed from — loaded once for
// the whole screen and re-read every 30 minutes, so a change on the work-hours
// screen reaches an open station without a reload.

// A one-second tick, read through useSyncExternalStore so render stays pure.
// The server render has no clock (null), so it draws no time.
const subscribeSecond = (onTick: () => void) => {
  const interval = setInterval(onTick, 1000);
  return () => clearInterval(interval);
};
const noClock = () => null;
const noSubscribe = () => () => {};

// ---- the working windows, one copy for every timer on the screen ----------

const REFRESH_MS = 30 * 60_000;
/** null = not loaded yet; built:false = no work calendar, so net time cannot be counted. */
let calendar: { built: boolean; windows: Float64Array } | null = null;
let loading = false;
let refresh: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function loadWindows(): void {
  if (loading) return;
  loading = true;
  apiFetch("/api/work-clock/windows")
    .then((r) => (r.ok ? (r.json() as Promise<WorkWindowsWire>) : Promise.reject(new Error(String(r.status)))))
    .then((d) => {
      calendar = { built: d.built, windows: Float64Array.from(d.windows) };
      listeners.forEach((l) => l());
    })
    .catch(() => {}) // keep the last copy; the next refresh tries again
    .finally(() => {
      loading = false;
    });
}

function subscribeWindows(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!calendar) loadWindows();
  refresh ??= setInterval(loadWindows, REFRESH_MS);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && refresh) {
      clearInterval(refresh);
      refresh = null;
    }
  };
}
const readWindows = () => calendar;

/** Whole NET seconds since `since` (working hours only), ticking every second; 0 for a start in
 *  the future; null without a valid start, before the working windows have loaded, with no work
 *  calendar, and in the server render. Each timer on the screen owns its tick, so nothing else
 *  re-renders. */
export function useNetSeconds(since: string | null | undefined): number | null {
  const cal = React.useSyncExternalStore(subscribeWindows, readWindows, noClock);
  const start = since ? new Date(since).getTime() : NaN;
  const ticking = !isNaN(start) && cal?.built === true;
  const read = React.useCallback(
    () => (cal ? Math.floor(netSecondsBetween(cal.windows, start, Date.now())) : null),
    [cal, start],
  );
  const seconds = React.useSyncExternalStore(ticking ? subscribeSecond : noSubscribe, ticking ? read : noClock, noClock);
  return seconds;
}
