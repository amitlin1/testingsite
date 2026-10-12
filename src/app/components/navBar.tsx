"use client";

import { useState } from "react";
import { Box, Typography, Collapse, IconButton, Tooltip } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { fullLogout } from "@/lib/auth/logout";
import { canSeeInNav } from "@/lib/routes";

// Icons
import { Settings as SettingsIcon } from "@/components/ui/icons";
import { Dashboard as DashboardIcon } from "@/components/ui/icons";
import { Inventory as InventoryIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { Analytics as AnalyticsIcon } from "@/components/ui/icons";
import { LocalShipping as LocalShippingIcon } from "@/components/ui/icons";
import { FolderCopy as FolderCopyIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { ExpandMore as ExpandMoreIcon } from "@/components/ui/icons";
import { Logout as LogoutIcon } from "@/components/ui/icons";
import { Menu as MenuIcon } from "@/components/ui/icons";

// Settings routes — shared single source of truth (also used by the settings sub-nav)
import { settingsLinks } from "../settings/settingsNav";

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

const SIDEBAR_BG = "var(--color-nav-bg)";

// ==========================================
// 1. קומפוננטת טמפלט (DRY) לפריט ניווט בתפריט
// ==========================================
type NavItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClose?: () => void;
  isNested?: boolean; // מאפשר להקטין קצת את הטקסט בתת-תפריט
  collapsed?: boolean; // מצב מכווץ — אייקונים בלבד עם tooltip
};

function NavItem({ href, label, icon, active, onClose, isNested = false, collapsed = false }: NavItemProps) {
  // States live in ui.css (.sh-nav-item): hover, the active page, keyboard focus.
  const link = (
    <Link
      href={href}
      onClick={onClose} // יופעל רק בלחיצה שמאלית, לחיצה על הגלגל תפתח טאב חדש ותתעלם מזה
      className="sh-nav-item"
      data-nested={isNested || undefined}
      data-collapsed={collapsed || undefined}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <span className="sh-nav-icon" aria-hidden>{icon}</span>
      {!collapsed && <span className="sh-nav-label">{label}</span>}
    </Link>
  );

  // In collapsed mode the label is hidden, so surface it as a tooltip.
  return collapsed ? (
    <Tooltip title={label} placement="left" arrow>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** The nav entry a path belongs to: the longest href that is the path itself
 *  or a parent of it ("/" only for itself and the item pages it opens), so
 *  /packages/12 lights the packages entry and /dashboard/tests/kpis the dashboard. */
function activeHref(pathname: string | null, hrefs: string[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const h of hrefs) {
    const hit = h === "/" ? pathname === "/" || pathname.startsWith("/items/") : pathname === h || pathname.startsWith(h + "/");
    if (hit && (best === null || h.length > best.length)) best = h;
  }
  return best;
}

// ==========================================
// 2. קומפוננטת ה-NavBar הראשית
// ==========================================
type SidebarProps = {
  isMobile?: boolean;
  open?: boolean;
  collapsed?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
  onToggle?: () => void;
};

export default function NavBar({
  isMobile = false,
  open = false,
  collapsed = false,
  onClose,
  onExpand,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Real identity from the Keycloak session (replaces the old static placeholder).
  const { data: session } = useSession();
  const roles = session?.roles ?? null;
  const displayName =
    session?.user?.displayName ||
    session?.user?.name ||
    session?.user?.preferredUsername ||
    "משתמש";
  const ROLE_LABELS_HE: Record<string, string> = {
    manager: "מנהל",
    tester: "בודק",
    storekeeper: "מחסנאי",
    mashan: "משאן",
  };
  const roleLabel =
    (session?.roles ?? []).map((r) => ROLE_LABELS_HE[r]).find(Boolean) ?? "משתמש";
  const avatarChar = displayName.trim().charAt(0) || "מ";

  const mainLinks = [
    { href: "/", label: "דוחות וניהול פריטים", icon: <DashboardIcon fontSize={20} /> },
    { href: "/packages", label: "מארזים", icon: <InventoryIcon fontSize={20} /> },
    { href: "/testing", label: "מסך בדיקה", icon: <ScienceIcon fontSize={20} /> },
    { href: "/dashboard/tests", label: "לוח ניהול", icon: <AnalyticsIcon fontSize={20} /> },
    { href: "/shipments", label: "משלוחים נכנסים", icon: <LocalShippingIcon fontSize={20} /> },
    { href: "/files", label: "ניהול קבצים", icon: <FolderCopyIcon fontSize={20} /> },
  ];

  // Hide nav entries the current role may not open (same source of truth as the
  // middleware, so the sidebar never offers a link that ends in /no-auth).
  const visibleMainLinks = mainLinks.filter((l) => canSeeInNav(l.href, roles));
  const visibleSettingsLinks = settingsLinks.filter((s) => canSeeInNav(s.path, roles));

  const isSettingsActive = pathname?.startsWith("/settings");
  const currentMain = activeHref(pathname, visibleMainLinks.map((l) => l.href));
  const currentSetting = activeHref(pathname, visibleSettingsLinks.map((s) => s.path));

  return (
    <Box
      component="aside"
      style={{
        // Only the mobile drawer slides; the desktop width snaps (animating
        // width would re-lay out the whole page on every frame).
        transform: isMobile ? (open ? "translateX(0)" : "translateX(100%)") : "none",
        transition: isMobile ? "transform var(--dur-slow) var(--ease-out)" : "none",
        boxShadow: isMobile && open ? "var(--shadow-pop)" : "none",
      }}
      sx={{
        position: "fixed",
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        bgcolor: SIDEBAR_BG,
        color: "var(--color-on-primary)",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        zIndex: 1200,
      }}
    >
      {/* Brand */}
      <Box
        sx={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 1.25,
          px: collapsed ? 0 : 2.25,
          borderBottom: "1px solid var(--color-nav-divider)",
          flexShrink: 0,
        }}
      >
        {isMobile ? (
          // מובייל (מגירה): נשמר הלוגו + הכיתוב; הפתיחה/סגירה נעשית מההמבורגר בשורה העליונה.
          <>
            <Box
              sx={{
                width: 26,
                height: 26,
                borderRadius: "var(--r-xs)",
                bgcolor: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <CheckIcon sx={{ fontSize: 16, color: "var(--color-on-primary)" }} />
            </Box>
            <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, whiteSpace: "nowrap" }}>
              מערכת בדיקות
            </Typography>
          </>
        ) : (
          // דסקטופ: כפתור הכיווץ/הרחבה יושב במקום אייקון הלוגו בשני המצבים.
          <>
            <IconButton
              onClick={onToggle}
              aria-label={collapsed ? "הרחב תפריט" : "כווץ תפריט"}
              aria-expanded={!collapsed}
              className="sh-nav-iconbtn"
            >
              <MenuIcon sx={{ fontSize: 20 }} />
            </IconButton>
            {!collapsed && (
              <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, whiteSpace: "nowrap" }}>
                מערכת בדיקות
              </Typography>
            )}
          </>
        )}
      </Box>

      {/* Navigation — the ONLY scroll region. minHeight:0 lets the flex child
          shrink instead of forcing the whole column to overflow. */}
      <Box
        component="nav"
        aria-label="ניווט ראשי"
        className="sidebar-nav sh-nav-scroll"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: collapsed ? "10px 8px" : "10px 14px",
        }}
      >
        <Box>
          {/* Main Links */}
          {visibleMainLinks.map((link) => (
            <NavItem
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              active={currentMain === link.href}
              onClose={onClose}
              collapsed={collapsed}
            />
          ))}

          <Box sx={{ height: "1px", bgcolor: "var(--color-nav-divider)", my: 1.25, mx: 0.5 }} />

          {/* Settings Toggle Button (לא מפעיל ניווט, רק פותח/סוגר את הרשימה).
              במצב מכווץ לחיצה עליו מרחיבה את הסרגל במקום לפתוח תת-רשימה. */}
          {(() => {
            const settingsButton = (
              <button
                type="button"
                onClick={collapsed ? onExpand : () => setSettingsOpen((o) => !o)}
                className="sh-nav-item"
                data-collapsed={collapsed || undefined}
                data-section-active={isSettingsActive && (collapsed || !settingsOpen) ? "" : undefined}
                aria-expanded={collapsed ? undefined : settingsOpen}
                aria-label={collapsed ? "הגדרות מערכת" : undefined}
              >
                <span className="sh-nav-icon" aria-hidden>
                  <SettingsIcon fontSize={20} />
                </span>
                {!collapsed && <span className="sh-nav-label">הגדרות מערכת</span>}
                {!collapsed && <ExpandMoreIcon fontSize={18} className="sh-nav-chevron" data-open={settingsOpen || undefined} aria-hidden />}
              </button>
            );
            return collapsed ? (
              <Tooltip title="הגדרות מערכת" placement="left" arrow>
                {settingsButton}
              </Tooltip>
            ) : (
              settingsButton
            );
          })()}

          {/* Settings Links — hidden in collapsed mode (the gear expands the rail first) */}
          {!collapsed && (
            <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
              <Box sx={{ pr: 1 }}>
                {visibleSettingsLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavItem
                      key={item.path}
                      href={item.path}
                      label={item.label}
                      icon={<Icon fontSize="small" />}
                      active={currentSetting === item.path}
                      onClose={onClose}
                      isNested={true}
                    />
                  );
                })}
              </Box>
            </Collapse>
          )}
        </Box>
      </Box>

      {/* User footer — pinned (never scrolls). Static placeholder for now;
          wire the name/role/logout up to the real auth/session later. */}
      <Box
        sx={{
          borderTop: "1px solid var(--color-nav-divider)",
          p: collapsed ? "12px 0" : "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 1.25,
          flexShrink: 0,
        }}
      >
        <Tooltip title={collapsed ? `${displayName} · ${roleLabel}` : ""} placement="left" arrow disableHoverListener={!collapsed}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: "9999px",
              bgcolor: "var(--color-primary)",
              color: "var(--color-on-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {avatarChar}
          </Box>
        </Tooltip>
        {!collapsed && (
          <>
            <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: "var(--text-small)",
                  fontWeight: 600,
                  color: "var(--color-on-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </Typography>
              <Typography sx={{ fontSize: "var(--text-fine)", color: "var(--color-nav-ink-muted)" }}>{roleLabel}</Typography>
            </Box>
            <IconButton
              title="התנתקות"
              aria-label="התנתקות"
              onClick={() => fullLogout(session?.idToken)}
              className="sh-nav-iconbtn sh-nav-iconbtn--muted"
              style={{ marginInlineStart: "auto" }}
            >
              <LogoutIcon fontSize={18} />
            </IconButton>
          </>
        )}
      </Box>
    </Box>
  );
}