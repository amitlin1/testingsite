"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";
import Image from "next/image";

/* ------------------------------------------------------------- Avatar ---- */
export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  variant?: "circular" | "rounded" | "square";
  sx?: SxInput;
}
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { src, alt, variant = "circular", sx, style, children, ...rest },
  ref,
) {
  const radius = variant === "circular" ? "50%" : variant === "rounded" ? "var(--r-sm)" : 0;
  return (
    <div
      ref={ref}
      style={{
        width: 40, height: 40, borderRadius: radius, overflow: "hidden", flexShrink: 0,
        background: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-80)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600,
        ...sxToStyle(sx), ...style,
      }}
      {...rest}
    >
      {/* Any caller-supplied URL: unoptimized (no loader, no remote-host list), sized by the frame. */}
      {src ? <Image src={src} alt={alt ?? ""} width={0} height={0} unoptimized style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : children}
    </div>
  );
});

/* ------------------------------------------------------------ Stepper ---- */
export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  activeStep?: number;
  alternativeLabel?: boolean;
  orientation?: "horizontal" | "vertical";
  sx?: SxInput;
}
export const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  { activeStep = 0, alternativeLabel, orientation = "horizontal", sx, style, children, ...rest },
  ref,
) {
  const steps = React.Children.toArray(children).filter(React.isValidElement);
  const vertical = orientation === "vertical";
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: vertical ? "stretch" : "center", gap: 0, ...sxToStyle(sx), ...style }} {...rest}>
      {steps.map((step, i) => {
        // Each child is a <Step>: its own active / completed win over the position.
        const { props } = step as React.ReactElement<StepState>;
        const completed = props.completed ?? i < activeStep;
        const active = props.active ?? i === activeStep;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{ flex: vertical ? undefined : 1, height: vertical ? 24 : 0, width: vertical ? 0 : "auto", borderTop: vertical ? undefined : "1px solid var(--color-hairline)", borderInlineStart: vertical ? "1px solid var(--color-hairline)" : undefined, margin: vertical ? "0 0 0 15px" : "0 8px", alignSelf: alternativeLabel ? "flex-start" : "center" }} />
            )}
            {React.cloneElement(step as React.ReactElement<StepState>, { index: i, active, completed })}
          </React.Fragment>
        );
      })}
    </div>
  );
});

/** What a Stepper hands each <Step>, and a Step each of its children (StepLabel…). */
type StepState = { completed?: boolean; active?: boolean; index?: number };

export interface StepProps extends React.HTMLAttributes<HTMLDivElement> {
  completed?: boolean;
  active?: boolean;
  index?: number;
  sx?: SxInput;
}
export const Step = forwardRef<HTMLDivElement, StepProps>(function Step(
  { completed, active, index, sx, style, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", ...sxToStyle(sx), ...style }} {...rest}>
      {React.Children.map(children, (c) => (React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<StepState>, { active, completed, index }) : c))}
    </div>
  );
});

export interface StepLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  completed?: boolean;
  index?: number;
  icon?: React.ReactNode;
  optional?: React.ReactNode;
  sx?: SxInput;
}
export const StepLabel = forwardRef<HTMLDivElement, StepLabelProps>(function StepLabel(
  { active, completed, index = 0, icon, optional, sx, style, children, ...rest },
  ref,
) {
  const on = active || completed;
  return (
    <div ref={ref} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...sxToStyle(sx), ...style }} {...rest}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, background: on ? "var(--color-primary)" : "var(--color-canvas-parchment)", color: on ? "var(--color-on-primary)" : "var(--color-ink-muted-48)", border: on ? "none" : "1px solid var(--color-hairline)", flexShrink: 0 }}>
        {icon ?? (completed ? "✓" : index + 1)}
      </span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: active ? 600 : 400, color: on ? "var(--color-ink)" : "var(--color-ink-muted-48)" }}>{children}</span>
        {optional && <span style={{ fontSize: 12, color: "var(--color-ink-muted-48)" }}>{optional}</span>}
      </span>
    </div>
  );
});
