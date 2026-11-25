import * as React from "react";

// A one-second tick, read through useSyncExternalStore so render stays pure.
// The server render has no clock (null), so it draws no time.
const subscribeSecond = (onTick: () => void) => {
  const interval = setInterval(onTick, 1000);
  return () => clearInterval(interval);
};
const noClock = () => null;
const noSubscribe = () => () => {};

/** Whole seconds since `since`, ticking every second; null without a valid start, before it, and
 *  in the server render. Each timer on the screen owns its tick, so nothing else re-renders. */
export function useElapsedSeconds(since: string | null | undefined): number | null {
  const start = since ? new Date(since).getTime() : NaN;
  const ticking = !isNaN(start);
  const read = React.useCallback(() => Math.floor((Date.now() - start) / 1000), [start]);
  const seconds = React.useSyncExternalStore(ticking ? subscribeSecond : noSubscribe, ticking ? read : noClock, noClock);
  return seconds === null || seconds < 0 ? null : seconds;
}
