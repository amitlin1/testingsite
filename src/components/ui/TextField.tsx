"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { Select } from "./Select";

/* ------------------------------------------------------ InputAdornment --- */
export function InputAdornment({ children }: { position?: "start" | "end"; children: React.ReactNode }) {
  return <span className="sh-adornment">{children}</span>;
}

/* -------------------------------------------------------------- Field --- */
export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix" | "value"> {
  // react-hook-form fields can hand us null.
  value?: string | number | readonly string[] | null;
  label?: React.ReactNode;
  error?: boolean;
  helperText?: React.ReactNode;
  fullWidth?: boolean;
  multiline?: boolean;
  rows?: number;
  minRows?: number;
  maxRows?: number;
  hiddenLabel?: boolean;
  size?: "small" | "medium";
  variant?: string;
  margin?: string;
  select?: boolean;
  InputProps?: {
    startAdornment?: React.ReactNode;
    endAdornment?: React.ReactNode;
    readOnly?: boolean;
    sx?: SxInput;
  };
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  InputLabelProps?: Record<string, unknown>;
  FormHelperTextProps?: Record<string, unknown>;
  sx?: SxInput;
  containerClassName?: string;
  wrapClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    error,
    helperText,
    fullWidth,
    multiline,
    rows = 3,
    minRows,
    maxRows: _mr,
    hiddenLabel: _hl,
    size,
    variant: _v,
    margin: _m,
    select,
    InputProps,
    inputProps,
    inputRef,
    InputLabelProps: _il,
    FormHelperTextProps: _fh,
    sx,
    style,
    className,
    containerClassName,
    wrapClassName,
    id,
    required,
    disabled,
    children,
    type = "text",
    ...rest
  },
  ref,
) {
  const start = InputProps?.startAdornment;
  const end = InputProps?.endAdornment;
  const wrapStyle = { ...sxToStyle(InputProps?.sx), ...sxToStyle(sx), ...style };

  const field = select ? (
    <Select
      error={error}
      disabled={disabled}
      fullWidth
      value={(rest.value as string) ?? ""}
      onChange={rest.onChange as never}
      name={rest.name}
    >
      {children}
    </Select>
  ) : (
    <div
      className={cn(
        "sh-input-wrap",
        error && "sh-input--error",
        disabled && "sh-input--disabled",
        multiline && "sh-input--multiline",
        wrapClassName,
      )}
      style={wrapStyle}
    >
      {start && <span className="sh-adornment">{start}</span>}
      {multiline ? (
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          id={id}
          required={required}
          disabled={disabled}
          rows={rows ?? minRows}
          className={className}
          {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          {...(inputProps as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          ref={(node) => {
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
            if (typeof inputRef === "function") inputRef(node);
            else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          id={id}
          type={type}
          required={required}
          disabled={disabled}
          readOnly={InputProps?.readOnly}
          className={className}
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
          {...inputProps}
        />
      )}
      {end && <span className="sh-adornment">{end}</span>}
    </div>
  );

  return (
    <div
      className={containerClassName}
      style={{ width: fullWidth ? "100%" : undefined, display: fullWidth ? "block" : "inline-block" }}
    >
      {label != null && label !== "" && (
        <label htmlFor={id} className={cn("sh-field-label", error && "sh-field-label--error")}>
          {label}
          {required ? " *" : ""}
        </label>
      )}
      {field}
      {helperText != null && helperText !== "" && (
        <div className={cn("sh-field-helper", error && "sh-field-helper--error")}>{helperText}</div>
      )}
    </div>
  );
});

/* --------------------------------------------------------- SearchInput --- */
export interface SearchInputProps extends Omit<TextFieldProps, "InputProps"> {}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className, ...props },
  ref,
) {
  return (
    <TextField
      ref={ref}
      className={className}
      wrapClassName="sh-input--search"
      InputProps={{ startAdornment: <SearchGlyph /> }}
      {...props}
    />
  );
});

function SearchGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default TextField;
