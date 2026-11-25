"use client";
import { useCallback, useSyncExternalStore } from "react";

/** SSR-safe media query: false on the server and the first paint (desktop), then the real answer. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!query || typeof window === "undefined" || !window.matchMedia) return () => {};
      const mm = window.matchMedia(query);
      mm.addEventListener("change", onChange);
      return () => mm.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => (query && typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
