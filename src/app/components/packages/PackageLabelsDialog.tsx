"use client";
import React from "react";
import { useReactToPrint } from "react-to-print";
import { SearchableCombobox } from "@/components/ui";
import { ArtboardDialog, ArtboardDialogHeader } from "@/components/ui/ArtboardDialog";
import { INK, INK_2, MUTED, AMBER_INK, AMBER_BG, AMBER_BORDER } from "@/components/ui/colors";
import { CopiesStepper, Tick, pressKeys } from "@/components/ui/ArtboardControls";
import { usePrintWhenReady } from "@/lib/hooks/usePrintWhenReady";
import type { PackageView } from "@/app/lib/packages/contract";
import { formatIdText, seq2 } from "@/app/lib/packages/ids";
import { LabelSheet, packageLabels, type LabelItem } from "@/app/components/labels/Labels";

const PRINTERS = [{ label: "מדפסת המערכת" }];
const LABEL_SIZES = [{ label: "57 × 32 מ״מ" }];

/**
 * הדפסת מדבקות — design/Package Dialogs.dc.html ("labels"). One box label
 * and one label per item, each selectable; presets; copies. Printer and
 * label size are shown for the operator but the browser's own print dialog
 * picks the printer (DESIGN_REVIEW.md). Everything but the labels carries
 * `.no-print`; the labels themselves are components/labels.
 */

type PackageLabelsDialogProps = {
  open: boolean;
  onClose: () => void;
  pkg: Pick<PackageView, "item_id" | "item_type_desc" | "customer_code" | "shipment_code" | "items">;
  /** The items to label, when not the box's as loaded (the opening station's own list). */
  items?: LabelItem[];
  onPrinted?: () => void;
  /** Whether the box label starts ticked. The opening station starts with it
   *  off: the box wears its label since the shipment. Default on. */
  boxFirst?: boolean;
};

function Bars({ n, seed, height }: { n: number; seed: number; height: number }) {
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 1, height }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ width: ((i + seed) % 3) + 1, height: "100%", background: INK }} />
      ))}
    </div>
  );
}

export default function PackageLabelsDialog({ open, onClose, pkg, items: itemsOverride, onPrinted, boxFirst = true }: PackageLabelsDialogProps) {
  const items: LabelItem[] = itemsOverride ?? pkg.items;
  const packageId = pkg.item_id;
  const packageType = pkg.item_type_desc;
  const customerLine = `${pkg.customer_code ?? ""} · משלוח ${pkg.shipment_code ?? ""}`;
  const [boxOn, setBoxOn] = React.useState(boxFirst);
  const [itemsOn, setItemsOn] = React.useState<boolean[]>(() => items.map(() => true));
  const [copies, setCopies] = React.useState(1);
  const [preview, setPreview] = React.useState(false);
  const [printer, setPrinter] = React.useState<{ label: string } | null>(PRINTERS[0]);
  const [labelSize, setLabelSize] = React.useState<{ label: string } | null>(LABEL_SIZES[0]);
  const printRef = React.useRef<HTMLDivElement>(null);
  const copiesLabelId = React.useId();

  // Reset when the dialog opens or the item set changes — keyed on the count,
  // not the array identity: a refetch hands over a new array of the same items.
  // Done during render, so the stale selection is never painted.
  const [resetFor, setResetFor] = React.useState({ open, count: items.length });
  if (resetFor.open !== open || resetFor.count !== items.length) {
    setResetFor({ open, count: items.length });
    if (open) { setBoxOn(boxFirst); setItemsOn(items.map(() => true)); setCopies(1); setPreview(false); }
  }

  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `Package-${packageId}-labels`, onAfterPrint: onPrinted });
  const printShown = usePrintWhenReady(handlePrint);

  if (!open) return null;

  const itemsOnCount = itemsOn.filter(Boolean).length;
  const total = (boxOn ? 1 : 0) + itemsOnCount;
  const sheets = total * copies;
  const allItems = itemsOnCount === items.length;
  const code = formatIdText(packageId);
  const presets = [
    { key: "all", label: "הכול", active: boxOn && allItems },
    { key: "box", label: "קופסה בלבד", active: boxOn && itemsOnCount === 0 },
    { key: "items", label: "פריטים בלבד", active: !boxOn && allItems },
  ];
  const pick = (key: string) => { setBoxOn(key !== "items"); setItemsOn(items.map(() => key !== "box")); };
  const itemCode = (it: LabelItem) => formatIdText(it.item_id);
  const totalSeq = seq2(items.length);
  const toggleItem = (i: number) => setItemsOn((v) => v.map((x, j) => (j === i ? !x : x)));

  const selectedLabels = packageLabels({ packageId, items },{ box: boxOn, items: itemsOn });

  return (
    <ArtboardDialog open onClose={onClose} width="min(880px, 96vw)">
      <ArtboardDialogHeader
        title="הדפסת מדבקות"
        onClose={onClose}
        subtitle={
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13.5, color: MUTED, marginTop: 4 }}>
            <span>{packageType}</span><span aria-hidden>·</span>
            <span style={{ fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate" }}>{code}</span>
          </div>
        }
      />

      <div className="pkg-dlg-body">
        <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {presets.map((p) => (
            <button key={p.key} type="button" aria-pressed={p.active} onClick={() => pick(p.key)} className="pkg-choice pkg-choice--soft pkg-press"
              style={{ width: "auto", borderRadius: 9999, padding: "7px 15px", fontSize: 13, fontWeight: 600 }}>
              {p.label}
            </button>
          ))}
          <div style={{ marginInlineStart: "auto", fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{total} מדבקות · {sheets} הדפסות</div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
          <div role="checkbox" aria-checked={boxOn} aria-label={`מדבקת קופסה · ${packageType}`} tabIndex={0}
            onClick={() => setBoxOn((v) => !v)} onKeyDown={pressKeys(() => setBoxOn((v) => !v))}
            className="pkg-choice" style={{ width: 268, borderRadius: 18, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מדבקת קופסה</div>
              <Tick on={boxOn} />
            </div>
            <div style={{ marginTop: 16 }}><Bars n={30} seed={0} height={62} /></div>
            <div style={{ fontSize: 14, letterSpacing: 2, marginTop: 11, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right" }}>{code}</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>{packageType}</div>
            <div style={{ fontSize: 13, color: INK_2, marginTop: 2 }}>{customerLine}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים</div>
          </div>

          <div role="group" aria-label="מדבקות פריט" style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מדבקות פריט</div>
              <button type="button" onClick={() => setItemsOn(items.map(() => !allItems))} className="pkg-link pkg-link--hit" style={{ fontSize: 12.5 }}>
                {allItems ? "נקה הכול" : "בחר הכול"}
              </button>
            </div>
            {items.map((it, i) => {
              const on = itemsOn[i];
              return (
                <div key={String(it.item_id)} role="checkbox" aria-checked={on} aria-label={`${it.item_type_desc} · פריט ${seq2(it.package_seq)} מתוך ${totalSeq}`} tabIndex={0}
                  onClick={() => toggleItem(i)} onKeyDown={pressKeys(() => toggleItem(i))}
                  className="pkg-choice" style={{ display: "flex", alignItems: "center", gap: 13, borderRadius: 14, padding: "12px 14px" }}>
                  <Tick on={on} />
                  <div style={{ width: 74, flexShrink: 0 }}><Bars n={18} seed={i + 1} height={30} /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.item_type_desc}</div>
                    <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right" }}>{itemCode(it)}</div>
                  </div>
                  <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap" }}>פריט {seq2(it.package_seq)} מתוך {totalSeq}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 20, maxWidth: 640 }}>
          {/* One option each: the browser's print dialog picks the physical
              printer, and the print CSS is 57 × 32 mm. Cleared, the
              placeholder still names what will print. */}
          <div title="המדפסת נבחרת בחלון ההדפסה של הדפדפן">
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>מדפסת</div>
            <SearchableCombobox<{ label: string }> dense options={PRINTERS} value={printer} onChange={setPrinter} placeholder={PRINTERS[0].label} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>גודל מדבקה</div>
            <SearchableCombobox<{ label: string }> dense options={LABEL_SIZES} value={labelSize} onChange={setLabelSize} placeholder={LABEL_SIZES[0].label} />
          </div>
          <div>
            <div id={copiesLabelId} style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>עותקים מכל מדבקה</div>
            <CopiesStepper copies={copies} onChange={setCopies} labelId={copiesLabelId} />
          </div>
        </div>

        {total === 0 && (
          <div className="no-print" role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", marginTop: 18 }}>לא נבחרה אף מדבקה להדפסה.</div>
        )}

        <LabelSheet ref={printRef} labels={selectedLabels} copies={copies} preview={preview} />
      </div>

      <div className="pkg-dlg-foot no-print">
        <div style={{ fontSize: 12.5, color: MUTED }}>{total === 0 ? "בחר מדבקה אחת לפחות" : `${sheets} מדבקות יישלחו למדפסת`}</div>
        <div className="pkg-dlg-foot-actions">
          <button type="button" onClick={onClose} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>ביטול</button>
          <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>{preview ? "הסתר תצוגה מקדימה" : "תצוגה מקדימה"}</button>
          <button type="button" disabled={total === 0} onClick={() => { setPreview(true); printShown(); }}
            className="pkg-pill pkg-pill--primary" style={{ padding: "11px 24px", fontSize: 15 }}>
            {total === 0 ? "הדפס" : `הדפס ${sheets} מדבקות`}
          </button>
        </div>
      </div>
    </ArtboardDialog>
  );
}
