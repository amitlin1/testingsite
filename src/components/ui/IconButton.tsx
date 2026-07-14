"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

type Size = "small" | "medium" | "large";
type Color = "default" | "primary" | "secondary" | "error" | "success" | "warning" | "info" | "inherit";

const COLOR_CLASS: Partial<Record<Color, string>> = {
  primary: "sh-iconbtn--primary",
  error: "sh-iconbtn--error",
};

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  size?: Size;
  color?: Color;
  /** Round translucent variant, e.g. floating over a photo. */
  round?: boolean;
  edge?: "start" | "end" | false;
  href?: string;
  component?: React.ElementType;
  sx?: SxInput;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "medium", color = "default", round, edge: _edge, className, sx, style, href, component, children, type, disabled, ...rest },
  ref,
) {
  const classes = cn(
    "sh-iconbtn",
    size !== "medium" && `sh-iconbtn--${size}`,
    COLOR_CLASS[color],
    round && "sh-iconbtn--round",
    className,
  );
  const Component: React.ElementType = component || (href ? "a" : "button");
  const extra = Component === "button" ? { type: type || "button", disabled } : { href, "aria-disabled": disabled || undefined };
  return (
    <Component ref={ref} className={classes} style={{ ...sxToStyle(sx), ...style }} {...extra} {...rest}>
      {children}
    </Component>
  );
});

export default IconButton;
