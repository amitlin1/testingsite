"use client";
import * as React from "react";
import { TextField, InputAdornment } from "@mui/material";
import BadgeIcon from "@mui/icons-material/Badge";
import { alpha } from "@mui/material/styles";

interface WorkerFilterProps {
  value: string | null;
  onChange: (value: string | null) => void;
  width?: number | string;
}

export default function WorkerFilter({
  value,
  onChange,
  width = 140,
}: WorkerFilterProps) {
  return (
    <TextField
      label="מס' עובד"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="12345"
      size="small"
      sx={{
        width: width,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          bgcolor: "white",
          "&:hover": {
            bgcolor: alpha("#1976d2", 0.04),
          },
        },
      }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <BadgeIcon fontSize="small" color="action" />
          </InputAdornment>
        ),
      }}
      InputLabelProps={{ shrink: true }}
    />
  );
}
