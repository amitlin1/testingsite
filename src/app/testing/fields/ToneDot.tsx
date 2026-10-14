"use client";
import * as React from "react";
import type { Tone } from "@/app/lib/station-fields/schema";

/**
 * The tone of a choice option as a 6px dot (route-fields spec §0.3; the same
 * size in every artboard), coloured by the --rf-tone-* tokens. Decorative: a
 * tone is never colour alone, so the caller always renders its word beside
 * it — the option's label, or TONE_WORD. Shared by the worker rows and the
 * admin screen.
 */
export function ToneDot({ tone, className, style }: { tone: Tone; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        flex: "none",
        width: 6,
        height: 6,
        borderRadius: "var(--r-pill)",
        background: `var(--rf-tone-${tone})`,
        ...style,
      }}
    />
  );
}

export default ToneDot;
