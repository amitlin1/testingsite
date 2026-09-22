"use client";
import React from "react";
import { Info, Check } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import PackageIdText from "@/app/components/packages/PackageIdText";
import { DIALOG_Z, BLUE, GREEN, HAIR, INK, MUTED, MUTED_LT, SHADOW } from "@/app/components/packages/packageUi";

/**
 * The chrome shared by the package opening / closing wizards —
 * design/Package Stations.dc.html: 268px rail (station, title, box card,
 * optional item stepper, steps, worker line), body (step title + counter +
 * system message + content), footer (יציאה / הקודם / next).
 */
export type WizardStep = { key: string; label: string; note: string };
export type ItemStepperRow = { key: string; type: string; badge: string; stateLabel: string; active: boolean; done: boolean; onClick: () => void };

export default function PackageWizardShell({
  open, onClose, stationName, stationCode, title, pkg, workerName,
  steps, stepIndex, onStep, itemStepper, itemProgress,
  stepTitle, stepSubtitle, stepCounter, systemMsg, footNote,
  backDisabled, onBack, nextLabel, nextEnabled, onNext, busy, children,
}: {
  open: boolean;
  onClose: () => void;
  stationName: string;
  stationCode?: string | null;
  title: string;
  pkg: PackageView;
  workerName: string;
  steps: WizardStep[];
  stepIndex: number;
  onStep: (i: number) => void;
  itemStepper?: ItemStepperRow[] | null;
  itemProgress?: string;
  stepTitle: string;
  stepSubtitle: string;
  stepCounter: string;
  systemMsg?: string | null;
  footNote: string;
  backDisabled: boolean;
  onBack: () => void;
  nextLabel: string;
  nextEnabled: boolean;
  onNext: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: DIALOG_Z - 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div dir="rtl" style={{ width: "min(1040px, 96vw)", height: "min(720px, 92vh)", background: "#fff", borderRadius: 18, boxShadow: SHADOW, display: "flex", overflow: "hidden", color: INK }}>
        {/* Rail */}
        <div style={{ width: 268, flexShrink: 0, background: "#f5f5f7", borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", padding: "20px 18px", overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{stationName}</div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 3 }}>{title}</div>

          <div style={{ background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 13px", marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{pkg.item_type_desc}</div>
            <div style={{ marginTop: 4 }}><PackageIdText id={pkg.item_id} size={15} headColor={INK} /></div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>{pkg.customer_name ?? pkg.customer_code ?? ""} · משלוח {pkg.shipment_code ?? "—"} · {pkg.items.length} פריטים</div>
          </div>

          {itemStepper && (
            <div style={{ marginTop: 16, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 13px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".5px", textTransform: "uppercase" }}>פריטי המארז</div>
                <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{itemProgress}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
                {itemStepper.map((it) => (
                  <div key={it.key} onClick={it.onClick} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 9, background: it.active ? "#e6efff" : "transparent", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: it.done ? "rgba(31,138,91,0.1)" : it.active ? BLUE : "#fff", color: it.done ? GREEN : it.active ? "#fff" : MUTED, border: `1px solid ${it.active ? BLUE : HAIR}`, fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{it.badge}</span>
                    <div style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 600, color: it.active ? BLUE : INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.type}</div>
                    <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{it.stateLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 16 }}>
            {steps.map((s, i) => {
              const active = i === stepIndex && !itemStepper?.some((x) => x.active);
              const past = i < stepIndex;
              return (
                <div key={s.key} onClick={() => onStep(i)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px", borderRadius: 10, background: active ? "#e6efff" : "transparent", cursor: "pointer" }}>
                  <span style={{ width: 23, height: 23, borderRadius: "50%", background: active ? BLUE : past ? "rgba(31,138,91,0.1)" : "#fff", color: active ? "#fff" : past ? GREEN : MUTED, border: `1px solid ${active ? BLUE : HAIR}`, fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {past ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: active ? BLUE : INK, whiteSpace: "nowrap" }}>{s.label}</div>
                    {s.note && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{s.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "auto", paddingTop: 14, fontSize: 11.5, color: MUTED }}>עובד: {workerName || "—"}{stationCode ? ` · עמדה ${stationCode}` : ""}</div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.3px" }}>{stepTitle}</div>
                <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>{stepSubtitle}</div>
              </div>
              <div style={{ fontSize: 12.5, color: MUTED_LT, whiteSpace: "nowrap", flexShrink: 0 }}>{stepCounter}</div>
            </div>
            {systemMsg && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "rgba(0,102,204,0.05)", border: "1px solid rgba(0,102,204,0.15)", borderRadius: 12, padding: "14px 16px", marginTop: 18 }}>
                <span style={{ color: BLUE, marginTop: 1, display: "inline-flex" }}><Info size={20} strokeWidth={1.75} /></span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: BLUE, marginBottom: 2 }}>הודעת מערכת</div>
                  <div style={{ fontSize: 15, lineHeight: 1.5 }}>{systemMsg}</div>
                </div>
              </div>
            )}
            {children}
          </div>
          <div style={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: MUTED }}>{footNote}</div>
            <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ minHeight: 44, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "11px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: INK }}>יציאה</button>
              <button type="button" onClick={onBack} disabled={busy || backDisabled} style={{ minHeight: 44, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "11px 18px", fontSize: 14, fontWeight: 600, color: backDisabled ? MUTED_LT : INK, cursor: "pointer", fontFamily: "inherit" }}>הקודם</button>
              <button type="button" onClick={onNext} disabled={!nextEnabled || busy} style={{ minHeight: 44, background: nextEnabled ? BLUE : HAIR, color: nextEnabled ? "#fff" : MUTED_LT, border: 0, borderRadius: 9999, padding: "11px 26px", fontSize: 15, fontWeight: 600, cursor: nextEnabled ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                {busy ? "שומר…" : nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
