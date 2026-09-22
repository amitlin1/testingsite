"use client";
import * as React from "react";
import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  type AutocompleteProps,
  type SxProps,
} from "@/components/ui";
import { useTheme } from "@/components/ui";
import { Check as CheckIcon, Lock as LockIcon } from "@/components/ui/icons";

/**
 * Shared searchable combobox used everywhere a value is selected (the
 * "unified searchable autocomplete" from the redesign spec).
 *
 * It is a thin, opinionated wrapper around the `Autocomplete` primitive so the
 * look is consistent: an input-like trigger, a floating panel with a
 * type-to-filter search, a blue checkmark on the selected row, hover
 * highlight, the selected background, and an "אין תוצאה תואמת" empty state.
 * The popper is portaled, so it floats above dialogs and is never clipped by a
 * dialog's scroll area.
 *
 * Behaviour (keyboard, highlight, the text snapping back to the chosen value
 * when the list closes, the disabled field's inert arrow) lives in the
 * primitive and is shared by every consumer. What this wrapper adds:
 * `locked` (a read-only field with a lock that never opens), `dense` (the
 * package screens' metrics), an optional option subtitle that typing also
 * matches, and the above-field / floating label variants.
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
   * Render a floating label inside the trigger instead of an above-field
   * label. Use as a drop-in in dense forms that already use floating labels,
   * so heights stay aligned with sibling fields.
   */
  floatingLabel?: string;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  /** Custom content for an option row (rendered next to the checkmark slot). */
  renderOptionContent?: (option: T, selected: boolean) => React.ReactNode;
  /** Second line under an option's label; typing matches it too. */
  getOptionSubtitle?: (option: T) => string | null | undefined;
  /** Icon rendered at the inline-start of the trigger input. */
  startIcon?: React.ReactNode;
  /** Fixed container width; when omitted the field is full-width. */
  width?: number | string;
  /** Forwarded to the trigger TextField. */
  inputSx?: SxProps;
  /** Read-only: grey field, a lock where the arrow was, never opens, no ×.
   *  Stays in the tab order (a read-only value is still content). */
  locked?: boolean;
  /**
   * The package screens' field metrics (ui.css `.sh-combo--dense`): 44px,
   * 14.5px text, × and arrow at fixed insets, compact option rows with a
   * tinted selected row. Other screens keep the default metrics so they stay
   * aligned with their TextFields.
   */
  dense?: boolean;
  /** Dense trigger height; 38 / 34 are for fields inside table rows. */
  denseHeight?: 44 | 38 | 34;
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
  filterOptions,
  getOptionLabel,
  isOptionEqualToValue,
  renderOptionContent,
  getOptionSubtitle,
  startIcon,
  width,
  noOptionsText = "אין תוצאה תואמת",
  inputSx,
  locked = false,
  dense = false,
  denseHeight = 44,
  ...rest
}: ComboboxProps<T>) {
  const theme = useTheme();
  const labelOf = React.useCallback(
    (opt: T) => (getOptionLabel ? getOptionLabel(opt) : String((opt as { label?: unknown })?.label ?? "")),
    [getOptionLabel]
  );
  const valueLabel = value != null ? labelOf(value) : "";

  // Typing also matches the subtitle. A consumer's own filterOptions wins.
  const filter = React.useMemo(() => {
    if (filterOptions || !getOptionSubtitle) return filterOptions;
    return (opts: T[], state: { inputValue: string }) => {
      const q = state.inputValue.trim().toLowerCase();
      if (!q || (value != null && state.inputValue === valueLabel)) return opts;
      return opts.filter(
        (o) => labelOf(o).toLowerCase().includes(q) || (getOptionSubtitle(o) ?? "").toLowerCase().includes(q)
      );
    };
  }, [filterOptions, getOptionSubtitle, labelOf, value, valueLabel]);

  const wrapClassName = [
    dense && "sh-combo--dense",
    dense && denseHeight !== 44 && `sh-combo--h${denseHeight}`,
    dense && startIcon && "sh-combo--icon",
    locked && "sh-combo--locked",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Box sx={{ width: width ?? (fullWidth ? "100%" : undefined) }}>
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
        filterOptions={filter}
        disabled={disabled}
        loading={loading}
        size={size}
        fullWidth={fullWidth}
        getOptionLabel={getOptionLabel}
        isOptionEqualToValue={isOptionEqualToValue}
        noOptionsText={dense ? <span className="sh-combo-empty">{noOptionsText}</span> : noOptionsText}
        renderOption={(props, option, { selected }) => {
          const { key, ...liProps } = props;
          const subtitle = getOptionSubtitle?.(option);
          const content = renderOptionContent ? renderOptionContent(option, selected) : null;
          if (dense) {
            // The selected row is shown by its tint and check (ui.css), not by
            // the primitive's blue bold text.
            const { style: _selectedText, className: _itemClass, ...denseProps } = liProps;
            return (
              <li key={key} {...denseProps} className="sh-select-item sh-combo-option">
                <span className="sh-combo-check">{selected && <CheckIcon fontSize={15} />}</span>
                <span className="sh-combo-text">
                  {content ?? labelOf(option)}
                  {subtitle && <span className="sh-combo-sub">{subtitle}</span>}
                </span>
              </li>
            );
          }
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
              {content ??
                (subtitle ? (
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14 }}>{labelOf(option)}</Typography>
                    <Typography sx={{ fontSize: 12, color: theme.tokens.muted }}>{subtitle}</Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 14 }}>{labelOf(option)}</Typography>
                ))}
            </Box>
          );
        }}
        renderInput={(params) => {
          // Locked: a read-only value that never opens. The primitive's
          // handlers are not attached, so no focus / click / key reaches it.
          const inputProps: React.InputHTMLAttributes<HTMLInputElement> = locked
            ? {
                value: valueLabel,
                readOnly: true,
                autoComplete: "off",
                onMouseDown: (e) => e.preventDefault(),
              }
            : params.inputProps;
          // The primitive already shows its own spinner while loading.
          const endAdornment = locked ? <LockIcon className="sh-combo-lock" fontSize={15} /> : params.InputProps.endAdornment;
          return (
            <TextField
              {...params}
              inputProps={inputProps}
              label={floatingLabel}
              required={floatingLabel ? required : undefined}
              placeholder={floatingLabel ? undefined : placeholder}
              error={error}
              helperText={helperText}
              wrapClassName={wrapClassName || undefined}
              InputProps={{
                ...params.InputProps,
                readOnly: locked,
                startAdornment: startIcon ? (
                  <Box sx={{ display: "flex", alignItems: "center", color: theme.tokens.muted, flexShrink: 0 }}>{startIcon}</Box>
                ) : (
                  params.InputProps.startAdornment
                ),
                endAdornment,
              }}
              sx={inputSx}
            />
          );
        }}
      />
    </Box>
  );
}
