"use client";
import React from "react";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import { X, Check, Minus, Plus } from "lucide-react";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { DIALOG_Z, BLUE, HAIR, INK, INK_2, MUTED, MUTED_LT, SHADOW, AMBER_INK, AMBER_BG, AMBER_BORDER, GREY, barcodeOf, fmtId, seq2, pillGhost, overlay } from "./packageUi";

const PRINTERS = [{ label: "מדפסת המערכת" }];
const LABEL_SIZES = [{ label: "57 × 32 מ״מ" }];

/**
 * הדפסת מדבקות — design/Package Dialogs.dc.html ("labels"). One box label
 * and one label per item, each selectable; presets; copies. Printer and
 * label size are shown for the operator but the browser's own print dialog
 * picks the printer (DESIGN_REVIEW.md). Everything but the labels carries
 * `.no-print`.
 *
 * The label sheet itself (`LabelSheet`, `packageLabels`) is exported so the
 * bulk reprint for converted boxes (PackageRelabelDialog) prints the very
 * same labels.
 */
export type LabelItem = {
  item_id: string | number;
  package_seq: number | null;
  item_type_desc: string;
  serial_no?: string | null;
};

export type LabelSpec = { key: string; value: string; title: string; sub: string; foot: string };

export type LabelSource = {
  packageId: string | number;
  packageType: string;
  /** "רפאל · משלוח SH-2041" */
  customerLine: string;
  sourceId?: number | null;
  items: LabelItem[];
};

/** The box label, then one label per item, in package_seq order. `pick` keeps
 *  a subset (the dialog's checkboxes); omitted, everything prints. */
export function packageLabels(src: LabelSource, pick?: { box: boolean; items: boolean[] }): LabelSpec[] {
  const out: LabelSpec[] = [];
  const totalSeq = seq2(src.items.length);
  if (pick?.box ?? true) {
    out.push({ key: `box-${src.packageId}`, value: barcodeOf(src.packageId, src.sourceId), title: src.packageType, sub: src.customerLine, foot: `${src.items.length} פריטים` });
  }
  src.items.forEach((it, i) => {
    if (!(pick?.items[i] ?? true)) return;
    out.push({ key: String(it.item_id), value: barcodeOf(it.item_id, src.sourceId), title: it.item_type_desc, sub: it.serial_no ? `S/N ${it.serial_no}` : "ללא סריאלי", foot: `פריט ${seq2(it.package_seq)} מתוך ${totalSeq}` });
  });
  return out;
}

export function customerLineOf(p: { customer_name: string | null; customer_code: string | null; shipment_code: string | null }): string {
  return `${p.customer_name ?? p.customer_code ?? ""} · משלוח ${p.shipment_code ?? ""}`;
}

/** The labels themselves — what the printer gets. Shown on screen only as the preview. */
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
          .package-label { width: 57mm; height: 32mm; box-sizing: border-box; padding: 2mm 3mm; border: 1px dashed #d4d4dc; border-radius: 4px; display: flex; flex-direction: column; justify-content: space-between; direction: rtl; background: #fff; }
        `}</style>
        <div className="no-print" style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 10 }}>תצוגה מקדימה</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: copies }, (_, c) =>
            labels.map((l) => (
              <div key={`${l.key}-${c}`} className="package-label">
                <div style={{ fontSize: 11, fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</div>
                <div style={{ direction: "ltr", display: "flex", justifyContent: "center" }}>
                  <Barcode value={l.value} width={1.2} height={34} fontSize={10} margin={0} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: INK_2 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.sub}</span>
                  <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{l.foot}</span>
                </div>
              </div>
            )),
          )}
        </div>
      </div>
    );
  },
);

/** Copies stepper (1–9), shared with the bulk reprint. */
export function CopiesStepper({ copies, onChange }: { copies: number; onChange: (n: number) => void }) {
  return (
    <div style={{ height: 44, border: `1px solid ${HAIR}`, borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px 0 13px" }}>
      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{copies}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button type="button" onClick={() => onChange(Math.max(1, copies - 1))} style={{ width: 32, height: 32, borderRadius: 8, background: "#f5f5f7", color: INK, border: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Minus size={15} strokeWidth={2} /></button>
        <button type="button" onClick={() => onChange(Math.min(9, copies + 1))} style={{ width: 32, height: 32, borderRadius: 8, background: "#f5f5f7", color: INK, border: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Plus size={15} strokeWidth={2} /></button>
      </div>
    </div>
  );
}

export function Tick({ on }: { on: boolean }) {
  return (
    <span style={{ width: 21, height: 21, borderRadius: 6, border: `1px solid ${on ? BLUE : GREY}`, background: on ? BLUE : "#fff", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {on && <Check size={13} strokeWidth={2.5} />}
    </span>
  );
}

export type PackageLabelsDialogProps = {
  open: boolean;
  onClose: () => void;
  packageId: string | number;
  packageType: string;
  /** "רפאל · משלוח SH-2041" */
  customerLine: string;
  sourceId?: number | null;
  items: LabelItem[];
  onPrinted?: () => void;
  /** Stacking: the list and the wizard open it beside them (default, under
   *  the primary overlay); the intake dialog keeps its own overlay mounted and
   *  must pass a higher value or the labels sit behind it. */
  zIndex?: number;
};

/** Fake barcode bars for the on-screen cards (the real barcode prints). */
function Bars({ n, seed, height }: { n: number; seed: number; height: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ width: ((i + seed) % 3) + 1, height: "100%", background: INK }} />
      ))}
    </div>
  );
}

export default function PackageLabelsDialog({ open, onClose, packageId, packageType, customerLine, sourceId, items, onPrinted, zIndex = DIALOG_Z - 10 }: PackageLabelsDialogProps) {
  const [boxOn, setBoxOn] = React.useState(true);
  const [itemsOn, setItemsOn] = React.useState<boolean[]>(() => items.map(() => true));
  const [copies, setCopies] = React.useState(1);
  const [preview, setPreview] = React.useState(false);
  const [printer, setPrinter] = React.useState<{ label: string } | null>(PRINTERS[0]);
  const [labelSize, setLabelSize] = React.useState<{ label: string } | null>(LABEL_SIZES[0]);
  const printRef = React.useRef<HTMLDivElement>(null);

  // Reset when the dialog opens or the item set changes — keyed on the count,
  // not the array identity, because callers build `items` inline each render.
  React.useEffect(() => {
    if (!open) return;
    setBoxOn(true); setItemsOn(items.map(() => true)); setCopies(1); setPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length]);

  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `Package-${packageId}-labels`, onAfterPrint: onPrinted });

  if (!open) return null;

  const itemsOnCount = itemsOn.filter(Boolean).length;
  const total = (boxOn ? 1 : 0) + itemsOnCount;
  const sheets = total * copies;
  const allItems = itemsOnCount === items.length;
  const { head, suffix } = fmtId(packageId);
  const code = `${head} ${suffix}`.trim();
  const presets = [
    { key: "all", label: "הכול", active: boxOn && allItems },
    { key: "box", label: "קופסה בלבד", active: boxOn && itemsOnCount === 0 },
    { key: "items", label: "פריטים בלבד", active: !boxOn && allItems },
  ];
  const pick = (key: string) => { setBoxOn(key !== "items"); setItemsOn(items.map(() => key !== "box")); };
  const itemCode = (it: LabelItem) => { const f = fmtId(it.item_id); return `${f.head} ${f.suffix}`.trim(); };
  const totalSeq = seq2(items.length);

  const selectedLabels = packageLabels({ packageId, packageType, customerLine, sourceId, items }, { box: boxOn, items: itemsOn });

  return (
    <div onClick={onClose} style={{ ...overlay, zIndex }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(880px, 96vw)", maxHeight: "92vh", background: "#fff", borderRadius: 18, boxShadow: SHADOW, display: "flex", flexDirection: "column", overflow: "hidden", color: INK }}>
        <div className="no-print" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: `1px solid ${HAIR}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>הדפסת מדבקות</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13.5, color: MUTED, marginTop: 4 }}>
              <span>{packageType}</span><span>·</span>
              <span style={{ fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate" }}>{code}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 34, height: 34, border: 0, borderRadius: 9999, background: "#f5f5f7", color: INK, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p.key} type="button" onClick={() => pick(p.key)} style={{ border: `1px solid ${p.active ? BLUE : HAIR}`, background: p.active ? "#e6efff" : "#fff", color: p.active ? BLUE : INK, borderRadius: 9999, padding: "7px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                {p.label}
              </button>
            ))}
            <div style={{ marginInlineStart: "auto", fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{total} מדבקות · {sheets} הדפסות</div>
          </div>

          <div className="no-print" style={{ display: "flex", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
            <div onClick={() => setBoxOn((v) => !v)} style={{ width: 268, border: `1px solid ${boxOn ? BLUE : HAIR}`, background: boxOn ? "#f7fbff" : "#fff", borderRadius: 18, padding: 20, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>מדבקת קופסה</div>
                <Tick on={boxOn} />
              </div>
              <div style={{ marginTop: 16 }}><Bars n={30} seed={0} height={62} /></div>
              <div style={{ fontFamily: "'Inter', monospace", fontSize: 14, letterSpacing: 2, marginTop: 11, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right" }}>{code}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>{packageType}</div>
              <div style={{ fontSize: 13, color: INK_2, marginTop: 2 }}>{customerLine}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים</div>
            </div>

            <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>מדבקות פריט</div>
                <button type="button" onClick={() => setItemsOn(items.map(() => !allItems))} style={{ fontSize: 12.5, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                  {allItems ? "נקה הכול" : "בחר הכול"}
                </button>
              </div>
              {items.map((it, i) => {
                const on = itemsOn[i];
                return (
                  <div key={String(it.item_id)} onClick={() => setItemsOn((v) => v.map((x, j) => (j === i ? !x : x)))} style={{ display: "flex", alignItems: "center", gap: 13, border: `1px solid ${on ? BLUE : HAIR}`, background: on ? "#f7fbff" : "#fff", borderRadius: 14, padding: "12px 14px", cursor: "pointer" }}>
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
              <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>עותקים מכל מדבקה</div>
              <CopiesStepper copies={copies} onChange={setCopies} />
            </div>
          </div>

          {total === 0 && (
            <div className="no-print" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", marginTop: 18 }}>לא נבחרה אף מדבקה להדפסה.</div>
          )}

          <LabelSheet ref={printRef} labels={selectedLabels} copies={copies} preview={preview} />
        </div>

        <div className="no-print" style={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: MUTED }}>{total === 0 ? "בחר מדבקה אחת לפחות" : `${sheets} מדבקות יישלחו למדפסת`}</div>
          <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ ...pillGhost, padding: "11px 20px" }}>ביטול</button>
            <button type="button" onClick={() => setPreview((p) => !p)} style={{ ...pillGhost, padding: "11px 20px" }}>{preview ? "הסתר תצוגה מקדימה" : "תצוגה מקדימה"}</button>
            <button type="button" disabled={total === 0} onClick={() => { setPreview(true); setTimeout(() => handlePrint(), 50); }}
              style={{ background: total === 0 ? HAIR : BLUE, color: total === 0 ? MUTED_LT : "#fff", border: 0, borderRadius: 9999, padding: "11px 24px", fontSize: 15, fontWeight: 600, cursor: total === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {total === 0 ? "הדפס" : `הדפס ${sheets} מדבקות`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
