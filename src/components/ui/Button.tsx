"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

type Variant = "contained" | "outlined" | "text" | "dark";
type Color = "primary" | "secondary" | "error" | "success" | "warning" | "info" | "inherit";
type Size = "small" | "medium" | "large";

const COLOR_CLASS: Partial<Record<Color, string>> = {
  error: "sh-btn--error",
  success: "sh-btn--success",
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
  const content = (
    <>
      {startIcon}
      {children}
      {endIcon}
    </>
  );
  const Component: React.ElementType = component || (href ? "a" : "button");
  const extra = Component === "button" ? { type: type || "button", disabled } : { href, "aria-disabled": disabled || undefined };
  return (
    <Component ref={ref} className={classes} style={{ ...sxToStyle(sx), ...style }} {...extra} {...rest}>
      {content}
    </Component>
  );
});

export default Button;
