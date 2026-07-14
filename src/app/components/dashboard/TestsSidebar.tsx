"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Paper,
  useTheme,
  alpha
} from "@/components/ui";
import {
  Dashboard as DashboardIcon,
  Assessment as AssessmentIcon,
  Speed as SpeedIcon,
  Timer as TimerIcon,
  LocalShipping as ShippingIcon,
  AccessTime as AccessTimeIcon,
  DonutLarge as StatusIcon,
  Business as BusinessIcon,
} from "@/components/ui/icons";

const menuItems = [
  { text: "סקירה כללית", icon: <DashboardIcon />, path: "/dashboard/tests" },
  { text: "מדדים (KPIs)", icon: <AssessmentIcon />, path: "/dashboard/tests/kpis" },
  { text: "עומס עמדות", icon: <SpeedIcon />, path: "/dashboard/tests/station-load" },
  { text: "פריטים איטיים", icon: <TimerIcon />, path: "/dashboard/tests/slow-items" },
  { text: "משלוחים", icon: <ShippingIcon />, path: "/dashboard/tests/shipments" },
  { text: "זמנים ממוצעים", icon: <AccessTimeIcon />, path: "/dashboard/tests/average-times" },
  { text: "התפלגות סטטוס", icon: <StatusIcon />, path: "/dashboard/tests/status-distribution" },
  { text: "ביצועי לקוחות", icon: <BusinessIcon />, path: "/dashboard/tests/customer-performance" },
];

export default function TestsSidebar() {
  const pathname = usePathname();
  const theme = useTheme();

  return (
    <Paper
      elevation={0}
      sx={{
        width: 260,
        height: "100%",
        borderRadius: 0,
        borderLeft: `1px solid ${theme.palette.divider}`, // Changed to borderRight -> borderLeft for RTL context ideally, but assuming ltr structure with rtl content, usually keeps right. Let's keep Right for now unless global direction changes. Wait, app is RTL.
        bgcolor: "background.paper",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        position: "sticky",
        top: 0,
        zIndex: 10,
        overflowY: "auto",
        maxHeight: "100vh",
        direction: "rtl" // Ensuring RTL behavior inside sidebar
      }}
    >
      <Box sx={{ p: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: "10px",
            bgcolor: theme.palette.primary.main,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            boxShadow: `0px 4px 12px ${alpha(theme.palette.primary.main, 0.4)}`
          }}
        >
          <DashboardIcon fontSize="small" />
        </Box>
        <Typography variant="h6" fontWeight="700" color="text.primary">
          לוח בדיקות
        </Typography>
      </Box>

      <Divider sx={{ mx: 2, mb: 2 }} />

      <List sx={{ px: 2, pb: 2 }}>
        {menuItems.map((item) => {
          const isActive = pathname === item.path;
          
          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
              <Link href={item.path} passHref style={{ textDecoration: "none", width: "100%" }}>
                <ListItemButton
                  selected={isActive}
                  sx={{
                    borderRadius: "12px",
                    py: 1.2,
                    px: 2,
                    transition: "all 0.2s ease-in-out",
                    bgcolor: isActive ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                    color: isActive ? theme.palette.primary.main : "text.secondary",
                    "&.Mui-selected": {
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.primary.dark,
                      "&:hover": {
                        bgcolor: alpha(theme.palette.primary.main, 0.18),
                      },
                      "& .MuiListItemIcon-root": {
                        color: theme.palette.primary.dark,
                      }
                    },
                    "&:hover": {
                      bgcolor: alpha(theme.palette.text.primary, 0.04),
                      transform: "translateX(-4px)", // RTL Direction
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 40,
                      color: isActive ? theme.palette.primary.main : "text.secondary",
                      transition: "color 0.2s",
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                    primary={item.text} 
                    primaryTypographyProps={{ 
                      fontWeight: isActive ? 600 : 500,
                      fontSize: "0.95rem",
                      textAlign: "right"
                    }} 
                  />
                  {isActive && (
                    <Box 
                      sx={{ 
                        width: 6, 
                        height: 6, 
                        borderRadius: "50%", 
                        bgcolor: theme.palette.primary.main 
                      }} 
                    />
                  )}
                </ListItemButton>
              </Link>
            </ListItem>
          );
        })}
      </List>

      <Box sx={{ mt: "auto", p: 3 }}>
        <Paper
          elevation={0}
          sx={{
            p: 2,
            bgcolor: alpha(theme.palette.success.main, 0.08),
            borderRadius: "16px",
            border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`
          }}
        >
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: theme.palette.success.main }} />
            <Typography variant="caption" fontWeight="bold" color="success.dark">
              סטטוס מערכת
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" fontWeight="500">
            כל המערכות תקינות.
          </Typography>
        </Paper>
      </Box>
    </Paper>
  );
}
