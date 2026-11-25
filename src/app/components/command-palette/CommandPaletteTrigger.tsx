"use client";

import * as React from "react";
import { Search } from "lucide-react";
import CommandPalette from "./CommandPalette";

/**
 * Top-bar search affordance: a button styled to read as an input, plus the
 * global Ctrl/Cmd+K listener and the palette itself.
 *
 * It is a button, not an <input>, on purpose — the real input lives inside the
 * palette. A focusable text field in the bar that does nothing until you type
 * is the pattern this replaces.
 */
const noSubscribe = () => () => {};
const readIsMac = () => /mac/i.test(navigator.platform);
const notMac = () => false;

export default function CommandPaletteTrigger() {
  const [open, setOpen] = React.useState(false);
  // navigator is client-only; the server snapshot (false) is what SSR and
  // hydration use, so they agree (otherwise the "Ctrl K" label
  // hydration-mismatches on macOS), and the real platform follows after.
  const isMac = React.useSyncExternalStore(noSubscribe, readIsMac, notMac);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Match on e.code (PHYSICAL key), not e.key (the character the layout
      // produces). On a Hebrew layout the K key emits "ל", so the usual
      // `e.key === "k"` check never fires — which is exactly how this shortcut
      // came to be dead in this app. e.key stays as a fallback for layouts
      // where code is unavailable/synthetic.
      const isK = e.code === "KeyK" || e.key?.toLowerCase() === "k";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // "/" is the other muscle-memory search key — again by physical key, and
      // only when the user isn't already typing somewhere.
      if ((e.code === "Slash" || e.key === "/") && !e.ctrlKey && !e.metaKey && !open) {
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="cp-trigger"
        onClick={() => setOpen(true)}
        aria-label="פתיחת חיפוש כללי"
        aria-haspopup="dialog"
        aria-expanded={open}
        // The shortcut, said once for assistive tech (the <kbd> is visual).
        aria-keyshortcuts={isMac ? "Meta+K /" : "Control+K /"}
      >
        <Search size={16} strokeWidth={1.9} aria-hidden />
        <span className="cp-trigger-text">חיפוש מארז, פריט, משלוח או עמדה</span>
        <kbd className="cp-trigger-kbd" aria-hidden>{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
