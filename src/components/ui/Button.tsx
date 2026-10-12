"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { CircularProgress } from "./Progress";

type Variant = "contained" | "outlined" | "text" | "dark";
type Color = "primary" | "secondary" | "error" | "success" | "warning" | "info" | "inherit";
type Size = "small" | "medium" | "large";

// primary / info are the default blue; secondary reads as neutral ink.
const COLOR_CLASS: Partial<Record<Color, string>> = {
  error: "sh-btn--error",
  success: "sh-btn--success",
  warning: "sh-btn--warning",
  secondary: "sh-btn--inherit",
  inherit: "sh-btn--inherit",
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  variant?: Variant;
  color?: Color;
  size?: Size;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  fullWidth?: boolean;
  disableElevation?: boolean;
  /** In-flight: disables the button, announces busy, and swaps the start icon
   *  for a spinner (so callers stop hand-building `busy ? <Spinner/> : icon`). */
  loading?: boolean;
  href?: string;
  component?: React.ElementType;
  sx?: SxInput;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "contained",
    color = "primary",
    size = "medium",
    startIcon,
    endIcon,
    fullWidth,
    disableElevation: _e,
    loading,
    className,
    sx,
    style,
    href,
    component,
    children,
    type,
    disabled,
    ...rest
  },
  ref,
) {
  const classes = cn(
    "sh-btn",
    `sh-btn--${variant}`,
    COLOR_CLASS[color],
    size !== "medium" && `sh-btn--${size}`,
    fullWidth && "sh-btn--full",
    className,
  );
  const spinner = loading ? <CircularProgress size={size === "small" ? 14 : 16} color="inherit" aria-hidden /> : null;
  const content = (
    <>
      {spinner ?? startIcon}
      {children}
      {endIcon}
    </>
  );
  const isDisabled = disabled || loading;
  const Component: React.ElementType = component || (href ? "a" : "button");
  const extra = Component === "button"
    ? { type: type || "button", disabled: isDisabled }
    : { href, "aria-disabled": isDisabled || undefined };
  return (
    <Component
      ref={ref}
      className={classes}
      style={{ ...sxToStyle(sx), ...style }}
      aria-busy={loading || undefined}
      {...extra}
      {...rest}
    >
      {content}
    </Component>
  );
});

export default Button;
