"use client";

import { useState } from "react";
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Button, 
  Box, 
  IconButton, 
  Menu, 
  MenuItem, 
  useTheme, 
  useScrollTrigger, 
  Slide,
  ListItemIcon,
  Divider,
  Fade,
  Paper
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// Icons
import SettingsIcon from "@mui/icons-material/Settings";
import DashboardIcon from "@mui/icons-material/Dashboard"; // For Reports/Dashboard
import ScienceIcon from "@mui/icons-material/Science"; // For Testing Screen
import AnalyticsIcon from "@mui/icons-material/Analytics"; // For Management Board
import LocalShippingIcon from "@mui/icons-material/LocalShipping"; // For Incoming Shipments
import FolderCopyIcon from "@mui/icons-material/FolderCopy"; // For File Manager

// Settings Menu Icons
import PeopleIcon from "@mui/icons-material/People";
import CategoryIcon from "@mui/icons-material/Category";
import SourceIcon from "@mui/icons-material/Source";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import EventNoteIcon from "@mui/icons-material/EventNote";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing"; // Test Stations
import AltRouteIcon from "@mui/icons-material/AltRoute";
import BadgeIcon from "@mui/icons-material/Badge";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";

// Hide on scroll function
function HideOnScroll(props: any) {
  const { children, window } = props;
  const trigger = useScrollTrigger({
    target: window ? window() : undefined,
  });

  return (
    <Slide appear={false} direction="down" in={!trigger}>
      {children}
    </Slide>
  );
}

export default function NavBar(props: any) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const router = useRouter();
  const theme = useTheme();
  const pathname = usePathname();

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (path: string) => {
    router.push(path);
    handleClose();
  };

  const mainLinks = [
    { href: "/", label: "דוחות/ניהול פריטים", icon: <DashboardIcon sx={{ fontSize: 20, ml: 1 }} /> },
    { href: "/testing", label: "מסך בדיקה", icon: <ScienceIcon sx={{ fontSize: 20, ml: 1 }} /> },
    { href: "/dashboard/tests", label: "לוח ניהול", icon: <AnalyticsIcon sx={{ fontSize: 20, ml: 1 }} /> },
    { href: "/shipments", label: "משלוחים נכנסים", icon: <LocalShippingIcon sx={{ fontSize: 20, ml: 1 }} /> },
    { href: "/files", label: "ניהול קבצים", icon: <FolderCopyIcon sx={{ fontSize: 20, ml: 1 }} /> },
  ];

  const settingsLinks = [
    { path: "/settings/customers", label: "לקוחות", icon: <PeopleIcon /> },
    { path: "/settings/item-types", label: "סוגי פריטים", icon: <CategoryIcon /> },
    { path: "/settings/sources", label: "ניהול מקורות", icon: <SourceIcon /> },
    { path: "/settings/item-status", label: "סטטוסי פריט", icon: <AssignmentTurnedInIcon /> },
    { path: "/settings/test-station-status", label: "סטטוסי עמדת בדיקה", icon: <EventNoteIcon /> },
    { path: "/settings/test-stations", label: "עמדות בדיקה", icon: <PrecisionManufacturingIcon /> },
    { path: "/settings/testing-routes", label: "מסלולי בדיקה", icon: <AltRouteIcon /> },
    { path: "/settings/workers", label: "ניהול עובדים", icon: <BadgeIcon /> },
  ];

  return (
    <HideOnScroll {...props}>
      <AppBar 
        position="sticky" 
        elevation={0}
        sx={{ 
          backdropFilter: "blur(20px)",
          backgroundColor: alpha("#121212", 0.9), // Black background
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          color: "#ffffff", // White text
          boxShadow: `0 4px 30px ${alpha(theme.palette.common.black, 0.2)}`,
        }}
      >
        <Toolbar sx={{ justifyContent: "space-between", py: 0.5 }}>
          {/* Main Navigation */}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {mainLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Button
                  key={link.href}
                  component={Link}
                  href={link.href}
                  sx={{ 
                    textTransform: "none",
                    px: 2,
                    py: 1,
                    borderRadius: 3,
                    position: "relative",
                    overflow: "hidden",
                    color: isActive ? "#90caf9" : "#e0e0e0", // Light blue for active, light gray for inactive
                    backgroundColor: isActive ? alpha("#90caf9", 0.15) : "transparent",
                    transition: "all 0.3s ease",
                    "&:hover": {
                      backgroundColor: alpha("#90caf9", 0.1),
                      color: "#90caf9",
                      transform: "translateY(-1px)",
                    },
                    "&::after": isActive ? {
                      content: '""',
                      position: "absolute",
                      bottom: 0,
                      left: "10%",
                      width: "80%",
                      height: "3px",
                      backgroundColor: "#90caf9",
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                    } : {},
                  }}
                  startIcon={link.icon}
                >
                  <Typography variant="subtitle1" fontWeight={isActive ? 700 : 500} sx={{ fontSize: "0.95rem" }}>
                    {link.label}
                  </Typography>
                </Button>
              );
            })}
          </Box>
          
          {/* Settings Button */}
          <Box>
            <IconButton
              size="large"
              aria-label="system settings"
              aria-controls="menu-appbar"
              aria-haspopup="true"
              onClick={handleMenu}
              sx={{
                transition: "all 0.3s ease",
                backgroundColor: Boolean(anchorEl) ? alpha("#90caf9", 0.15) : "transparent",
                color: Boolean(anchorEl) ? "#90caf9" : "#ffffff", // White color for visibility
                "&:hover": {
                  backgroundColor: alpha("#90caf9", 0.1),
                  color: "#90caf9",
                  transform: "rotate(45deg)",
                },
              }}
            >
              <SettingsIcon fontSize="medium" />
            </IconButton>
            
            <Menu
              id="menu-appbar"
              anchorEl={anchorEl}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              keepMounted
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              TransitionComponent={Fade}
              PaperProps={{
                  elevation: 0,
                  sx: {
                    overflow: 'visible',
                    filter: 'drop-shadow(0px 10px 30px rgba(0,0,0,0.5))',
                    mt: 1.5,
                    borderRadius: 3,
                    minWidth: 220,
                    border: `1px solid ${alpha("#ffffff", 0.1)}`,
                    backdropFilter: "blur(10px)",
                    backgroundColor: alpha("#121212", 0.95), // Dark background matching navbar
                    color: "#ffffff", // White text
                    '&:before': {
                      content: '""',
                      display: 'block',
                      position: 'absolute',
                      top: 0,
                      right: 20,
                      width: 10,
                      height: 10,
                      bgcolor: '#121212', // Match dark background
                      transform: 'translateY(-50%) rotate(45deg)',
                      zIndex: 0,
                      borderTop: `1px solid ${alpha("#ffffff", 0.1)}`,
                      borderLeft: `1px solid ${alpha("#ffffff", 0.1)}`,
                    },
                  },
              }}
            >
              <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, borderBottom: `1px solid ${alpha("#ffffff", 0.1)}`, mb: 1 }}>
                  <MenuOpenIcon sx={{ color: "#90caf9" }} fontSize="small" />
                  <Typography variant="subtitle2" fontWeight={700} color="#ffffff">
                      הגדרות מערכת
                  </Typography>
              </Box>

              {settingsLinks.map((item) => (
                  <MenuItem 
                    key={item.path} 
                    onClick={() => handleNavigate(item.path)}
                    sx={{
                        mx: 1,
                        my: 0.5,
                        borderRadius: 1.5,
                        typography: 'body2',
                        color: "#e0e0e0",
                        "&:hover": {
                            backgroundColor: alpha("#90caf9", 0.15),
                            color: "#90caf9",
                        },
                    }}
                  >
                    <ListItemIcon sx={{ color: "inherit", minWidth: 32 }}>
                        {item.icon}
                    </ListItemIcon>
                    {item.label}
                  </MenuItem>
              ))}
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>
    </HideOnScroll>
  );
}
