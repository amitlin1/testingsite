"use client";
import * as React from "react";
import {
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Box,
  Popover,
  Button,
  Typography,
} from "@mui/material";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { DateRangePreset } from "@/types/dashboard";
import { alpha } from "@mui/material/styles";

interface DateFilterProps {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  customStart: string;
  onCustomStartChange: (date: string) => void;
  customEnd: string;
  onCustomEndChange: (date: string) => void;
}

export default function DateFilter({
  preset,
  onPresetChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
}: DateFilterProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLButtonElement | null>(null);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);
  const id = open ? "date-filter-popover" : undefined;

  const getLabel = () => {
    switch (preset) {
      case "today":
        return "היום";
      case "last7days":
        return "7 ימים אחרונים";
      case "last30days":
        return "30 ימים אחרונים";
      case "custom":
        return "טווח מותאם";
      default:
        return "תאריך";
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        onClick={handleClick}
        startIcon={<CalendarTodayIcon />}
        endIcon={<ArrowDropDownIcon />}
        size="small"
        sx={{
          color: "text.primary",
          borderColor: "divider",
          bgcolor: "white",
          borderRadius: 2,
          px: 1.5,
          textTransform: "none",
          fontWeight: 500,
          "&:hover": {
            bgcolor: alpha("#1976d2", 0.04),
            borderColor: "primary.main",
          },
        }}
      >
        {getLabel()}
      </Button>
      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        PaperProps={{
          sx: { p: 2, mt: 1, borderRadius: 3, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 200 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
            טווח תאריכים
          </Typography>
          <ToggleButtonGroup
            value={preset}
            exclusive
            onChange={(_, newPreset) => {
              if (newPreset) {
                onPresetChange(newPreset);
                if (newPreset !== "custom") handleClose();
              }
            }}
            orientation="vertical"
            size="small"
            sx={{ width: "100%" }}
          >
            <ToggleButton value="today" sx={{ justifyContent: "flex-start", px: 2 }}>
              היום (07:00 - 16:00)
            </ToggleButton>
            <ToggleButton value="last7days" sx={{ justifyContent: "flex-start", px: 2 }}>
              7 ימים אחרונים
            </ToggleButton>
            <ToggleButton value="last30days" sx={{ justifyContent: "flex-start", px: 2 }}>
              30 ימים אחרונים
            </ToggleButton>
            <ToggleButton value="custom" sx={{ justifyContent: "flex-start", px: 2 }}>
              מותאם אישית
            </ToggleButton>
          </ToggleButtonGroup>

          {preset === "custom" && (
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <TextField
                type="date"
                label="התחלה"
                value={customStart}
                onChange={(e) => onCustomStartChange(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
                sx={{ width: 140 }}
              />
              <TextField
                type="date"
                label="סיום"
                value={customEnd}
                onChange={(e) => onCustomEndChange(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
                sx={{ width: 140 }}
              />
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
}
