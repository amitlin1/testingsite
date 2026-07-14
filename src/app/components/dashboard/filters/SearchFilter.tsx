"use client";
import * as React from "react";
import { TextField, InputAdornment } from "@mui/material";
import { Search as SearchIcon } from "@/components/ui/icons";
import { alpha } from "@mui/material/styles";

interface SearchFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  width?: number | string;
  placeholder?: string;
  icon?: React.ReactNode;
}

export default function SearchFilter({
  label,
  value,
  onChange,
  width = 200,
  placeholder,
  icon,
}: SearchFilterProps) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "חיפוש..."}
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
            {icon ? (
                 <span style={{ display: 'flex', color: 'rgba(0, 0, 0, 0.54)' }}>{icon}</span>
            ) : (
                <SearchIcon fontSize="small" color="action" />
            )}
          </InputAdornment>
        ),
      }}
       // Consistent label size with Autocomplete
       InputLabelProps={{ sx: { fontSize: "0.85rem" } }}
    />
  );
}
