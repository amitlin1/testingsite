"use client";

import * as React from "react";
import Link from "next/link";
import { Box, Typography, Grid, Paper, CardActionArea, alpha, useTheme } from "@mui/material";
import {
  Assessment,
  Speed,
  Timer,
  LocalShipping,
  AccessTime,
  PieChart,
  Business,
  Category,
  ArrowBack // Changed to ArrowBack for RTL or keep ArrowForward if direction is RTL
} from "@mui/icons-material";

const dashboards = [
  {
    title: "מדדי ביצוע (KPIs)",
    description: "סקירה כללית, תורים ותפוקה.",
    icon: <Assessment sx={{ fontSize: 40 }} />,
    color: "#2E7D32",
    path: "/dashboard/tests/kpis",
  },
  {
    title: "עומס עמדות",
    description: "עומס וביצועים בזמן אמת לפי עמדה.",
    icon: <Speed sx={{ fontSize: 40 }} />,
    color: "#1976D2",
    path: "/dashboard/tests/station-load",
  },
  {
    title: "פריטים איטיים",
    description: "זיהוי צווארי בקבוק ופריטים תקועים.",
    icon: <Timer sx={{ fontSize: 40 }} />,
    color: "#ED6C02",
    path: "/dashboard/tests/slow-items",
  },
  {
    title: "מעקב ביצועים על פי משלוחים",
    description: "מעקב אחר התקדמות וסטטוס משלוחים.",
    icon: <LocalShipping sx={{ fontSize: 40 }} />,
    color: "#9C27B0",
    path: "/dashboard/tests/shipments",
  },
  {
    title: "זמני ביצוע",
    description: "ניתוח מגמות זמני בדיקה והמתנה.",
    icon: <AccessTime sx={{ fontSize: 40 }} />,
    color: "#009688",
    path: "/dashboard/tests/average-times",
  },
  {
    title: "התפלגות סטטוסים",
    description: "פילוח פריטים לפי סטטוס נוכחי.",
    icon: <PieChart sx={{ fontSize: 40 }} />,
    color: "#D32F2F",
    path: "/dashboard/tests/status-distribution",
  },
  {
    title: "מעקב ביצועים על פי לקוחות",
    description: "מדדים ספציפיים לכל לקוח.",
    icon: <Business sx={{ fontSize: 40 }} />,
    color: "#0288D1",
    path: "/dashboard/tests/customer-performance",
  },
  {
    title: "מעקב ביצועים על פי סוגי פריטים",
    description: "מעקב וסטטוס לפי סוג פריט.",
    icon: <Category sx={{ fontSize: 40 }} />,
    color: "#7B1FA2",
    path: "/dashboard/tests/item-types",
  },
];

export default function DashboardOverviewPage() {
  const theme = useTheme();

  return (
    <Box sx={{ p: 4, height: "100%", display: "flex", flexDirection: "column", direction: "rtl" }}>
      <Box sx={{ mb: 6 }}>
        <Typography variant="h3" fontWeight="800" gutterBottom sx={{ background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`, backgroundClip: "text", WebkitTextFillColor: "transparent", width: "fit-content" }}>
          מרכז שליטה
        </Typography>
        <Typography variant="h6" color="text.secondary">
          בחר לוח מחוונים להצגת ניתוח מפורט
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {dashboards.map((board) => (
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={board.title}>
            <Link href={board.path} passHref style={{ textDecoration: "none" }}>
                <Paper
                  elevation={0}
                  sx={{
                    height: "100%",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    overflow: "hidden",
                    "&:hover": {
                      transform: "translateY(-4px)",
                      boxShadow: "0 8px 20px -6px rgba(0,0,0,0.1)",
                      borderColor: alpha(board.color, 0.5),
                      "& .icon-box": {
                        transform: "scale(1.05) rotate(-3deg)",
                        bgcolor: alpha(board.color, 0.2),
                      }
                    }
                  }}
                >
                  <CardActionArea sx={{ height: "100%", p: 3, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <Box sx={{ width: "100%" }}>
                        <Box 
                            className="icon-box"
                            sx={{ 
                                width: 64, 
                                height: 64, 
                                borderRadius: "20px", 
                                display: "flex", 
                                alignItems: "center", 
                                justifyContent: "center",
                                color: board.color,
                                bgcolor: alpha(board.color, 0.1),
                                mb: 3,
                                transition: "all 0.3s ease"
                            }}
                        >
                            {board.icon}
                        </Box>
                        <Typography variant="h5" fontWeight="bold" gutterBottom color="text.primary" align="right">
                            {board.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }} align="right">
                            {board.description}
                        </Typography>
                    </Box>
                    
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: board.color, mt: 2, width: "100%", justifyContent: "flex-end" }}>
                        <Typography variant="button" fontWeight="bold">צפה בנתונים</Typography>
                        <ArrowBack fontSize="small" /> 
                    </Box>
                  </CardActionArea>
                </Paper>
            </Link>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
