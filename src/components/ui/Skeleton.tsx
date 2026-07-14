"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "text" | "rectangular" | "rounded" | "circular";
  width?: number | string;
  height?: number | string;
  animation?: "pulse" | "wave" | false;
  sx?: SxInput;
}

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { variant = "text", width, height, animation = "wave", sx, style, ...rest },
  ref,
) {
  const radius =
    variant === "circular" ? "50%" : variant === "rounded" ? "var(--r-sm)" : variant === "text" ? "var(--r-xs)" : 0;
  const base: React.CSSProperties = {
    display: "block",
    width: width ?? (variant === "text" ? "100%" : 40),
    height: height ?? (variant === "text" ? "1em" : 40),
    borderRadius: radius,
    background:
      animation === "wave"
        ? "linear-gradient(90deg,#eee,#f5f5f7,#eee)"
        : "var(--color-canvas-parchment)",
    backgroundSize: animation === "wave" ? "200% 100%" : undefined,
    animation: animation === "wave" ? "sh-shimmer 1.4s infinite" : animation === "pulse" ? "sh-pulse 1.5s ease-in-out infinite" : undefined,
  };
  return <span ref={ref} style={{ ...base, ...sxToStyle(sx), ...style }} {...rest} />;
});
