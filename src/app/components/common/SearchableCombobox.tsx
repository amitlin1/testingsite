"use client";
import * as React from "react";
import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  CircularProgress,
  type AutocompleteProps,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check as CheckIcon } from "@/components/ui/icons";
import { KeyboardArrowDown as KeyboardArrowDownIcon } from "@/components/ui/icons";

/**
 * Shared searchable combobox used everywhere a value is selected (the
 * "unified searchable autocomplete" from the redesign spec).
 *
 * It is a thin, opinionated wrapper around MUI `Autocomplete` so the look is
 * consistent: an input-like trigger, a floating panel with a type-to-filter
 * search, a blue checkmark on the selected row, hover highlight, the selected
 * background, and an "אין תוצאה תואמת" empty state. The popper is portaled, so
 * it floats above dialogs and is never clipped by a dialog's scroll area.
 *
 * Generic over the option type `T`; callers provide getOptionLabel /
 * isOptionEqualToValue when options aren't plain {id,label} objects.
 */

export interface ComboboxProps<T>
  extends Omit<
    AutocompleteProps<T, false, boolean, false>,
    "renderInput" | "renderOption" | "value" | "onChange" | "multiple" | "freeSolo"
  > {
  value: T | null;
  onChange: (value: T | null) => void;
  /** Field label rendered above the trigger (design default). */
  label?: React.ReactNode;
  /**
   * Render an MUI floating label inside the trigger instead of an above-field
   * label. Use as a drop-in for existing MUI Autocompletes in dense forms that
   * already use floating labels, so heights stay aligned with sibling fields.
   */
  floatingLabel?: string;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  /** Custom content for an option row (rendered next to the checkmark slot). */
  renderOptionContent?: (option: T, selected: boolean) => React.ReactNode;
  /** Forwarded to the trigger TextField. */
  inputSx?: object;
}

export default function SearchableCombobox<T>({
  value,
  onChange,
  label,
  floatingLabel,
  placeholder = "בחר...",
  required = false,
  error = false,
  helperText,
  loading = false,
  disabled = false,
  size = "small",
  fullWidth = true,
  getOptionLabel,
  isOptionEqualToValue,
  renderOptionContent,
  noOptionsText = "אין תוצאה תואמת",
  inputSx,
  ...rest
}: ComboboxProps<T>) {
  const theme = useTheme();
  const labelOf = React.useCallback(
    (opt: T) => (getOptionLabel ? getOptionLabel(opt) : String((opt as { label?: unknown })?.label ?? "")),
    [getOptionLabel]
  );

  return (
    <Box sx={{ width: fullWidth ? "100%" : undefined }}>
      {!floatingLabel && label && (
        <Typography
          component="label"
          sx={{ display: "block", mb: 0.75, fontSize: 13, fontWeight: 600, color: theme.tokens.fieldLabel }}
        >
          {label}
          {required && (
            <Typography component="span" sx={{ color: theme.tokens.status.destructive, fontWeight: 700 }}>
              {" *"}
            </Typography>
          )}
        </Typography>
      )}
      <Autocomplete<T, false, boolean, false>
        {...rest}
        value={value}
        onChange={(_, v) => onChange(v)}
        disabled={disabled}
        loading={loading}
        size={size}
        fullWidth={fullWidth}
        getOptionLabel={getOptionLabel}
        isOptionEqualToValue={isOptionEqualToValue}
        noOptionsText={noOptionsText}
        popupIcon={<KeyboardArrowDownIcon sx={{ color: theme.tokens.muted }} />}
        // Portaled popper floats above dialogs; keep it above the modal layer.
        slotProps={{
          popper: {
            sx: { zIndex: (t) => t.zIndex.modal + 2 },
          },
        }}
        renderOption={(props, option, { selected }) => {
          const { key, ...liProps } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
          return (
            <Box
              component="li"
              key={key}
              {...liProps}
              sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 14 }}
            >
              <Box
                sx={{
                  width: 16,
                  display: "flex",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: theme.tokens.accent,
                }}
              >
                {selected && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              {renderOptionContent ? (
                renderOptionContent(option, selected)
              ) : (
                <Typography sx={{ fontSize: 14 }}>{labelOf(option)}</Typography>
              )}
            </Box>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={floatingLabel}
            required={floatingLabel ? required : undefined}
            placeholder={floatingLabel ? undefined : placeholder}
            error={error}
            helperText={helperText}
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: `${theme.tokens.radius.field}px`,
                bgcolor: "#fff",
              },
              "& .MuiInputBase-input::placeholder": {
                color: theme.tokens.mutedSoft,
                opacity: 1,
              },
              ...inputSx,
            }}
          />
        )}
      />
    </Box>
  );
}
