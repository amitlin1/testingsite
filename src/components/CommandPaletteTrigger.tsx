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
export default function CommandPaletteTrigger() {
  const [open, setOpen] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);

  // navigator is client-only; read it after mount so SSR and the first client
  // render agree (otherwise the "Ctrl K" label hydration-mismatches on macOS).
  React.useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform));
  }, []);

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
      >
        <Search size={16} strokeWidth={1.9} />
        <span className="cp-trigger-text">חיפוש עמדות, פריטים…</span>
        <kbd className="cp-trigger-kbd">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
