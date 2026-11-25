"use client";

import * as React from "react";

// A boolean preference kept in localStorage under `key`.
//
// Storage is read once, the first time a mounted component asks, and the value
// is then held in memory until the component unmounts — so a toggle in another
// browser tab never flips this one, and the next visit reads storage again. The
// in-memory copy is also what keeps the toggle working when storage throws
// (private mode). The server render, and hydration, use `defaultValue`.
//
// Written as "true" / "false". "1" also reads as true: the app shell's rail
// stored "1" / "0" before it used this hook.

const values = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string, defaultValue: boolean): boolean {
  const known = values.get(key);
  if (known !== undefined) return known;
  let value = defaultValue;
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) value = stored === "true" || stored === "1";
  } catch {
    /* storage unavailable — keep the default */
  }
  values.set(key, value);
  return value;
}

function write(key: string, value: boolean): void {
  values.set(key, value);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable — the in-memory copy still holds it */
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** Takes the new value, or a function of the current one (a toggle). */
export type SetFlag = (next: boolean | ((current: boolean) => boolean)) => void;

export function useLocalStorageFlag(key: string, { defaultValue }: { defaultValue: boolean }): [boolean, SetFlag] {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [key],
  );
  const value = React.useSyncExternalStore(
    subscribe,
    () => read(key, defaultValue),
    () => defaultValue,
  );
  React.useEffect(
    () => () => {
      values.delete(key);
    },
    [key],
  );
  const setValue = React.useCallback<SetFlag>(
    (next) => write(key, typeof next === "function" ? next(read(key, defaultValue)) : next),
    [key, defaultValue],
  );
  return [value, setValue];
}
