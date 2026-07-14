"use client";
import * as React from "react";
import { Avatar, Box, Typography, alpha } from "@/components/ui";
import SearchableCombobox from "../../common/SearchableCombobox";

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

/**
 * Dashboard filter field — the unified searchable combobox (same look as the
 * "סוג פריט" field in the add-item popup), preserving per-option avatar icons.
 */
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
    <SearchableCombobox<Option>
      options={options}
      value={value}
      onChange={onChange}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      loading={loading}
      disableClearable={disableClearable}
      floatingLabel={label}
      placeholder={placeholder || label}
      startIcon={icon}
      width={width}
      noOptionsText="אין תוצאות"
      renderOptionContent={(option) => (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", minWidth: 0 }}>
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
      )}
    />
  );
}
