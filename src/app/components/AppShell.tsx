"use client";

import * as React from "react";
import { Box, IconButton, Typography, useMediaQuery } from "@/components/ui";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";
import { Menu as MenuIcon } from "@/components/ui/icons";
import { Dashboard as DashboardIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { Analytics as AnalyticsIcon } from "@/components/ui/icons";
import { LocalShipping as LocalShippingIcon } from "@/components/ui/icons";
import { FolderCopy as FolderCopyIcon } from "@/components/ui/icons";
import { Settings as SettingsIcon } from "@/components/ui/icons";
import { History as HistoryIcon } from "@/components/ui/icons";
import { Inventory as InventoryIcon } from "@/components/ui/icons";
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./navBar";
import CommandPaletteTrigger from "@/components/CommandPaletteTrigger";

const TOPBAR_HEIGHT = 56;
const MOBILE_QUERY = "(max-width: 980px)";
const COLLAPSED_STORAGE_KEY = "sidebarCollapsed";

// The desktop collapsed preference, kept in localStorage so it survives reloads
// and read through useSyncExternalStore, so the server render (expanded) never
// guesses it. The in-memory copy keeps the toggle working when storage is
// unavailable (private mode).
let collapsedPref: boolean | null = null;
const collapsedListeners = new Set<() => void>();
function readCollapsed(): boolean {
  if (collapsedPref === null) {
    try {
      collapsedPref = localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      collapsedPref = false;
    }
  }
  return collapsedPref;
}
function writeCollapsed(value: boolean) {
  collapsedPref = value;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  collapsedListeners.forEach((l) => l());
}
function subscribeCollapsed(onChange: () => void) {
  collapsedListeners.add(onChange);
  return () => { collapsedListeners.delete(onChange); };
}

/** Page title + icon resolved from the current route, shown in the top bar. */
function usePageMeta(pathname: string | null) {
  if (pathname?.startsWith("/testing")) return { title: "מסך בדיקה", icon: <ScienceIcon fontSize={20} /> };
  if (pathname?.startsWith("/packages")) return { title: "מארזים ופריטים", icon: <InventoryIcon fontSize={20} /> };
  if (pathname?.startsWith("/dashboard")) return { title: "לוח ניהול", icon: <AnalyticsIcon fontSize={20} /> };
  if (pathname?.startsWith("/shipments")) return { title: "משלוחים נכנסים", icon: <LocalShippingIcon fontSize={20} /> };
  if (pathname?.startsWith("/files")) return { title: "ניהול קבצים", icon: <FolderCopyIcon fontSize={20} /> };
  if (pathname?.startsWith("/settings")) return { title: "הגדרות מערכת", icon: <SettingsIcon fontSize={20} /> };
  if (pathname?.startsWith("/items")) return { title: "היסטוריית פריט", icon: <HistoryIcon fontSize={20} /> };
  return { title: "דוחות וניהול פריטים", icon: <DashboardIcon fontSize={20} /> };
}

/**
 * Responsive app shell: fixed sidebar rail + slim top bar + scrollable content.
 * Below 980px the rail collapses to an off-canvas drawer toggled by the top-bar
 * hamburger, with a dimming backdrop. The content's inline-start offset (rail
 * width) and the drawer transform are driven from JS state, applied via inline
 * `style`. Neither offset is animated: animating a margin re-lays out the whole
 * page on every frame, and the rail would visibly slide shut on every load for
 * users who keep it collapsed (the preference is read after the first paint).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [navOpen, setNavOpen] = React.useState(false); // mobile off-canvas drawer
  const collapsed = React.useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false); // desktop icon-only rail
  const { title, icon } = usePageMeta(pathname);

  // Idle-tab dead-session redirect (the third of the three redirect sites;
  // middleware + apiFetch are the others). When a session dies while this tab
  // sits open with NO in-flight request, SessionProvider's refetch surfaces
  // session.error and we do ONE full navigation to /login. Keyed on the error
  // only, so a healthy session never navigates.
  const { data: session } = useSession();
  React.useEffect(() => {
    if (session?.error !== "RefreshAccessTokenError") return;
    if (typeof window === "undefined") return;
    const cb = window.location.pathname + window.location.search;
    window.location.href = `${withBasePath("/login")}?callbackUrl=${encodeURIComponent(cb)}`;
  }, [session?.error]);

  // Close the drawer on navigation, and never keep it "open" on desktop.
  // Adjusted during render, so the stale state is never painted.
  const [navSeen, setNavSeen] = React.useState({ pathname, isMobile });
  if (navSeen.pathname !== pathname || navSeen.isMobile !== isMobile) {
    setNavSeen({ pathname, isMobile });
    if (navSeen.pathname !== pathname || !isMobile) setNavOpen(false);
  }

  // Escape closes the open drawer, like every other overlay.
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // §14.1 — the ONE change the dashboard needs from the shell.
  //
  // Two expanded rails side by side (240 + 248 = 488px of chrome) leaves too
  // little for a dense dashboard, so on /dashboard the app rail renders in its
  // 56px icon state and the chrome cost drops to ~304px.
  //
  // It is a ROUTE-DRIVEN OVERRIDE, not a user preference: the collapse lives on
  // the derived value and never calls setCollapsed, so nothing is written to
  // localStorage and leaving /dashboard restores whatever the user had chosen.
  // Expanding the rail by hand while on the dashboard wins for the rest of the
  // visit — `userExpandedOnDashboard` is that escape hatch, and it resets on the
  // way out.
  const isDashboard = pathname?.startsWith("/dashboard") ?? false;
  const [userExpandedOnDashboard, setUserExpandedOnDashboard] = React.useState(false);
  if (!isDashboard && userExpandedOnDashboard) setUserExpandedOnDashboard(false);

  // The icon-only variant only applies on desktop; the mobile drawer is always
  // full-width.
  const desktopCollapsed =
    !isMobile && (collapsed || (isDashboard && !userExpandedOnDashboard));
  const railWidth = desktopCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const railOffset = isMobile ? 0 : railWidth;

  // The single toggle: opens/closes the drawer on mobile, collapses/expands the
  // rail on desktop. On /dashboard an explicit expand also lifts the route
  // override — otherwise the button would appear to do nothing.
  const handleToggle = () => {
    if (isMobile) {
      setNavOpen((o) => !o);
      return;
    }
    if (isDashboard) setUserExpandedOnDashboard(desktopCollapsed);
    writeCollapsed(!desktopCollapsed);
  };

  return (
    <>
      <Sidebar
        isMobile={isMobile}
        open={navOpen}
        collapsed={desktopCollapsed}
        onClose={() => setNavOpen(false)}
        onExpand={() => {
          if (isDashboard) setUserExpandedOnDashboard(true);
          writeCollapsed(false);
        }}
        onToggle={handleToggle}
      />

      {/* Dimming backdrop (mobile drawer only) */}
      {isMobile && navOpen && (
        <Box
          onClick={() => setNavOpen(false)}
          sx={{ position: "fixed", inset: 0, bgcolor: "var(--color-scrim)", zIndex: 1150 }}
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
          bgcolor: "var(--color-canvas)",
          borderBottom: "1px solid var(--color-hairline)",
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          zIndex: 1100,
        }}
      >
        {/* On desktop the toggle lives inside the rail's header (replacing the brand
            icon) in both states, so the top bar only needs the hamburger on mobile. */}
        {isMobile && (
          <IconButton
            onClick={handleToggle}
            aria-label="תפריט"
            sx={{ border: "1px solid var(--color-border-strong)", borderRadius: "var(--r-sm)", width: 36, height: 36, color: "var(--color-ink)" }}
          >
            <MenuIcon fontSize={20} />
          </IconButton>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          {/* Decorative: muted, so blue stays the colour of things you can press. */}
          <Box sx={{ display: "flex", color: "var(--color-ink-muted-48)" }} aria-hidden>{icon}</Box>
          <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 600, whiteSpace: "nowrap" }}>
            {title}
          </Typography>
        </Box>

        {/* Search sits at the far end of the bar, away from the page title. */}
        <Box style={{ marginInlineStart: "auto" }} sx={{ display: "flex", alignItems: "center" }}>
          <CommandPaletteTrigger />
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
        }}
      >
        {children}
      </Box>
    </>
  );
}
