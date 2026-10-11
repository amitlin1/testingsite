"use client";
import React from "react";
import * as RTooltip from "@radix-ui/react-tooltip";

const PLACEMENT: Record<string, RTooltip.TooltipContentProps["side"]> = {
  top: "top", bottom: "bottom", left: "left", right: "right",
  "top-start": "top", "top-end": "top", "bottom-start": "bottom", "bottom-end": "bottom",
};

export interface TooltipProps {
  title?: React.ReactNode;
  children: React.ReactElement;
  placement?: string;
  arrow?: boolean;
  enterDelay?: number;
  disableHoverListener?: boolean;
  disableInteractive?: boolean;
}

/** Mounted once (providers.tsx). Sharing it is what makes "skip delay" work:
 *  once one tooltip has opened, moving to the next opens it immediately. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300} skipDelayDuration={400}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({ title, children, placement = "bottom", arrow, enterDelay = 300, disableHoverListener }: TooltipProps) {
  if (title == null || title === "" || disableHoverListener) return children;
  return (
    <RTooltip.Root delayDuration={enterDelay}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="sh-tooltip" side={PLACEMENT[placement] ?? "bottom"} sideOffset={6} dir="rtl">
          {title}
          {arrow && <RTooltip.Arrow style={{ fill: "var(--color-ink)" }} />}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
