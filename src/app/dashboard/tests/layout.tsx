// §1 — TestsSidebar is gone: the dashboard's own rail owns section navigation
// now, and two rails of tabs on one screen is the duplication §14.3 forbids.
//
// What is left is a plain full-height wrapper. The height matters: AppShell's
// content area is `calc(100vh - 56px)` with its own `overflowY: auto`, and the
// dashboard root under here is `height: 100%` — never `100vh`, which would add
// a second scrollbar (§14.2).

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "לוח ניהול",
  description: "לוח בקרה לבדיקות — עומס, זמנים, משלוחים ולקוחות",
};

export default function TestsLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ height: "100%", minWidth: 0 }}>{children}</div>;
}
