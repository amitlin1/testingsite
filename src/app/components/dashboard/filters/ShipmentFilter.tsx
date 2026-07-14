"use client";
import * as React from "react";
import { Box, Typography, Chip } from "@/components/ui";
import { LocalShipping as LocalShippingIcon } from "@/components/ui/icons";
import SearchableCombobox from "../../common/SearchableCombobox";

interface ShipmentOption {
  id: number;
  shipment_code: string;
  shipment_date: string;
  is_sent: boolean | null;
}

interface ShipmentFilterProps {
  options: ShipmentOption[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
  loading?: boolean;
  width?: number | string;
}

export default function ShipmentFilter({
  options,
  selectedId,
  onChange,
  loading = false,
  width = 220,
}: ShipmentFilterProps) {
  const value = React.useMemo(
    () => options.find((s) => s.id === selectedId) || null,
    [options, selectedId]
  );

  return (
    <SearchableCombobox<ShipmentOption>
      options={options}
      value={value}
      onChange={(v) => onChange(v?.id ?? null)}
      getOptionLabel={(o) => o.shipment_code}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      loading={loading}
      floatingLabel="משלוח"
      placeholder="בחר משלוח..."
      startIcon={<LocalShippingIcon fontSize="small" />}
      width={width}
      noOptionsText="אין משלוחים"
      renderOptionContent={(option) => (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between", gap: 1 }}>
            <Typography variant="body2" fontWeight={600}>{option.shipment_code}</Typography>
            {option.is_sent && (
              <Chip label="הושלם" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {new Date(option.shipment_date).toLocaleDateString("he-IL")}
          </Typography>
        </Box>
      )}
    />
  );
}
