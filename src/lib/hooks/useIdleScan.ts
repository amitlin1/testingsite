"use client";
import { useCallback, useEffect, useRef } from "react";

/** How long a scan field waits after the last keystroke before it reads what
 *  arrived as one scan. A scanner types a whole code in a burst; some send no
 *  Enter at the end, so a burst that stops is the scan's end. */
export const SCAN_IDLE_MS = 300;

/**
 * The idle half of a scan field: `schedule(read)` after each change (a new
 * keystroke restarts the wait), `cancel()` when Enter reads the field first,
 * so a scan is never read twice. The pending read is dropped on unmount.
 */
export function useIdleScan(delay = SCAN_IDLE_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback((read: () => void) => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      read();
    }, delay);
  }, [cancel, delay]);
  useEffect(() => cancel, [cancel]);
  return { schedule, cancel };
}
