"use client";
import * as React from "react";
import { Paper, Typography, Box, IconButton, Collapse, alpha } from "@/components/ui";
import { KeyboardArrowDown as KeyboardArrowDownIcon } from "@/components/ui/icons";
import { KeyboardArrowUp as KeyboardArrowUpIcon } from "@/components/ui/icons";

interface DashboardCardProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  defaultExpanded?: boolean;
  sx?: any;
  elevation?: number;
}

export default function DashboardCard({
  title,
  children,
  action,
  defaultExpanded = true,
  sx = {},
  elevation = 2,
}: DashboardCardProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Paper
      elevation={1}
      sx={{
        width: "100%",
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        direction: "rtl",
        transition: "all 0.3s ease",
        ...sx,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: "white",
          borderBottom: expanded ? `1px solid ${alpha("#000", 0.05)}` : "none",
        }}
      >
        {/* Title Area */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            onClick={handleExpandClick}
            aria-expanded={expanded}
            aria-label="show more"
            size="small"
            sx={{
              transform: expanded ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.3s",
              bgcolor: alpha("#000", 0.04),
              "&:hover": { bgcolor: alpha("#000", 0.08) },
            }}
          >
            <KeyboardArrowUpIcon />
          </IconButton>
          
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: "0.95rem", sm: "1.1rem" } }}>
            {title}
          </Typography>
        </Box>

        {/* Actions Area */}
        {action && <Box>{action}</Box>}
      </Box>

      {/* Content */}
      <Collapse in={expanded} timeout="auto" unmountOnExit sx={{ flex: expanded ? 1 : 0 }}>
        <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          {children}
        </Box>
      </Collapse>
    </Paper>
  );
}

