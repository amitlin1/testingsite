"use client";

import { useState } from "react";
import { Box, Typography, Collapse, IconButton, Tooltip } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { fullLogout } from "@/lib/auth/logout";
import { canSeeInNav } from "@/lib/routes";
import { ROLE_LABEL, isAppRole } from "@/lib/auth/roles";
import { identityOf } from "@/lib/auth/identity";
import { Check as CheckIcon, ExpandMore as ExpandMoreIcon, Logout as LogoutIcon, Menu as MenuIcon } from "@/components/ui/icons";
import { SECTIONS, SETTINGS, SETTINGS_PAGES, activeHref, isUnder } from "@/app/navigation";
import "./shell.css";

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

const SIDEBAR_BG = "var(--color-nav-bg)";

type NavItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClose?: () => void;
  isNested?: boolean;
  collapsed?: boolean;
};

function NavItem({ href, label, icon, active, onClose, isNested = false, collapsed = false }: NavItemProps) {
  // States live in shell.css (.sh-nav-item): hover, the active page, keyboard focus.
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

  const { data: session } = useSession();
  const roles = session?.roles ?? null;
  const displayName = identityOf(session).displayName || "משתמש";
  const roleLabel =
    (session?.roles ?? []).filter(isAppRole).map((r) => ROLE_LABEL[r]).find(Boolean) ?? "משתמש";
  const avatarChar = displayName.trim().charAt(0) || "מ";

  // Hide nav entries the current role may not open (same source of truth as the
  // middleware, so the sidebar never offers a link that ends in /no-auth).
  const visibleMainLinks = SECTIONS.filter((l) => canSeeInNav(l.href, roles));
  const visibleSettingsLinks = SETTINGS_PAGES.filter((s) => canSeeInNav(s.href, roles));

  const isSettingsActive = pathname ? isUnder(pathname, SETTINGS.href) : false;
  const currentMain = activeHref(pathname, visibleMainLinks);
  const currentSetting = activeHref(pathname, visibleSettingsLinks);

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
          {visibleMainLinks.map((link) => (
            <NavItem
              key={link.href}
              href={link.href}
              label={link.label}
              icon={<link.icon fontSize={20} />}
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
                aria-label={collapsed ? SETTINGS.label : undefined}
              >
                <span className="sh-nav-icon" aria-hidden>
                  <SETTINGS.icon fontSize={20} />
                </span>
                {!collapsed && <span className="sh-nav-label">{SETTINGS.label}</span>}
                {!collapsed && <ExpandMoreIcon fontSize={18} className="sh-nav-chevron" data-open={settingsOpen || undefined} aria-hidden />}
              </button>
            );
            return collapsed ? (
              <Tooltip title={SETTINGS.label} placement="left" arrow>
                {settingsButton}
              </Tooltip>
            ) : (
              settingsButton
            );
          })()}

          {/* Settings Links — hidden in collapsed mode (the gear expands the rail first) */}
          {!collapsed && (
            <Collapse in={settingsOpen} unmountOnExit>
              <Box sx={{ pr: 1 }}>
                {visibleSettingsLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavItem
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={<Icon fontSize="small" />}
                      active={currentSetting === item.href}
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

      {/* User footer — pinned (never scrolls). */}
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