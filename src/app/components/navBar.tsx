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
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Icons
import SettingsIcon from "@mui/icons-material/Settings";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ScienceIcon from "@mui/icons-material/Science";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import FolderCopyIcon from "@mui/icons-material/FolderCopy";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

// Settings Menu Icons
import PeopleIcon from "@mui/icons-material/People";
import CategoryIcon from "@mui/icons-material/Category";
import SourceIcon from "@mui/icons-material/Source";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import EventNoteIcon from "@mui/icons-material/EventNote";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import BadgeIcon from "@mui/icons-material/Badge";

export const SIDEBAR_WIDTH = 240;

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
};

function NavItem({ href, label, icon, active, onClose, isNested = false }: NavItemProps) {
  return (
    <ListItemButton
      component={Link}
      href={href}
      onClick={onClose} // יופעל רק בלחיצה שמאלית, לחיצה על הגלגל תפתח טאב חדש ותתעלם מזה
      sx={{
        minHeight: isNested ? 38 : 42,
        borderRadius: "9px",
        px: 1.5,
        mb: "3px",
        color: active ? "#fff" : INACTIVE_TEXT,
        bgcolor: active ? ACTIVE_BG : "transparent",
        borderInlineStart: `3px solid ${active ? ACTIVE_BAR : "transparent"}`,
        "&:hover": { bgcolor: alpha("#ffffff", 0.06), color: "#fff" },
        "& .MuiListItemIcon-root": { color: "inherit", minWidth: 34 },
        "& .MuiListItemText-primary": {
          fontSize: isNested ? 13 : 14,
          fontWeight: active ? 600 : 400,
        },
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText primary={label} />
    </ListItemButton>
  );
}

// ==========================================
// 2. קומפוננטת ה-NavBar הראשית
// ==========================================
type SidebarProps = {
  isMobile?: boolean;
  open?: boolean;
  onClose?: () => void;
};

export default function NavBar({ isMobile = false, open = false, onClose }: SidebarProps) {
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

  const settingsLinks = [
    { path: "/settings/customers", label: "לקוחות", icon: <PeopleIcon fontSize="small" /> },
    { path: "/settings/item-types", label: "סוגי פריטים", icon: <CategoryIcon fontSize="small" /> },
    { path: "/settings/sources", label: "ניהול מקורות", icon: <SourceIcon fontSize="small" /> },
    { path: "/settings/item-status", label: "סטטוסי פריט", icon: <AssignmentTurnedInIcon fontSize="small" /> },
    { path: "/settings/test-station-status", label: "סטטוסי עמדת בדיקה", icon: <EventNoteIcon fontSize="small" /> },
    { path: "/settings/test-stations", label: "עמדות בדיקה", icon: <PrecisionManufacturingIcon fontSize="small" /> },
    { path: "/settings/testing-routes", label: "מסלולי בדיקה", icon: <AltRouteIcon fontSize="small" /> },
    { path: "/settings/workers", label: "ניהול עובדים", icon: <BadgeIcon fontSize="small" /> },
  ];

  const isSettingsActive = pathname?.startsWith("/settings");

  return (
    <Box
      component="aside"
      style={{
        transform: isMobile ? (open ? "translateX(0)" : "translateX(100%)") : "none",
        transition: "transform 0.2s ease",
        boxShadow: isMobile && open ? "rgba(0,0,0,0.35) 0 0 50px" : "none",
      }}
      sx={{
        position: "fixed",
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        bgcolor: SIDEBAR_BG,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        zIndex: 1200,
      }}
    >
      {/* Brand */}
      <Box
        sx={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2.25,
          borderBottom: `1px solid ${alpha("#ffffff", 0.08)}`,
          flexShrink: 0,
        }}
      >
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
      </Box>

      {/* Navigation */}
      <Box sx={{ flex: 1, overflowY: "auto", p: "10px 14px" }}>
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
            />
          ))}

          <Box sx={{ height: "1px", bgcolor: alpha("#ffffff", 0.08), my: 1.25, mx: 0.5 }} />

          {/* Settings Toggle Button (לא מפעיל ניווט, רק פותח/סוגר את הרשימה) */}
          <ListItemButton
            onClick={() => setSettingsOpen((o) => !o)}
            sx={{
              minHeight: 42,
              borderRadius: "9px",
              px: 1.5,
              mb: "3px",
              color: isSettingsActive ? "#fff" : INACTIVE_TEXT,
              bgcolor: isSettingsActive && !settingsOpen ? ACTIVE_BG : "transparent",
              borderInlineStart: `3px solid ${isSettingsActive ? ACTIVE_BAR : "transparent"}`,
              "&:hover": { bgcolor: alpha("#ffffff", 0.06), color: "#fff" },
              "& .MuiListItemIcon-root": { color: "inherit", minWidth: 34 },
              "& .MuiListItemText-primary": { fontSize: 14, fontWeight: isSettingsActive ? 600 : 400 },
            }}
          >
            <ListItemIcon>
              <SettingsIcon sx={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText primary="הגדרות מערכת" />
            <ExpandMoreIcon
              sx={{
                fontSize: 18,
                transition: "transform 0.2s",
                transform: settingsOpen ? "rotate(180deg)" : "none",
              }}
            />
          </ListItemButton>

          {/* Settings Links */}
          <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
            <List disablePadding sx={{ pr: 1 }}>
              {settingsLinks.map((item) => (
                <NavItem
                  key={item.path}
                  href={item.path}
                  label={item.label}
                  icon={item.icon}
                  active={pathname === item.path}
                  onClose={onClose}
                  isNested={true}
                />
              ))}
            </List>
          </Collapse>
        </List>
      </Box>
    </Box>
  );
}