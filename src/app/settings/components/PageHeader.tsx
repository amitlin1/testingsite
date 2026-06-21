"use client";
import { Box, Typography } from "@mui/material";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export default function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <Box sx={{ 
      textAlign: "center", 
      flexShrink: 0,
      width: "100%", 
      p: 1,
      borderBottom: "1px solid",
      borderColor: "divider"
    }}>
      <Typography variant="h5" sx={{ fontWeight: 700, color: "#333", fontSize: "1.4rem" }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}
