"use client";

import * as React from "react";
import { Box, IconButton, Typography, useMediaQuery } from "@mui/material";
import { usePathname } from "next/navigation";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ScienceIcon from "@mui/icons-material/Science";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import FolderCopyIcon from "@mui/icons-material/FolderCopy";
import SettingsIcon from "@mui/icons-material/Settings";
import Sidebar, { SIDEBAR_WIDTH } from "./navBar";

const TOPBAR_HEIGHT = 56;
const MOBILE_QUERY = "(max-width: 980px)";

/** Page title + icon resolved from the current route, shown in the top bar. */
function usePageMeta(pathname: string | null) {
  if (pathname?.startsWith("/testing")) return { title: "מסך בדיקה", icon: <ScienceIcon sx={{ fontSize: 20 }} /> };
  if (pathname?.startsWith("/dashboard")) return { title: "לוח ניהול", icon: <AnalyticsIcon sx={{ fontSize: 20 }} /> };
  if (pathname?.startsWith("/shipments")) return { title: "משלוחים נכנסים", icon: <LocalShippingIcon sx={{ fontSize: 20 }} /> };
  if (pathname?.startsWith("/files")) return { title: "ניהול קבצים", icon: <FolderCopyIcon sx={{ fontSize: 20 }} /> };
  if (pathname?.startsWith("/settings")) return { title: "הגדרות מערכת", icon: <SettingsIcon sx={{ fontSize: 20 }} /> };
  return { title: "דוחות וניהול פריטים", icon: <DashboardIcon sx={{ fontSize: 20 }} /> };
}

/**
 * Responsive app shell: fixed sidebar rail + slim top bar + scrollable content.
 * Below 980px the rail collapses to an off-canvas drawer toggled by the top-bar
 * hamburger, with a dimming backdrop. The content's inline-start offset (rail
 * width) and the drawer transform are driven from JS state — applied via inline
 * `style` because MUI `sx` drops logical props like `marginInlineStart`.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [navOpen, setNavOpen] = React.useState(false);
  const { title, icon } = usePageMeta(pathname);

  // Never keep the drawer "open" on desktop.
  React.useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  // Close the drawer on navigation.
  React.useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const railOffset = isMobile ? 0 : SIDEBAR_WIDTH;

  return (
    <>
      <Sidebar isMobile={isMobile} open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Dimming backdrop (mobile drawer only) */}
      {isMobile && navOpen && (
        <Box
          onClick={() => setNavOpen(false)}
          sx={{ position: "fixed", inset: 0, bgcolor: "rgba(0,0,0,0.45)", zIndex: 1150 }}
        />
      )}

      {/* Top bar */}
      <Box
        component="header"
        style={{ insetInlineStart: railOffset }}
        sx={{
          position: "fixed",
          top: 0,
          insetInlineEnd: 0,
          height: TOPBAR_HEIGHT,
          bgcolor: "#fff",
          borderBottom: "1px solid #e0e0e0",
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          zIndex: 1100,
          transition: "inset-inline-start 0.2s ease",
        }}
      >
        {isMobile && (
          <IconButton
            onClick={() => setNavOpen((o) => !o)}
            aria-label="תפריט"
            sx={{ border: "1px solid #e0e0e0", borderRadius: "9px", width: 36, height: 36, color: "#1d1d1f" }}
          >
            <MenuIcon sx={{ fontSize: 20 }} />
          </IconButton>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", color: "primary.main" }}>{icon}</Box>
          <Typography sx={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.2px", whiteSpace: "nowrap" }}>
            {title}
          </Typography>
        </Box>
      </Box>

      {/* Content */}
      <Box
        style={{ marginInlineStart: railOffset }}
        sx={{
          marginTop: `${TOPBAR_HEIGHT}px`,
          height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
          overflowY: "auto",
          overflowX: "hidden",
          transition: "margin-inline-start 0.2s ease",
        }}
      >
        {children}
      </Box>
    </>
  );
}
