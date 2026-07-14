"use client";
import * as React from "react";
import { ToggleButton, Tooltip, Box, Typography } from "@mui/material";
import { LocalShipping as LocalShippingIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { alpha } from "@mui/material/styles";

interface CompletedShipmentsToggleProps {
  showSent: boolean;
  onChange: (show: boolean) => void;
}

export default function CompletedShipmentsToggle({
  showSent,
  onChange,
}: CompletedShipmentsToggleProps) {
  return (
    <Tooltip title={showSent ? "הסתר משלוחים שהושלמו" : "הצג משלוחים שהושלמו"}>
      <ToggleButton
        value="check"
        selected={showSent}
        onChange={() => onChange(!showSent)}
        size="small"
        sx={{
          border: "1px solid",
          borderColor: showSent ? "success.main" : "divider",
          borderRadius: 2,
          px: 1.5,
          gap: 1,
          color: showSent ? "success.main" : "text.secondary",
          bgcolor: showSent ? alpha("#2e7d32", 0.08) : "white",
          "&:hover": {
            bgcolor: showSent ? alpha("#2e7d32", 0.15) : alpha("#000", 0.04),
            borderColor: showSent ? "success.dark" : "text.primary",
          },
          "&.Mui-selected": {
             bgcolor: alpha("#2e7d32", 0.08), 
             color: "success.main"
          }
        }}
      >
        <Box sx={{ position: "relative", display: "flex" }}>
            <LocalShippingIcon fontSize="small" />
            {showSent && (
                <CheckCircleIcon 
                    sx={{ 
                        fontSize: 12, 
                        position: "absolute", 
                        bottom: -4, 
                        right: -4, 
                        bgcolor: "white", 
                        borderRadius: "50%" 
                    }} 
                />
            )}
        </Box>
        <Typography variant="caption" fontWeight={600}>
            {showSent ? "משלוחים שהושלמו" : "משלוחים פעילים"}
        </Typography>
      </ToggleButton>
    </Tooltip>
  );
}
