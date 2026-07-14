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

export function Tooltip({ title, children, placement = "bottom", arrow, enterDelay = 200, disableHoverListener }: TooltipProps) {
  if (title == null || title === "" || disableHoverListener) return children;
  return (
    <RTooltip.Provider delayDuration={enterDelay}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content className="sh-tooltip" side={PLACEMENT[placement] ?? "bottom"} sideOffset={6} dir="rtl">
            {title}
            {arrow && <RTooltip.Arrow style={{ fill: "var(--color-ink)" }} />}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
