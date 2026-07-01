"use client";
import * as React from "react";
import { Box, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import SearchableCombobox from "./common/SearchableCombobox";

export type Worker = {
  worker_id: number;
  worker_name: string;
};

type WorkerPickerProps = {
  /** Selected worker id (controlled). */
  value: number | null;
  /** Change handler — receives the new id (or null on clear). */
  onChange: (workerId: number | null) => void;
  /** Optional label shown above the picker (e.g. "עובד פעיל"). */
  label?: string;
  /** Pre-fetched worker list. If omitted the component fetches /api/settings/workers itself. */
  workers?: Worker[];
  /** Show a small required asterisk and red color on the label. */
  required?: boolean;
  /** Override the placeholder text. */
  placeholder?: string;
  /** Hide the icon + label header (use inside dense panels). */
  hideHeader?: boolean;
  /** Disable interaction. */
  disabled?: boolean;
  /** Make the input full-width. Defaults to true. */
  fullWidth?: boolean;
  /** Smaller variant for headers/toolbars. */
  size?: "small" | "medium";
  /** Forwarded to the underlying combobox (e.g. to pin a hover panel open). */
  onOpen?: () => void;
  onClose?: () => void;
};

/**
 * Shared worker autocomplete. Two consumers today:
 *   - testing page header (persists workerId to localStorage)
 *   - ItemFilesPanel standalone mode (used inside ItemDialog where no parent workerId exists)
 *
 * When auth lands (smart-card per the project plan), this is the single place to swap.
 */
export default function WorkerPicker({
  value,
  onChange,
  label = "עובד",
  workers: workersProp,
  required = false,
  placeholder = "בחר עובד...",
  hideHeader = false,
  disabled = false,
  fullWidth = true,
  size = "medium",
  onOpen,
  onClose,
}: WorkerPickerProps) {
  const [workers, setWorkers] = React.useState<Worker[]>(workersProp ?? []);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (workersProp) {
      setWorkers(workersProp);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/settings/workers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setWorkers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setWorkers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workersProp]);

  return (
    <Box>
      {!hideHeader && (
        <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
          <PersonIcon color="primary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight={700} color="text.primary">
            {label}
            {required && (
              <Typography component="span" color="error" fontWeight={700}>
                {" "}
                *
              </Typography>
            )}
          </Typography>
        </Box>
      )}
      <SearchableCombobox<Worker>
        size={size}
        disabled={disabled}
        options={workers}
        getOptionLabel={(option) => option.worker_name}
        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
        value={workers.find((w) => w.worker_id === value) || null}
        onChange={(newValue) => onChange(newValue?.worker_id ?? null)}
        loading={loading}
        fullWidth={fullWidth}
        placeholder={placeholder}
        onOpen={onOpen}
        onClose={onClose}
      />
    </Box>
  );
}
