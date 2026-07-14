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
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./navBar";

const TOPBAR_HEIGHT = 56;
const MOBILE_QUERY = "(max-width: 980px)";
const COLLAPSED_STORAGE_KEY = "sidebarCollapsed";

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
  const [navOpen, setNavOpen] = React.useState(false); // mobile off-canvas drawer
  const [collapsed, setCollapsed] = React.useState(false); // desktop icon-only rail
  const { title, icon } = usePageMeta(pathname);

  // Restore the desktop collapsed preference once, on mount.
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1");
    } catch {
      /* localStorage unavailable (SSR/private mode) — keep default */
    }
  }, []);

  // Persist the collapsed preference so it survives reloads.
  React.useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Never keep the drawer "open" on desktop.
  React.useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  // Close the drawer on navigation.
  React.useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // The icon-only variant only applies on desktop; the mobile drawer is always
  // full-width.
  const desktopCollapsed = !isMobile && collapsed;
  const railWidth = desktopCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const railOffset = isMobile ? 0 : railWidth;

  // The single toggle: opens/closes the drawer on mobile, collapses/expands the
  // rail on desktop.
  const handleToggle = () =>
    isMobile ? setNavOpen((o) => !o) : setCollapsed((c) => !c);

  return (
    <>
      <Sidebar
        isMobile={isMobile}
        open={navOpen}
        collapsed={desktopCollapsed}
        onClose={() => setNavOpen(false)}
        onExpand={() => setCollapsed(false)}
        onToggle={handleToggle}
      />

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
        {/* On desktop the toggle lives inside the rail's header (replacing the brand
            icon) in both states, so the top bar only needs the hamburger on mobile. */}
        {isMobile && (
          <IconButton
            onClick={handleToggle}
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
