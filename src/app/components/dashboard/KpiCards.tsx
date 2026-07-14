"use client";
import * as React from "react";
import { Paper, Box, Typography, Skeleton, alpha, Divider, Stack, Grid, useTheme } from "@mui/material";
import { AccessTime as AccessTimeIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Queue as QueueIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { TrendingUp as TrendingUpIcon } from "@/components/ui/icons";
import { DashboardKpis } from "@/types/dashboard";
import { formatDuration } from "@/app/lib/datetime";
import { SvgIconProps } from "@mui/material/SvgIcon";

interface KpiCardsProps {
  kpis: DashboardKpis | null;
  loading: boolean;
}

export default function KpiCards({ kpis, loading }: KpiCardsProps) {
  const theme = useTheme();
  
  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) {
      return "-";
    }
    return formatDuration(minutes * 60 * 1000, "short");
  };

  const formatSeconds = (seconds: number | undefined): string => {
    if (!seconds) return "0d";
    return formatDuration(seconds * 1000, "short");
  };

  const kpiItems = [
    {
      title: "העמדה העמוסה ביותר",
      value: kpis?.busiestStationName ?? "-",
      subtitle: kpis?.busiestStationName 
        ? `עומס: ${formatSeconds(kpis.busiestStationBusySeconds)} | תור: ${formatSeconds(kpis.busiestStationWaitSeconds)}`
        : "-",
      icon: <TrendingUpIcon />,
      color: "#8e24aa", // Purple
      bgColor: "#f3e5f5"
    },
    {
      title: "פריטים בבדיקה",
      value: kpis?.itemsCurrentlyInTest ?? 0,
      subtitle: "כרגע",
      icon: <ScienceIcon />,
      color: "#1976d2", // Blue
      bgColor: "#e3f2fd"
    },
    {
      title: "פריטים בתור",
      value: kpis?.itemsCurrentlyInQueue ?? 0,
      subtitle: "כרגע",
      icon: <QueueIcon />,
      color: "#ed6c02", // Orange
      bgColor: "#fff3e0"
    },
    {
      title: "פריטים שטופלו",
      value: kpis?.treatedCount ?? kpis?.totalItemsProcessed ?? 0,
      subtitle: "בתקופה הנבחרת",
      icon: <CheckCircleIcon />,
      color: "#2e7d32", // Green
      bgColor: "#e8f5e9"
    },
    {
      title: "זמן עיבוד ממוצע",
      value: formatSeconds(kpis?.avgProcessingSeconds),
      icon: <AccessTimeIcon />,
      color: "#2e7d32",
      bgColor: "#e8f5e9"
    },
    {
      title: "זמן תור ממוצע",
      value: formatSeconds(kpis?.avgQueueSeconds),
      icon: <QueueIcon />,
      color: "#1976d2",
      bgColor: "#e3f2fd"
    },
  ];

  if (loading) {
    return (
      <Grid container spacing={2} sx={{ mb: 2, direction: "rtl" }}>
        {[1, 2, 3, 4].map((i) => (
           <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
              <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 3 }} />
           </Grid>
        ))}
      </Grid>
    );
  }

  return (
    <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 4, bgcolor: "white", border: "1px solid rgba(0,0,0,0.06)" }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 700, px: 1 }}>
        מדדים מרכזיים
      </Typography>
      <Grid container spacing={2} sx={{ direction: "rtl", width: "100%" }}>
        {kpiItems.map((item, index) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={index}>
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 3,
                height: "100%",
                display: "flex",
                alignItems: "center",
                gap: 2,
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                border: "1px solid",
                borderColor: alpha(item.color, 0.1),
                bgcolor: alpha(item.color, 0.02),
                cursor: "pointer",
                position: "relative",
                overflow: "hidden",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: `0 12px 28px -10px ${alpha(item.color, 0.3)}`,
                  borderColor: alpha(item.color, 0.4),
                  bgcolor: "white",
                  "& .icon-box": {
                    transform: "scale(1.1) rotate(5deg)",
                    bgcolor: item.color,
                    color: "white",
                  }
                },
              }}
            >
               <Box
                className="icon-box"
                sx={{
                  width: 50,
                  height: 50,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: item.bgColor,
                  color: item.color,
                  flexShrink: 0,
                  transition: "all 0.3s ease",
                  boxShadow: `0 4px 12px ${alpha(item.color, 0.15)}`,
                }}
              >
                {React.cloneElement(item.icon as React.ReactElement<any>, { fontSize: "medium" })}
              </Box>
              
              <Box sx={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: "text.primary", lineHeight: 1.2, fontSize: "1.1rem", mb: 0.5 }}>
                  {item.title.includes("עמוסה") && typeof item.value === 'string' && item.value.length > 15 
                      ? <span style={{ fontSize: '0.9rem' }}>{item.value}</span> 
                      : item.value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                  {item.title}
                </Typography>
                {item.subtitle && (
                  <Box sx={{ mt: 1, display: "inline-block" }}>
                    <Typography variant="caption" sx={{ 
                      color: item.color, 
                      fontWeight: 700, 
                      bgcolor: alpha(item.color, 0.08), 
                      px: 1, 
                      py: 0.5, 
                      borderRadius: 1.5,
                      fontSize: "0.7rem"
                    }}>
                      {item.subtitle}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}
