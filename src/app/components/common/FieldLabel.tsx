"use client";
import * as React from "react";

/**
 * Above-field label matching the redesign spec (13px, weight 600, ink-muted-80),
 * with an optional required asterisk. Pairs with a placeholder-style input or
 * with SearchableCombobox (which renders the same label internally).
 */
export default function FieldLabel({
  children,
  required = false,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  /** The id of the field this labels — without it the label names nothing. */
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{ display: "block", marginBottom: 6, fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink-muted-80)" }}
    >
      {children}
      {required && <span style={{ color: "var(--color-destructive)", fontWeight: 700 }}>{" *"}</span>}
    </label>
  );
}
