"use client";
import { Box } from "@/components/ui";
import SettingsSubNav from "./components/SettingsSubNav";

/**
 * Settings section wrapper.
 *
 * The shared AppShell already owns the viewport, margins and the single
 * scroll container (its content box is `height: calc(100vh - 56px);
 * overflow-y: auto`). This layout must NOT reset html/body or force a
 * full-viewport height — it just fills the shell's content box and
 * establishes a definite-height flex column with padding, so the settings
 * pages can use their `height:100%` / `flex:1` internal scroll regions the
 * same way the other sections (e.g. /shipments) do.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        direction: "rtl",
      }}
    >
      <SettingsSubNav />
      {/* Page content: fills the remaining height and owns its own internal
          scroll (min-height:0 lets it shrink instead of pushing the sub-nav
          out). Padding lives here so the sub-nav bar stays full-bleed. */}
      <Box sx={{ flex: 1, minHeight: 0, p: 2 }}>{children}</Box>
    </Box>
  );
}
