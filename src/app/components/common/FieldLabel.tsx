"use client";
import * as React from "react";
import { Typography } from "@/components/ui";
import { useTheme } from "@/components/ui";

/**
 * Above-field label matching the redesign spec (12-13px, weight 600, #555),
 * with an optional required asterisk. Pairs with a placeholder-style input or
 * with SearchableCombobox (which renders the same label internally).
 */
export default function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  const theme = useTheme();
  return (
    <Typography
      component="label"
      sx={{ display: "block", mb: 0.75, fontSize: 13, fontWeight: 600, color: theme.tokens.fieldLabel }}
    >
      {children}
      {required && (
        <Typography component="span" sx={{ color: theme.tokens.status.destructive, fontWeight: 700 }}>
          {" *"}
        </Typography>
      )}
    </Typography>
  );
}
