"use client";
import * as React from "react";
import { Autocomplete, TextField, Avatar, Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";

interface Option {
  id: number | string;
  name: string;
  icon?: React.ReactNode;
  color?: string;
  typeId?: number;
}

interface SelectFilterProps {
  label: string;
  options: Option[];
  value: Option | null;
  onChange: (newValue: Option | null) => void;
  loading?: boolean;
  width?: number | string;
  placeholder?: string;
  icon?: React.ReactNode;
  disableClearable?: boolean;
}

export default function SelectFilter({
  label,
  options,
  value,
  onChange,
  loading = false,
  width = 200,
  placeholder,
  icon,
  disableClearable = false,
}: SelectFilterProps) {
  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => onChange(newValue)}
      getOptionLabel={(option) => option.name}
      loading={loading}
      disableClearable={disableClearable}
      size="small"
      sx={{
        width: width,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          bgcolor: "white",
          pr: 1,
          "&:hover": {
            bgcolor: alpha("#1976d2", 0.04), // soft hover
          },
        },
      }}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <Box
            key={key}
            component="li"
            {...otherProps}
            sx={{ display: "flex", gap: 1, alignItems: "center" }}
          >
            {option.icon && (
              <Avatar
                sx={{
                  width: 24,
                  height: 24,
                  bgcolor: option.color ? alpha(option.color, 0.1) : "transparent",
                  color: option.color || "text.secondary",
                  fontSize: 14,
                }}
              >
                {option.icon}
              </Avatar>
            )}
            <Typography variant="body2">{option.name}</Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder || label}
          variant="outlined"
          InputProps={{
            ...params.InputProps,
            startAdornment: icon ? (
              <Box sx={{ mr: 1, display: "flex", color: "text.secondary" }}>{icon}</Box>
            ) : null,
          }}
          disabled={loading}
          size="small"
          // Keep label readable
          InputLabelProps={{ sx: { fontSize: "0.85rem" } }}
        />
      )}
      noOptionsText="אין תוצאות"
      isOptionEqualToValue={(option, val) => option.id === val.id}
    />
  );
}
