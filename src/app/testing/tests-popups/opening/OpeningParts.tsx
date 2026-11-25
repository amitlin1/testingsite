"use client";
import React from "react";
import { Check } from "lucide-react";
import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";
import { PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import { BLUE, GREEN, GREY, HAIR, INK, INK_2, MUTED } from "@/components/ui/colors";
import { PACKAGE_POPUP_TEXT } from "../boxWizard";
import { NextStationList, type NextStopRow } from "../nextStation";
import type { RefLookup, RefMember } from "../reference";
import { ScanField, type RefSku } from "../referenceScan";
import { OpeningContents, boxDetailsOf } from "./OpeningContents";
import { leftOpening } from "./openingModel";
import type { OpeningContentsState } from "./useOpeningContents";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/** The opening wizards' steps that the code's wizard and a template draw alike. */

/** The box label's scan, looked up among the package type's reference items. */
export function OpeningBoxScan({ pkg, itemCount, value, onChange, lookup, onSubmit, prev, suggestions }: {
  pkg: PackageView; itemCount: number; value: string; onChange: (v: string) => void;
  lookup: { checking: boolean; ref: RefLookup | null }; onSubmit: () => void;
  prev?: string | null; suggestions: RefSku[];
}) {
  return (
    <ScanField
      label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
      value={value} onChange={onChange} lookup={lookup} onSubmit={onSubmit}
      found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${itemCount} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`}
      missing={`לא נמצא פריט ייחוס של ${pkg.item_type_desc} עם המק״ט הזה — בדוק שזו הקופסה הנכונה. אפשר להמשיך, צילום הקופסה יהיה ללא ייחוס`}
      prev={prev}
      suggestions={suggestions} suggestionsLabel={`מק״טים מיוחסים ל־${pkg.item_type_desc}`} />
  );
}

/** "תכולה וסריאליים": what is really in the box, a serial for every item. */
export function OpeningContentsStep({ contents, pkg, boxId, templateCount, expectedOf, onDone }: {
  contents: OpeningContentsState; pkg: PackageView; boxId: number; templateCount: number;
  /** With a package reference found: the member expected for an item type. */
  expectedOf?: (itemTypeId: number) => RefMember | null;
  /** Enter in the last serial with everything filled. */
  onDone: () => void;
}) {
  return (
    <OpeningContents
      rows={contents.rows} onRows={contents.setRows} memberTypes={contents.memberTypes} templateCount={templateCount}
      shipmentId={pkg.shipment_id} packageId={String(boxId)} box={boxDetailsOf(pkg)} error={contents.error}
      cert={{ rowNo: pkg.cert_row_no ?? null, serial: pkg.cert_serial_no ?? null }}
      expectedOf={expectedOf}
      onDone={() => { if (contents.gap == null) onDone(); }}
    />
  );
}

/** "פריטים במארז": every item, done or waiting, with its start / reopen button. */
export function OpeningItemsList({ items, workOf, doneLabel, onStart, busy, canStart = true }: {
  items: PackageItemView[];
  workOf: (it: PackageItemView) => { done: boolean; refWeight: number | null };
  /** What a done item's row says. */
  doneLabel: string;
  onStart: (index: number) => void;
  busy: boolean;
  /** False when there is nothing to work through per item (a template without an item flow). */
  canStart?: boolean;
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it, i) => {
          const w = workOf(it);
          return (
            <div key={it.item_id} style={{ border: `1px solid ${w.done ? "color-mix(in srgb, var(--color-status-approved) 30%, transparent)" : HAIR}`, borderRadius: 14, padding: "14px 16px", background: w.done ? "color-mix(in srgb, var(--color-status-approved) 4%, transparent)" : "var(--color-canvas)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: w.done ? "color-mix(in srgb, var(--color-status-approved) 10%, transparent)" : "var(--color-canvas-parchment)", color: w.done ? GREEN : MUTED, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}{w.refWeight != null ? ` · ייחוס ${w.refWeight} גר׳` : ""}</div>
              </div>
              <div style={{ fontSize: 12.5, color: w.done ? GREEN : MUTED, fontWeight: 600, whiteSpace: "nowrap" }}>{leftOpening(it) ? "נשמר בפתיחה קודמת" : w.done ? doneLabel : "ממתין"}</div>
              <button type="button" onClick={() => onStart(i)} disabled={busy || leftOpening(it) || !canStart} aria-label={`${w.done ? "פתח שוב" : "התחל"} · ${seq2(it.package_seq)} ${it.item_type_desc}`}
                className={w.done ? "pkg-pill pkg-pill--ghost pkg-pill--station" : "pkg-pill pkg-pill--primary pkg-pill--station"} style={{ padding: "10px 20px" }}>{w.done ? "פתח שוב" : "התחל"}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "מדבקות": one label card per item. */
export function OpeningLabelCards({ items }: { items: PackageItemView[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 20 }}>
      {items.map((it) => ({ kind: "מדבקת פריט", title: it.item_type_desc, note: `פריט ${seq2(it.package_seq)} מתוך ${seq2(items.length)}${it.serial_no ? ` · ${it.serial_no}` : ""}`, id: Number(it.item_id) }))
        .map((l, i) => (
          <div key={`${l.id}-${i}`} style={{ width: 214, border: `1px solid ${BLUE}`, background: "var(--color-primary-tint)", borderRadius: 14, padding: "15px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{l.kind}</div>
              <span aria-hidden style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${BLUE}`, background: BLUE, color: "var(--color-on-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={11} strokeWidth={2.5} /></span>
            </div>
            <div aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 44, marginTop: 12 }}>
              {Array.from({ length: 22 }, (_, b) => <div key={b} style={{ width: ((b + i) % 3) + 1, height: "100%", background: INK }} />)}
            </div>
            <div style={{ fontSize: 12.5, letterSpacing: 1.5, marginTop: 9, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right", color: MUTED }}>…{String(l.id).slice(-6)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7 }}>{l.title}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{l.note}</div>
          </div>
        ))}
    </div>
  );
}

/** The done step: every item's outcome, and where the box and each item go next. */
export function OpeningDone({ items, passOf, pkg, doneRows }: {
  items: PackageItemView[]; passOf: (it: PackageItemView) => boolean; pkg: PackageView; doneRows: NextStopRow[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
      <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-success-bg)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} aria-hidden /></span>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>פתיחת המארז הושלמה</div>
      <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>כל פריט קיבל תוצאה וממשיך לעמדה הראשונה במסלול שלו. המארז ממתין לסגירה עד שכל פריטיו יחזרו.</div>
      <div role="img" aria-label={items.map((it) => `${seq2(it.package_seq)} · ${it.item_type_desc} · ${PASS_FAIL_WORD[passOf(it) ? "pass" : "fail"]}`).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
        {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: passOf(it) ? BLUE : GREY }} />)}
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים נפתחו · {pkg.item_type_desc}</div>
      <NextStationList rows={doneRows} />
    </div>
  );
}

/** The labels dialog over the wizard. Mounted after it, so it stacks above it and owns Escape while
 *  open. */
export function OpeningLabelsDialog({ open, pkg, items, onClose, onPrinted }: {
  open: boolean; pkg: PackageView; items: PackageItemView[]; onClose: () => void; onPrinted: () => void;
}) {
  if (!open) return null;
  return <PackageLabelsDialog open onClose={onClose} onPrinted={onPrinted} pkg={pkg} items={items} boxFirst={false} />;
}
