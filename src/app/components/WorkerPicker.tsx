"use client";
import * as React from "react";
import { Box, SearchableCombobox } from "@/components/ui";
import { Person as PersonIcon } from "@/components/ui/icons";
import { useWorkersDirectory } from "@/app/components/lookups";
import type { DirectoryWorker } from "@/lib/users/rules";
import { can, type Permission } from "@/lib/auth/roles";
import "@/components/items.css";

type WorkerPickerProps = {
  /** Selected worker id (controlled); onChange gets null on clear. */
  value: number | null;
  onChange: (workerId: number | null) => void;
  /** Shown above the picker (e.g. "עובד פעיל"). */
  label?: string;
  /** A red asterisk on the label. */
  required?: boolean;
  placeholder?: string;
  /** Hide the icon + label header (use inside dense panels). */
  hideHeader?: boolean;
  disabled?: boolean;
  /** Defaults to true. */
  fullWidth?: boolean;
  size?: "small" | "medium";
  /** List only workers who have this permission (e.g. the one a screen needs).
   *  The selected value still resolves from everyone. */
  perm?: Permission;
  /** Forwarded to the underlying combobox (e.g. to pin a hover panel open). */
  onOpen?: () => void;
  onClose?: () => void;
};

/**
 * Shared worker autocomplete over the Keycloak-backed workers directory
 * (/api/workers-directory — no local `workers` table any more). Used by the
 * testing dock and by ItemFilesPanel's standalone mode.
 */
export default function WorkerPicker({
  value,
  onChange,
  label = "עובד",
  required = false,
  placeholder = "בחר עובד...",
  hideHeader = false,
  disabled = false,
  fullWidth = true,
  size = "medium",
  perm,
  onOpen,
  onClose,
}: WorkerPickerProps) {
  const directory = useWorkersDirectory();
  const workers: DirectoryWorker[] = directory.data ?? [];
  // The header (or, when hidden, a visually-hidden label) names the input.
  const inputId = React.useId();

  return (
    <Box>
      {hideHeader ? (
        <label htmlFor={inputId} className="sh-visually-hidden">{label}</label>
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
          {/* Decorative glyph: muted — blue stays the colour of what you can press. */}
          <PersonIcon fontSize={18} style={{ color: "var(--color-ink-muted-48)" }} aria-hidden />
          <label htmlFor={inputId} style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, lineHeight: 1.4, color: "var(--color-ink)" }}>
            {label}
            {required && (
              <span style={{ color: "var(--color-destructive)", fontWeight: 700 }}>
                {" "}
                *
              </span>
            )}
          </label>
        </Box>
      )}
      <SearchableCombobox<DirectoryWorker>
        id={inputId}
        size={size}
        disabled={disabled}
        options={perm ? workers.filter((w) => can(w.roles, perm)) : workers}
        getOptionLabel={(option) => option.worker_name}
        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
        value={workers.find((w) => w.worker_id === value) || null}
        onChange={(newValue) => onChange(newValue?.worker_id ?? null)}
        loading={directory.isPending}
        fullWidth={fullWidth}
        placeholder={placeholder}
        onOpen={onOpen}
        onClose={onClose}
      />
    </Box>
  );
}
