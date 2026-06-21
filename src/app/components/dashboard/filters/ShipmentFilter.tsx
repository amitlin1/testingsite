"use client";
import * as React from "react";
import { Autocomplete, TextField, Box, Typography, Chip } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { alpha } from "@mui/material/styles";

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
    
  const value = React.useMemo(() => 
    options.find(s => s.id === selectedId) || null, 
  [options, selectedId]);

  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => onChange(newValue?.id || null)}
      getOptionLabel={(option) => option.shipment_code}
      loading={loading}
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
        <Box component="li" key={key} {...otherProps} sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", py: 0.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between" }}>
              <Typography variant="body2" fontWeight={500}>{option.shipment_code}</Typography>
              {option.is_sent && <Chip label="הושלם" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {new Date(option.shipment_date).toLocaleDateString("he-IL")}
          </Typography>
        </Box>
      )}}
      renderInput={(params) => (
        <TextField
          {...params}
          label="משלוח"
          placeholder="בחר משלוח..."
          InputProps={{
            ...params.InputProps,
            startAdornment: (
                <>
                <Box sx={{ mr: 1, display: "flex", color: "text.secondary" }}><LocalShippingIcon fontSize="small" /></Box>
                {params.InputProps.startAdornment}
                </>
            )
          }}
          disabled={loading}
          size="small"
          InputLabelProps={{ shrink: true }}
        />
      )}
      noOptionsText="אין משלוחים"
      isOptionEqualToValue={(option, val) => option.id === val.id}
    />
  );
}
