"use client";
import * as React from "react";

/**
 * This browser's clock, read again every `stepMs` — for a relative time ("לפני 3 דקות") that has to
 * move while the screen stays open. One timer per step, shared by every reader of it, running while
 * anyone reads it. 0 on the server.
 */
type Clock = { subscribe: (onTick: () => void) => () => void; read: () => number };

const clocks = new Map<number, Clock>();

function makeClock(stepMs: number): Clock {
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  return {
    read: () => now,
    subscribe(onTick) {
      if (listeners.size === 0) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          for (const l of [...listeners]) l();
        }, stepMs);
      }
      listeners.add(onTick);
      return () => {
        listeners.delete(onTick);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

function clockOf(stepMs: number): Clock {
  let clock = clocks.get(stepMs);
  if (!clock) {
    clock = makeClock(stepMs);
    clocks.set(stepMs, clock);
  }
  return clock;
}

const serverNow = () => 0;

export function useNow(stepMs: number): number {
  const { subscribe, read } = clockOf(stepMs);
  return React.useSyncExternalStore(subscribe, read, serverNow);
}
