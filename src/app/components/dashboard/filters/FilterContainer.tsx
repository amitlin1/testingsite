"use client";
import * as React from "react";
import { Paper, Box, SxProps, Theme, IconButton, Collapse, Button } from "@mui/material";
import { alpha } from "@mui/material/styles";
import FilterListIcon from "@mui/icons-material/FilterList";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

interface FilterContainerProps {
  children: React.ReactNode;
  extraFilters?: React.ReactNode;
  actions?: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function FilterContainer({ children, extraFilters, actions, sx }: FilterContainerProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        mb: 2,
        borderRadius: 3,
        bgcolor: "#fff",
        border: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        transition: "all 0.2s ease",
        "&:hover": {
          borderColor: alpha("#0066cc", 0.25),
        },
        ...sx,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, width: "100%" }}>
        
        {/* Primary Filters (Right side in RTL - Start) */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, justifyContent: "flex-start", minWidth: 0 }}>
          {children}
        </Box>

        {/* Actions (Left side in RTL - End) & Expand Button */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: 40, flexShrink: 0 }}>
           {extraFilters && (
            <Button
              onClick={() => setExpanded(!expanded)}
              variant="outlined"
              size="medium"
              startIcon={expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
              sx={{ 
                minWidth: "auto",
                borderColor: expanded ? "primary.main" : "divider",
                color: expanded ? "primary.main" : "text.secondary",
                bgcolor: expanded ? alpha("#1976d2", 0.04) : "transparent",
                height: 40,
                px: 2,
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
            >
              עוד מסננים
            </Button>
          )}
          {actions}
        </Box>
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ pt: 1, borderTop: `1px dashed ${alpha("#000", 0.1)}`, display: "flex", flexWrap: "wrap", gap: 1.5, justifyContent: "flex-end" }}>
          {extraFilters}
        </Box>
      </Collapse>
    </Paper>
  );
}
