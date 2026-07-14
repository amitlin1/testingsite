"use client";

import { useState } from "react";
import {
  Box,
  Typography,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Tooltip,
} from "@/components/ui";
import { useTheme, alpha } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Icons
import { Settings as SettingsIcon } from "@/components/ui/icons";
import { Dashboard as DashboardIcon } from "@/components/ui/icons";
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

const SIDEBAR_BG = "#15171a";
const ACTIVE_BG = "rgba(41,151,255,0.14)";
const ACTIVE_BAR = "#2997ff";
const INACTIVE_TEXT = "#b8bcc2";

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
  const button = (
    <ListItemButton
      component={Link}
      href={href}
      onClick={onClose} // יופעל רק בלחיצה שמאלית, לחיצה על הגלגל תפתח טאב חדש ותתעלם מזה
      sx={{
        minHeight: isNested ? 38 : 42,
        borderRadius: "9px",
        px: collapsed ? 0 : 1.5,
        mb: "3px",
        justifyContent: collapsed ? "center" : "flex-start",
        color: active ? "#fff" : INACTIVE_TEXT,
        bgcolor: active ? ACTIVE_BG : "transparent",
        borderInlineStart: `3px solid ${active ? ACTIVE_BAR : "transparent"}`,
        "&:hover": { bgcolor: alpha("#ffffff", 0.06), color: "#fff" },
        "& .MuiListItemIcon-root": {
          color: "inherit",
          minWidth: collapsed ? 0 : 34,
          justifyContent: "center",
        },
        "& .MuiListItemText-primary": {
          fontSize: isNested ? 13 : 14,
          fontWeight: active ? 600 : 400,
        },
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      {!collapsed && <ListItemText primary={label} />}
    </ListItemButton>
  );

  // In collapsed mode the label is hidden, so surface it as a tooltip.
  return collapsed ? (
    <Tooltip title={label} placement="left" arrow>
      {button}
    </Tooltip>
  ) : (
    button
  );
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
  const theme = useTheme();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const mainLinks = [
    { href: "/", label: "דוחות/ניהול פריטים", icon: <DashboardIcon sx={{ fontSize: 20 }} /> },
    { href: "/testing", label: "מסך בדיקה", icon: <ScienceIcon sx={{ fontSize: 20 }} /> },
    { href: "/dashboard/tests", label: "לוח ניהול", icon: <AnalyticsIcon sx={{ fontSize: 20 }} /> },
    { href: "/shipments", label: "משלוחים נכנסים", icon: <LocalShippingIcon sx={{ fontSize: 20 }} /> },
    { href: "/files", label: "ניהול קבצים", icon: <FolderCopyIcon sx={{ fontSize: 20 }} /> },
  ];

  const isSettingsActive = pathname?.startsWith("/settings");

  return (
    <Box
      component="aside"
      style={{
        transform: isMobile ? (open ? "translateX(0)" : "translateX(100%)") : "none",
        transition: "transform 0.2s ease, width 0.2s ease",
        boxShadow: isMobile && open ? "rgba(0,0,0,0.35) 0 0 50px" : "none",
      }}
      sx={{
        position: "fixed",
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        bgcolor: SIDEBAR_BG,
        color: "#fff",
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
          borderBottom: `1px solid ${alpha("#ffffff", 0.08)}`,
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
                borderRadius: "7px",
                bgcolor: theme.tokens?.accent || ACTIVE_BAR, // גיבוי למקרה שהטוקן חסר
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <CheckIcon sx={{ fontSize: 16, color: "#fff" }} />
            </Box>
            <Typography sx={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.3px", whiteSpace: "nowrap" }}>
              מערכת בדיקות
            </Typography>
          </>
        ) : (
          // דסקטופ: כפתור הכיווץ/הרחבה יושב במקום אייקון הלוגו בשני המצבים.
          <>
            <IconButton
              onClick={onToggle}
              aria-label={collapsed ? "הרחב תפריט" : "כווץ תפריט"}
              sx={{
                color: "#fff",
                width: 36,
                height: 36,
                borderRadius: "9px",
                flexShrink: 0,
                "&:hover": { bgcolor: alpha("#ffffff", 0.08) },
              }}
            >
              <MenuIcon sx={{ fontSize: 20 }} />
            </IconButton>
            {!collapsed && (
              <Typography sx={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.3px", whiteSpace: "nowrap" }}>
                מערכת בדיקות
              </Typography>
            )}
          </>
        )}
      </Box>

      {/* Navigation — the ONLY scroll region. minHeight:0 lets the flex child
          shrink instead of forcing the whole column to overflow. */}
      <Box
        className="sidebar-nav"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: collapsed ? "10px 8px" : "10px 14px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.18) transparent",
          "&::-webkit-scrollbar": { width: 8 },
          "&::-webkit-scrollbar-thumb": {
            background: "rgba(255,255,255,0.18)",
            borderRadius: "9999px",
            border: "2px solid transparent",
            backgroundClip: "content-box",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        <List disablePadding>
          {/* Main Links */}
          {mainLinks.map((link) => (
            <NavItem
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              active={pathname === link.href}
              onClose={onClose}
              collapsed={collapsed}
            />
          ))}

          <Box sx={{ height: "1px", bgcolor: alpha("#ffffff", 0.08), my: 1.25, mx: 0.5 }} />

          {/* Settings Toggle Button (לא מפעיל ניווט, רק פותח/סוגר את הרשימה).
              במצב מכווץ לחיצה עליו מרחיבה את הסרגל במקום לפתוח תת-רשימה. */}
          {(() => {
            const settingsButton = (
              <ListItemButton
                onClick={collapsed ? onExpand : () => setSettingsOpen((o) => !o)}
                sx={{
                  minHeight: 42,
                  borderRadius: "9px",
                  px: collapsed ? 0 : 1.5,
                  mb: "3px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  color: isSettingsActive ? "#fff" : INACTIVE_TEXT,
                  bgcolor: isSettingsActive && (collapsed || !settingsOpen) ? ACTIVE_BG : "transparent",
                  borderInlineStart: `3px solid ${isSettingsActive ? ACTIVE_BAR : "transparent"}`,
                  "&:hover": { bgcolor: alpha("#ffffff", 0.06), color: "#fff" },
                  "& .MuiListItemIcon-root": {
                    color: "inherit",
                    minWidth: collapsed ? 0 : 34,
                    justifyContent: "center",
                  },
                  "& .MuiListItemText-primary": { fontSize: 14, fontWeight: isSettingsActive ? 600 : 400 },
                }}
              >
                <ListItemIcon>
                  <SettingsIcon sx={{ fontSize: 20 }} />
                </ListItemIcon>
                {!collapsed && <ListItemText primary="הגדרות מערכת" />}
                {!collapsed && (
                  <ExpandMoreIcon
                    sx={{
                      fontSize: 18,
                      transition: "transform 0.2s",
                      transform: settingsOpen ? "rotate(180deg)" : "none",
                    }}
                  />
                )}
              </ListItemButton>
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
              <List disablePadding sx={{ pr: 1 }}>
                {settingsLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavItem
                      key={item.path}
                      href={item.path}
                      label={item.label}
                      icon={<Icon fontSize="small" />}
                      active={pathname === item.path}
                      onClose={onClose}
                      isNested={true}
                    />
                  );
                })}
              </List>
            </Collapse>
          )}
        </List>
      </Box>

      {/* User footer — pinned (never scrolls). Static placeholder for now;
          wire the name/role/logout up to the real auth/session later. */}
      <Box
        sx={{
          borderTop: `1px solid ${alpha("#ffffff", 0.08)}`,
          p: collapsed ? "12px 0" : "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 1.25,
          flexShrink: 0,
        }}
      >
        <Tooltip title={collapsed ? "דנה כהן · מנהלת בקרה" : ""} placement="left" arrow disableHoverListener={!collapsed}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: "9999px",
              bgcolor: theme.tokens?.accent || ACTIVE_BAR,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            ד
          </Box>
        </Tooltip>
        {!collapsed && (
          <>
            <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                דנה כהן
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: "#9aa0a6" }}>מנהלת בקרה</Typography>
            </Box>
            <IconButton
              title="התנתקות"
              aria-label="התנתקות"
              sx={{
                marginInlineStart: "auto",
                width: 30,
                height: 30,
                borderRadius: "8px",
                color: "#9aa0a6",
                flexShrink: 0,
                "&:hover": { bgcolor: alpha("#ffffff", 0.08), color: "#fff" },
              }}
            >
              <LogoutIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </>
        )}
      </Box>
    </Box>
  );
}