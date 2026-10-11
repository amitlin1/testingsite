"use client";
import * as React from "react";

/**
 * Keyboard-wedge barcode scanner at document level (DESIGN_AUDIT X7 / A11-7).
 *
 * A hardware scanner "types" the code as a burst of keystrokes a few ms apart
 * and ends it with Enter. On the testing screen the scan field sits behind the
 * dock / a dialog, so a scan with nothing focused used to go nowhere. This hook
 * listens on the window and, ONLY when nothing editable has focus and no
 * dialog / menu / listbox is open, collects such a burst and hands the code to
 * `onScan` — the page's existing barcode handler. It adds no endpoint and no
 * behaviour of its own: a code is either delivered to that handler or ignored.
 *
 * What counts as a scan: printable keys arriving < MAX_GAP_MS apart, at least
 * MIN_LENGTH of them, ended by Enter inside the same burst. People type far
 * slower (~80ms+ between keys), so normal typing and shortcuts never match.
 */
const MAX_GAP_MS = 40;
const MIN_LENGTH = 4;

// Focus inside one of these means the keys belong to that control.
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// While any of these is open the keys belong to it (Radix dialogs carry
// role="dialog"; the ui Menu / Autocomplete only render their lists when open).
const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]';

function keysBelongElsewhere(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || el.matches(EDITABLE))) return true;
  return document.querySelector(OPEN_LAYER) != null;
}

/**
 * @param onScan  receives the scanned code (untrimmed, exactly as typed).
 * @param enabled false while the page knows a layer the DOM check can't see
 *                is open (e.g. a hand-rolled wizard overlay).
 */
export function useGlobalScanner(onScan: (code: string) => void, enabled = true) {
  // Latest handler without re-binding the listener on every render.
  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  React.useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || keysBelongElsewhere()) {
        buffer = "";
        return;
      }
      const inBurst = buffer !== "" && e.timeStamp - last < MAX_GAP_MS;

      if (e.key === "Enter") {
        if (inBurst && buffer.length >= MIN_LENGTH) {
          // Capture phase + preventDefault: the Enter must not also press
          // whatever button happens to have focus.
          e.preventDefault();
          e.stopPropagation();
          const code = buffer;
          buffer = "";
          onScanRef.current(code);
        } else {
          buffer = "";
        }
        return;
      }

      // Shift (scanners send it for capitals) and other non-printing keys
      // neither extend nor break a burst.
      if (e.key.length !== 1) return;

      buffer = inBurst ? buffer + e.key : e.key;
      last = e.timeStamp;
      // Inside a burst keep the keys from the focused element (a Space would
      // press a focused button). The first key of a burst can't be told apart
      // from normal typing yet, so it passes through untouched.
      if (inBurst) e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
