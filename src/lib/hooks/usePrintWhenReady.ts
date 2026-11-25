"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Print once what the print content shows has been rendered. `request()` from
 * an event that also changes that content (the data of a hidden document, the
 * preview shown): the print runs after React commits the change, never on a
 * timer that hopes the render is done.
 */
export function usePrintWhenReady(print: () => void) {
  const wanted = useRef(false);
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (!wanted.current) return;
    wanted.current = false;
    print();
  }, [requests, print]);
  return useCallback(() => {
    wanted.current = true;
    setRequests((n) => n + 1);
  }, []);
}
