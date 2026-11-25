"use client";
import * as React from "react";
import { useToast } from "@/components/ui";

/** A settings screen's result toast, at the screen's start corner. `duration` and `dismissible` are
 *  each screen's own (the kit's defaults when left out). */
export function useSettingsToast({ duration, dismissible = true }: { duration?: number; dismissible?: boolean } = {}) {
  const toast = useToast();
  return React.useCallback(
    (message: string, severity: "success" | "error" = "success") =>
      toast.show({ message, severity, horizontal: "left", duration, dismissible }),
    [toast, duration, dismissible],
  );
}
