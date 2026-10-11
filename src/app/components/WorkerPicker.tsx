"use client";
import * as React from "react";
import { Box } from "@/components/ui";
import { Person as PersonIcon } from "@/components/ui/icons";
import SearchableCombobox from "./common/SearchableCombobox";
import { apiFetch } from "@/lib/api/client";
import "@/components/items.css";

export type Worker = {
  worker_id: number;
  worker_name: string;
  /** Keycloak realm roles (from /api/workers-directory). */
  roles?: string[];
};

type WorkerPickerProps = {
  /** Selected worker id (controlled). */
  value: number | null;
  /** Change handler — receives the new id (or null on clear). */
  onChange: (workerId: number | null) => void;
  /** Optional label shown above the picker (e.g. "עובד פעיל"). */
  label?: string;
  /** Pre-fetched worker list. If omitted the component fetches /api/workers-directory itself. */
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
  /** List only workers holding at least one of these roles (e.g. the roles a
   *  screen is open to). The selected value still resolves from everyone. */
  roles?: readonly string[];
  /** Forwarded to the underlying combobox (e.g. to pin a hover panel open). */
  onOpen?: () => void;
  onClose?: () => void;
};

/**
 * Shared worker autocomplete, backed by Keycloak (/api/workers-directory —
 * no local `workers` table anymore). Two consumers today:
 *   - testing page header (persists workerId to localStorage)
 *   - ItemFilesPanel standalone mode (used inside ItemDialog where no parent workerId exists)
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
  roles,
  onOpen,
  onClose,
}: WorkerPickerProps) {
  const [workers, setWorkers] = React.useState<Worker[]>(workersProp ?? []);
  const [loading, setLoading] = React.useState(false);
  // The header (or, when hidden, a visually-hidden label) names the input.
  const inputId = React.useId();

  React.useEffect(() => {
    if (workersProp) {
      setWorkers(workersProp);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch("/api/workers-directory")
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
      {hideHeader ? (
        <label htmlFor={inputId} className="items-vh">{label}</label>
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
      <SearchableCombobox<Worker>
        id={inputId}
        size={size}
        disabled={disabled}
        options={roles ? workers.filter((w) => w.roles?.some((r) => roles.includes(r))) : workers}
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
