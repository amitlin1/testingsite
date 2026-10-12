"use client";
import * as React from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField } from "@/components/ui";
import { formatNet } from "@/lib/workHours/time";
import { FAINT, HAIRLINE, INK, MUTED } from "./ui";

/** The work-hours dialog frame: the shared DialogTitle (one size, the one
 *  named × at the inline end) with a muted subtitle, the body, and the
 *  standard footer (DialogActions: Cancel, then the action last). */
export function DialogShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth dir="rtl">
      <DialogTitle onClose={onClose}>
        <span style={{ minWidth: 0 }}>
          {title}
          {subtitle ? (
            <span style={{ display: "block", fontFamily: "var(--font-text)", fontSize: "var(--text-small)", fontWeight: 400, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
              {subtitle}
            </span>
          ) : null}
        </span>
      </DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions style={{ flexWrap: "wrap" }}>{footer}</DialogActions>
    </Dialog>
  );
}

/** A pill choice-chip (day-type / scope / working yes-no). States in
 *  settings.css (.wh-chip): hover, pressed, focus, disabled. */
export function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="wh-chip"
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/** A labelled 24h time input on the shared TextField (label tied to the
 *  field, the system focus ring); `error` paints the destructive frame. */
export function TimeField({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
}) {
  return (
    <TextField
      type="time"
      label={label}
      value={value}
      disabled={disabled}
      error={error}
      onChange={(e) => onChange(e.target.value)}
      fullWidth
      inputProps={{ style: { fontVariantNumeric: "tabular-nums" } }}
    />
  );
}

/** The live "נטו ליום" row shown above the footer. */
export function NetRow({ minutes }: { minutes: number }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        borderTop: `1px solid ${HAIRLINE}`, marginTop: 14, paddingTop: 14,
      }}
    >
      <span style={{ fontSize: "var(--text-small)", color: FAINT }}>נטו ליום</span>
      <bdi dir="ltr" style={{ fontSize: "var(--text-heading)", fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
        {formatNet(minutes)}
      </bdi>
    </div>
  );
}
