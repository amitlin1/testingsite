"use client";
import React from "react";
import { Info, Check } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { DialogTitle } from "@/components/ui";
import PackageIdText from "@/app/components/packages/PackageIdText";
import { PackageDialog } from "@/app/components/packages/PackageDialog";
import { BLUE, GREEN, HAIR, INK, MUTED } from "@/app/components/packages/packageUi";
import "@/app/packages/packages.css";

/**
 * The chrome shared by the package opening / closing wizards —
 * design/Package Stations.dc.html: 268px rail (station, title, box card,
 * optional item stepper, steps, worker line), body (step title + counter +
 * system message + content), footer (יציאה / הקודם / next).
 *
 * It sits in PackageDialog (ui/Dialog): Escape and a press on the backdrop
 * close it like before (not mid-save), but a dialog opened from it (labels,
 * the closing decision) now takes Escape for itself instead of closing the
 * wizard — and releasing the box — underneath. At ≤760px it fills the screen
 * with the rail on top (the artboard's tablet layout).
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
    // Moved by the rail's title or the step title (data-drag-handle).
    <PackageDialog open onClose={onClose} busy={busy} width="min(1040px, 96vw)" height="min(720px, 92vh)" fullScreenBelow760>
      <div className="pkg-wiz">
        {/* Rail */}
        <div className="pkg-wiz-rail" style={{ width: 268, padding: "20px 18px" }}>
          <div data-drag-handle="">
            <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{stationName}</div>
            <DialogTitle style={{ padding: 0, display: "block", marginTop: 3 }}>{title}</DialogTitle>
          </div>

          <div className="pkg-wiz-sub" style={{ background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 13px", marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{pkg.item_type_desc}</div>
            <div style={{ marginTop: 4 }}><PackageIdText id={pkg.item_id} size={15} headColor={INK} /></div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>{pkg.customer_name ?? pkg.customer_code ?? ""} · משלוח {pkg.shipment_code ?? "—"} · {pkg.items.length} פריטים</div>
          </div>

          {itemStepper && (
            <div className="pkg-wiz-sub" style={{ marginTop: 16, background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 13px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>פריטי המארז</div>
                <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{itemProgress}</div>
              </div>
              <div role="group" aria-label="פריטי המארז" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
                {itemStepper.map((it) => (
                  <button key={it.key} type="button" aria-current={it.active ? "step" : undefined} onClick={it.onClick}
                    className="pkg-step" style={{ alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 9 }}>
                    <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", background: it.done ? "var(--color-success-bg)" : it.active ? BLUE : "var(--color-canvas)", color: it.done ? GREEN : it.active ? "var(--color-on-primary)" : MUTED, border: `1px solid ${it.active ? BLUE : HAIR}`, fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{it.badge}</span>
                    <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 600, color: it.active ? BLUE : INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span className="pkg-sr-only">{it.badge} · </span>{it.type}
                    </span>
                    <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{it.stateLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <nav aria-label="שלבי האשף" className="pkg-wiz-steps" style={{ marginTop: 16 }}>
            {steps.map((s, i) => {
              const active = i === stepIndex && !itemStepper?.some((x) => x.active);
              const past = i < stepIndex;
              return (
                <button key={s.key} type="button" aria-current={active ? "step" : undefined} onClick={() => onStep(i)}
                  className="pkg-step" style={{ gap: 10, padding: "9px 10px" }}>
                  <span aria-hidden style={{ width: 23, height: 23, borderRadius: "50%", background: active ? BLUE : past ? "var(--color-success-bg)" : "var(--color-canvas)", color: active ? "var(--color-on-primary)" : past ? GREEN : MUTED, border: `1px solid ${active ? BLUE : HAIR}`, fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {past ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: active ? BLUE : INK, whiteSpace: "nowrap" }}>
                      {s.label}{past && <span className="pkg-sr-only"> (הושלם)</span>}
                    </span>
                    {s.note && <span className="pkg-wiz-sub" style={{ display: "block", fontSize: 11.5, color: MUTED, marginTop: 2 }}>{s.note}</span>}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="pkg-wiz-sub" style={{ marginTop: "auto", paddingTop: 14, fontSize: 11.5, color: MUTED }}>עובד: {workerName || "—"}{stationCode ? ` · עמדה ${stationCode}` : ""}</div>
        </div>

        {/* Body */}
        <div className="pkg-wiz-main">
          <div className="pkg-wiz-body">
            <div data-drag-handle="" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.3px" }}>{stepTitle}</h3>
                <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>{stepSubtitle}</div>
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{stepCounter}</div>
            </div>
            {systemMsg && (
              <div role="note" style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "color-mix(in srgb, var(--color-primary) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)", borderRadius: 12, padding: "14px 16px", marginTop: 18 }}>
                <span style={{ color: BLUE, marginTop: 1, display: "inline-flex" }}><Info size={20} strokeWidth={1.75} aria-hidden /></span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: BLUE, marginBottom: 2 }}>הודעת מערכת</div>
                  <div style={{ fontSize: 15, lineHeight: 1.5 }}>{systemMsg}</div>
                </div>
              </div>
            )}
            {children}
          </div>
          <div className="pkg-wiz-foot">
            <div style={{ fontSize: 12.5, color: MUTED }}>{footNote}</div>
            <div className="pkg-dlg-foot-actions">
              <button type="button" onClick={onClose} disabled={busy} className="pkg-pill pkg-pill--ghost pkg-pill--station">יציאה</button>
              <button type="button" onClick={onBack} disabled={busy || backDisabled} className="pkg-pill pkg-pill--ghost pkg-pill--station">הקודם</button>
              <button type="button" onClick={onNext} disabled={!nextEnabled || busy} aria-busy={busy || undefined}
                className="pkg-pill pkg-pill--primary pkg-pill--station" style={{ paddingInline: 26, fontSize: 15 }}>
                {busy ? "שומר…" : nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PackageDialog>
  );
}
