"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Screen filters kept in the URL query, so a filtered screen survives a
 * refresh, the back button and a shared link — and other screens can deep
 * link into it (/packages?shipment=12, /testing?item=…).
 *
 * `defaults` names every key the screen owns and its empty value; a key at its
 * default is left out of the URL. Updates use router.replace (no history entry
 * per keystroke) and keep any query key the screen does not own.
 */
export function useUrlState<K extends string>(defaultsArg: Record<K, string>) {
  // A literal per screen, re-created each render: kept as first given, so it is a stable dep.
  const [defaults] = React.useState(defaultsArg);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const values = React.useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of Object.keys(defaults) as K[]) out[k] = sp.get(k) ?? defaults[k];
    return out;
  }, [sp, defaults]);

  // Several set() calls in one tick must build on each other, not on the
  // render-time query string.
  const pendingRef = React.useRef<URLSearchParams | null>(null);

  const set = React.useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = pendingRef.current ?? new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v == null || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      pendingRef.current = next;
      queueMicrotask(() => {
        const qs = pendingRef.current?.toString() ?? "";
        pendingRef.current = null;
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [sp, pathname, router, defaults],
  );

  return [values, set] as const;
}

/**
 * A text field mirrored into one URL key: the field updates on every
 * keystroke, the URL after a short pause. A change of the key from outside
 * (back button, a link, a programmatic clear) refills the field; our own
 * write does not, so no keystroke typed during the pause is lost.
 */
export function useUrlTextField(urlValue: string, write: (v: string) => void, delayMs = 250) {
  const [input, setInput] = React.useState(urlValue);
  const lastWritten = React.useRef(urlValue);
  React.useEffect(() => {
    if (urlValue !== lastWritten.current) {
      lastWritten.current = urlValue;
      setInput(urlValue);
    }
  }, [urlValue]);
  React.useEffect(() => {
    if (input === urlValue) return;
    const t = setTimeout(() => {
      lastWritten.current = input;
      write(input);
    }, delayMs);
    return () => clearTimeout(t);
  }, [input, urlValue, write, delayMs]);
  return [input, setInput] as const;
}
