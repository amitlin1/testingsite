"use client";
import * as React from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui";
import { formatNet } from "@/lib/workHours/time";
import { BLUE, DANGER, FAINT, HAIRLINE, INK, MUTED, SOFT } from "./ui";

/** Modal shell matching the approved design: title row + ✕, body, sticky footer. */
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
      <DialogContent sx={{ p: 0 }}>
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <button
              type="button"
              aria-label="סגור"
              onClick={onClose}
              className="wh-x"
              style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: SOFT, border: "none", color: INK, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={18} strokeWidth={2} />
            </button>
            <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: "-0.2px" }}>{title}</div>
              {subtitle ? (
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>
              ) : null}
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 24px 4px" }}>{children}</div>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 24px 20px", flexWrap: "wrap",
          }}
        >
          {footer}
        </div>
      </DialogContent>
      <style>{`.wh-x:hover{background:#e6efff;color:${BLUE};}.wh-x:active{transform:scale(0.96);}`}</style>
    </Dialog>
  );
}

/** A pill choice-chip (day-type / scope / working yes-no). */
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
      style={{
        borderRadius: 9999,
        padding: "8px 15px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        background: active ? BLUE : "#fff",
        color: active ? "#fff" : INK,
        border: `1px solid ${active ? BLUE : HAIRLINE}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** A labelled 24h time input; `error` paints the destructive frame. */
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
    <label style={{ display: "block", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{label}</div>
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 44,
          borderRadius: 8,
          border: `1px solid ${error ? DANGER : HAIRLINE}`,
          padding: "0 12px",
          fontSize: 15,
          fontFamily: "inherit",
          fontVariantNumeric: "tabular-nums",
          color: INK,
          background: disabled ? SOFT : "#fff",
          outline: "none",
          boxShadow: error ? `0 0 0 1px ${DANGER}` : "none",
        }}
      />
    </label>
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
      <span style={{ fontSize: 13, color: FAINT }}>נטו ליום</span>
      <bdi dir="ltr" style={{ fontSize: 22, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
        {formatNet(minutes)}
      </bdi>
    </div>
  );
}
