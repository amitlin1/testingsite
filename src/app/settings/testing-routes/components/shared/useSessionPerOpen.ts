"use client";
import * as React from "react";

/** A new number each time `open` turns true (0 before the first opening): key a dialog's content by
 *  it so every opening starts fresh, while the content stays mounted after closing for the exit. */
export function useSessionPerOpen(open: boolean): number {
  const [session, setSession] = React.useState(0);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  return session;
}
