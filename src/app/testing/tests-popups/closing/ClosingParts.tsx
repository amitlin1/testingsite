"use client";
import React from "react";
import { Check } from "lucide-react";
import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";
import { FieldsBlockFallback, PackFieldsBand, PackFieldsPending, PackItemFields } from "@/app/testing/fields/FieldsBlock";
import type { UploadFieldPhoto } from "@/app/testing/fields/FieldRow";
import { BLOCK_TITLE } from "@/app/testing/fields/fieldsBlockModel";
import { inputFieldCount } from "@/app/testing/fields/drafts";
import type { StationFieldsState } from "@/app/testing/fields/useStationFields";
import { StepBackButton, useBoxItemStepBack } from "@/app/testing/stepBack";
import { AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG } from "@/components/ui/colors";
import { PACKAGE_POPUP_TEXT } from "../boxWizard";
import { NextStationList, type NextStopRow } from "../nextStation";
import type { RefLookup } from "../reference";
import { ScanField, type RefSku } from "../referenceScan";
import PackageDecisionDialog from "./PackageDecisionDialog";
import { CLOSING_TEXT, closingSkusLabel, type Decision } from "./closingModel";
import type { ClosingItemFields } from "./useClosingItemFields";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/** The closing wizards' steps that the code's wizard and a template draw alike. */

/** The box label's scan, starting from the one scanned at the opening when `prev` says so. */
export function ClosingBoxScan({ pkg, value, onChange, lookup, onSubmit, prev, suggestions }: {
  pkg: PackageView; value: string; onChange: (v: string) => void;
  lookup: { checking: boolean; ref: RefLookup | null }; onSubmit: () => void;
  prev?: string | null; suggestions: { skus: RefSku[]; fromOpening: boolean };
}) {
  return (
    <ScanField
      label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
      value={value} onChange={onChange} lookup={lookup} onSubmit={onSubmit}
      found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${pkg.items.length} פריטים · ${pkg.customer_code ?? ""}`}
      missing={CLOSING_TEXT.boxScanMissing(pkg.item_type_desc)}
      prev={prev} filledNote={CLOSING_TEXT.boxScanFilled}
      suggestions={suggestions.skus} suggestionsLabel={closingSkusLabel(pkg, suggestions.fromOpening)} />
  );
}

/**
 * "פריטים ואריזה": an arrived item is marked "נארז"; one that did not arrive needs an explicit
 * decision. With station fields, each kit item's nest under its row (artboard 17). A manager may
 * send an arrived item back to the test before (the page's "החזר", stepBack.tsx).
 */
export function ArrivalList({ items, packed, decisions, onPacked, onDecide, fields, fieldsWaiting, sf, uploadPhotoFor, submitting }: {
  items: PackageItemView[];
  packed: Readonly<Record<string, boolean>>;
  decisions: Readonly<Record<string, Decision>>;
  onPacked: (it: PackageItemView, packed: boolean) => void;
  onDecide: (it: PackageItemView) => void;
  fields: ClosingItemFields;
  fieldsWaiting: boolean;
  sf: StationFieldsState;
  uploadPhotoFor: (itemId: string) => UploadFieldPhoto;
  submitting: boolean;
}) {
  const stepBackItem = useBoxItemStepBack();
  const allResolved = items.length > 0 && items.every((it) => (it.arrived_at_closing ? packed[it.item_id] === true : decisions[it.item_id] != null));
  return (
    <div style={{ marginTop: 20 }}>
      {fieldsWaiting && <div style={{ marginBottom: 14 }}><FieldsBlockFallback sf={sf} /></div>}
      <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden" }}>
        {fields.on && <PackFieldsBand title={BLOCK_TITLE.closing} count={fields.shown.reduce((n, f) => n + inputFieldCount(f.defs), 0)} />}
        {items.map((it) => {
          const isArr = it.arrived_at_closing;
          const d = decisions[it.item_id];
          const isPacked = packed[it.item_id] === true;
          const name = `${seq2(it.package_seq)} · ${it.item_type_desc}`;
          const row = (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderBottom: `1px solid ${HAIR_2}`, background: isArr ? "var(--color-canvas)" : AMBER_BG, flexWrap: "wrap" }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: isArr ? "var(--color-canvas-parchment)" : "color-mix(in srgb, var(--color-warning-ink) 10%, transparent)", color: isArr ? MUTED : AMBER_INK, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</span>
                  <StepBackButton it={it} onClick={submitting ? null : stepBackItem?.(it)} />
                </div>
                <div style={{ fontSize: 12.5, color: isArr ? MUTED : AMBER_INK, marginTop: 2 }}>
                  {isArr ? `הגיע לסגירה · ${it.serial_no ?? "ללא סריאלי"}` : `לא הגיע · סיים את המסלול ${it.station_name ? `בעמדת ${it.station_name}` : "במקום אחר"}`}
                </div>
              </div>
              {isArr ? (
                // A real checkbox for the keyboard: Tab, then Space / Enter.
                <button type="button" role="checkbox" aria-checked={isPacked} aria-label={`${name} · נארז`}
                  onClick={() => onPacked(it, !isPacked)}
                  className="pkg-choice pkg-choice--soft pkg-press"
                  style={{ width: "auto", display: "flex", alignItems: "center", gap: 9, minHeight: 44, padding: "8px 14px", borderRadius: 11 }}>
                  <span aria-hidden className={isPacked ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 20, height: 20, borderRadius: 6, borderColor: isPacked ? undefined : "var(--color-field-border)" }}>{isPacked && <Check size={12} strokeWidth={2.5} />}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: isPacked ? BLUE : INK }}>נארז</span>
                </button>
              ) : (
                <button type="button" onClick={() => onDecide(it)} aria-haspopup="dialog" aria-label={`${name} · ${d == null ? "נדרשת החלטה" : d.decision === "packed_anyway" ? "נארז בכל זאת" : "חסר במארז"}`}
                  className="pkg-pill pkg-pill--station"
                  style={{ background: d == null ? "var(--color-canvas)" : d.decision === "packed_anyway" ? "var(--color-primary-soft)" : RED_BG, color: d == null ? AMBER_INK : d.decision === "packed_anyway" ? BLUE : RED, borderColor: d == null ? AMBER_BORDER : d.decision === "packed_anyway" ? BLUE : "color-mix(in srgb, var(--color-destructive) 25%, transparent)", padding: "10px 18px" }}>
                  {d == null ? "נדרשת החלטה" : d.decision === "packed_anyway" ? "נארז בכל זאת" : "חסר במארז"}
                </button>
              )}
            </div>
          );
          if (!fields.on) return <React.Fragment key={it.item_id}>{row}</React.Fragment>;
          // Artboard 17: the item's row, then its fields — or, while it waits for a decision, a
          // line that they come after it; "חסר במארז" has none.
          const f = fields.byItem.get(it.item_id);
          return (
            <div key={it.item_id} role="group" aria-label={name}>
              {row}
              {f && (f.shown
                ? <PackItemFields fields={f.defs} fx={f.fx} uploadPhoto={uploadPhotoFor(it.item_id)} />
                : d == null && <PackFieldsPending />)}
            </div>
          );
        })}
      </div>
      {!allResolved && (
        <div role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "11px 14px", marginTop: 14 }}>{CLOSING_TEXT.arrivalHold}</div>
      )}
    </div>
  );
}

/** The done step: what was packed and what is missing, and where the box goes next. `children`
 *  go between the count and the next stations. */
export function ClosingDone({ items, decisions, pkg, doneRows, children }: {
  items: PackageItemView[]; decisions: Readonly<Record<string, Decision>>; pkg: PackageView; doneRows: NextStopRow[]; children?: React.ReactNode;
}) {
  const missing = (it: PackageItemView) => decisions[it.item_id]?.decision === "missing";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
      <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-success-bg)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} aria-hidden /></span>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>המארז נסגר</div>
      <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>המארז והפריטים שבו סומנו כנארזו. המארז עובר לסטטוס הושלם ומופיע במשלוח כמארז שסיים.</div>
      <div role="img" aria-label={items.map((it) => `${seq2(it.package_seq)} · ${it.item_type_desc} · ${missing(it) ? "חסר במארז" : "נארז"}`).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
        {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: missing(it) ? RED : GREEN }} />)}
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.filter((it) => !missing(it)).length} פריטים נארזו · {pkg.item_type_desc}</div>
      {children}
      <NextStationList rows={doneRows} />
    </div>
  );
}

/** The decision for an item that did not arrive. Mounted after the wizard, so it stacks above it
 *  and owns Escape while open. */
export function ClosingDecisionDialog({ decideFor, onClose, onDecided }: {
  decideFor: PackageItemView | null; onClose: () => void; onDecided: (it: PackageItemView, d: Decision) => void;
}) {
  if (!decideFor) return null;
  return (
    <PackageDecisionDialog
      key={decideFor.item_id}
      item={decideFor}
      onClose={onClose}
      onSave={(decision, n) => { onDecided(decideFor, { decision, note: n }); onClose(); }}
    />
  );
}
