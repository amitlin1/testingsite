"use client";
import * as React from "react";
import { Box, Typography } from "@/components/ui";
import { StatusFilter } from "@/types/dashboard";
import { Info as InfoIcon } from "@/components/ui/icons";
import SearchableCombobox from "../../common/SearchableCombobox";

interface StatusFilterProps {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
  width?: number | string;
  icon?: React.ReactNode;
}

interface StatusOption {
  id: StatusFilter;
  name: string;
  color: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { id: "all", name: "הכל", color: "#757575" },
  { id: "queue", name: "בהמתנה", color: "#ED6C02" },
  { id: "processing", name: "בבדיקה", color: "#1976D2" },
  { id: "finished", name: "הסתיים", color: "#2E7D32" },
];

export default function StatusFilterComponent({ value, onChange, width = 180, icon }: StatusFilterProps) {
  const selectedOption = React.useMemo(
    () => STATUS_OPTIONS.find((o) => o.id === value) || STATUS_OPTIONS[0],
    [value]
  );

  return (
    <SearchableCombobox<StatusOption>
      options={STATUS_OPTIONS}
      value={selectedOption}
      onChange={(v) => onChange(v ? v.id : "all")}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      disableClearable
      floatingLabel="סטטוס"
      placeholder="בחר סטטוס"
      startIcon={icon || <InfoIcon fontSize="small" />}
      width={width}
      renderOptionContent={(option) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: option.color }} />
          <Typography variant="body2">{option.name}</Typography>
        </Box>
      )}
    />
  );
}
