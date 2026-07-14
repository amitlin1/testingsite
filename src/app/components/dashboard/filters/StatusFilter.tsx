"use client";
import * as React from "react";
import { Autocomplete, TextField, Box, Typography, Chip } from "@/components/ui";
import { StatusFilter } from "@/types/dashboard";
import { alpha } from "@/components/ui";
import { Info as InfoIcon } from "@/components/ui/icons";

interface StatusFilterProps {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
  width?: number | string;
  icon?: React.ReactNode;
}

const STATUS_OPTIONS: { id: StatusFilter; name: string; color: string }[] = [
  { id: "all", name: "הכל", color: "#757575" },
  { id: "queue", name: "בהמתנה", color: "#ED6C02" },
  { id: "processing", name: "בבדיקה", color: "#1976D2" },
  { id: "finished", name: "הסתיים", color: "#2E7D32" },
];

export default function StatusFilterComponent({
  value,
  onChange,
  width = 180,
  icon,
}: StatusFilterProps) {
    
  const selectedOption = React.useMemo(() => 
    STATUS_OPTIONS.find(o => o.id === value) || STATUS_OPTIONS[0],
  [value]);

  return (
    <Autocomplete
      options={STATUS_OPTIONS}
      value={selectedOption}
      onChange={(_, newValue) => onChange(newValue ? newValue.id : "all")}
      getOptionLabel={(option) => option.name}
      disableClearable
      size="small"
      sx={{
        width: width,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          bgcolor: "white",
          "&:hover": { bgcolor: alpha("#1976d2", 0.04) },
        },
      }}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
            <Box component="li" key={key} {...otherProps} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                 <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: option.color }} />
                 <Typography variant="body2">{option.name}</Typography>
            </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="סטטוס"
          placeholder="בחר סטטוס"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
                <>
                <Box sx={{ mr: 1, display: "flex", color: "text.secondary" }}>
                    {icon || <InfoIcon fontSize="small" />}
                </Box>
                {params.InputProps.startAdornment}
                </>
            )
          }}
          size="small"
          InputLabelProps={{ sx: { fontSize: "0.85rem" } }} // Consistent label size
        />
      )}
      isOptionEqualToValue={(option, val) => option.id === val.id}
    />
  );
}
