"use client";
import React from "react";
import Barcode from "react-barcode";
import { barcodeOf, formatId } from "@/app/lib/packages/ids";

/**
 * Every label the app prints, in one place: what the label printer gets for a
 * box or an item. Owner rule: a label carries the code only — the barcode and
 * its digits, no text. The barcode payload is barcodeOf (lib/packages/ids.ts).
 *
 * Three sizes are in use, each kept exactly as it prints today:
 *   LabelSheet       the 57 × 32 mm sheet of the package screens and the
 *                    opening station (box label + item labels, copies);
 *   ShipmentBoxLabel one box label per page, from the shipments table;
 *   ItemBarcode      one item's barcode, from the items table and the board.
 */

export type LabelItem = {
  item_id: string | number;
  package_seq: number | null;
  item_type_desc: string;
  serial_no?: string | null;
};

export type LabelSpec = { key: string; value: string };

type LabelSource = {
  packageId: string | number;
  items: LabelItem[];
};

/** The box label, then one label per item, in package_seq order. `pick` keeps
 *  a subset (a dialog's checkboxes); omitted, everything prints. */
export function packageLabels(src: LabelSource, pick?: { box: boolean; items: boolean[] }): LabelSpec[] {
  const out: LabelSpec[] = [];
  if (pick?.box ?? true) {
    out.push({ key: `box-${src.packageId}`, value: barcodeOf(src.packageId) });
  }
  src.items.forEach((it, i) => {
    if (!(pick?.items[i] ?? true)) return;
    out.push({ key: String(it.item_id), value: barcodeOf(it.item_id) });
  });
  return out;
}

/** The 57 × 32 mm labels themselves — what the printer gets. Shown on screen
 *  only as the preview; everything around it carries `.no-print`. */
export const LabelSheet = React.forwardRef<HTMLDivElement, { labels: LabelSpec[]; copies: number; preview: boolean }>(
  function LabelSheet({ labels, copies, preview }, ref) {
    return (
      <div ref={ref} style={{ marginTop: preview ? 20 : 0, display: preview ? "block" : "none" }} className="package-labels-print">
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .package-labels-print { display: block !important; }
            .package-label { page-break-after: always; break-after: page; }
          }
          .package-label { width: 57mm; height: 32mm; box-sizing: border-box; padding: 2mm 3mm; border: 1px dashed var(--color-border-strong); border-radius: 4px; display: flex; align-items: center; justify-content: center; direction: ltr; background: var(--color-canvas); }
        `}</style>
        <div className="no-print" style={{ fontSize: 11, fontWeight: 600, color: "var(--color-ink-muted-48)", marginBottom: 10 }}>תצוגה מקדימה</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: copies }, (_, c) =>
            labels.map((l) => (
              <div key={`${l.key}-${c}`} className="package-label">
                {/* Alone on the label, the barcode takes its height (the width is
                    the code's own, and already spans the label). */}
                <Barcode value={l.value} width={1.2} height={70} fontSize={12} margin={0} />
              </div>
            )),
          )}
        </div>
      </div>
    );
  },
);

/** One box's label on a page of its own: the barcode, and the id under it
 *  read left to right with the box's 00 standing out. */
export function ShipmentBoxLabel({ id }: { id: string | number }) {
  const { head, suffix } = formatId(id);
  return (
    <div
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pageBreakAfter: "always",
        breakAfter: "page",
      }}
    >
      <Barcode value={barcodeOf(id)} width={1.6} height={70} displayValue={false} margin={0} />
      <div style={{ marginTop: 8, textAlign: "center", direction: "rtl" }}>
        <div dir="ltr" style={{ fontSize: 15, letterSpacing: 1.5, fontVariantNumeric: "tabular-nums" }}>
          {head} <b>{suffix}</b>
        </div>
      </div>
    </div>
  );
}

/** One item's barcode with its digits (the items table's print). */
export const ItemBarcode = React.forwardRef<HTMLDivElement, { id: string | number }>(function ItemBarcode({ id }, ref) {
  return (
    <div ref={ref} style={{ padding: "20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Barcode value={barcodeOf(id)} width={2} height={100} fontSize={16} />
    </div>
  );
});
