"use client";
import React from "react";
import { useReactToPrint } from "react-to-print";
import { X } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { DIALOG_Z, BLUE, HAIR, INK, INK_2, MUTED, MUTED_LT, SHADOW, AMBER_INK, AMBER_BG, AMBER_BORDER, fmtId, overlay, pillGhost } from "./packageUi";
import { CopiesStepper, LabelSheet, Tick, customerLineOf, packageLabels, type LabelSpec } from "./PackageLabelsDialog";

/**
 * New labels for the boxes the production upgrade converted from legacy
 * items. Their physical labels still carry the old 8–10 digit ids; this
 * prints the box label and every item label (the same sheet as
 * PackageLabelsDialog) for all of them at once. After the print dialog closes
 * the operator confirms the labels really came out (a browser cannot tell a
 * print from a cancel), and only then are the boxes reported as printed so
 * /api/packages/converted can drop them from the list.
 */
export type RelabelPackage = {
  pkg: PackageView;
  sourceId: number | null;
  /** The old ids this box's contents were known by. */
  legacyIds: string[];
};

export type PackageRelabelDialogProps = {
  open: boolean;
  onClose: () => void;
  packages: RelabelPackage[];
  /** Called after the print dialog closes, with the boxes that were printed. */
  onPrinted?: (packageIds: string[]) => void;
};

const codeOf = (id: string | number) => { const f = fmtId(id); return `${f.head} ${f.suffix}`.trim(); };

export default function PackageRelabelDialog({ open, onClose, packages, onPrinted }: PackageRelabelDialogProps) {
  const [on, setOn] = React.useState<boolean[]>(() => packages.map(() => true));
  const [copies, setCopies] = React.useState(1);
  const [preview, setPreview] = React.useState(false);
  const printRef = React.useRef<HTMLDivElement>(null);
  const printedRef = React.useRef<string[]>([]);
  // The browser cannot tell a printed job from a cancelled dialog, so nothing
  // is marked until the operator confirms after the print dialog closes.
  const [askConfirm, setAskConfirm] = React.useState(false);

  // Reset when the dialog opens or the set changes — keyed on the count, not
  // the array identity (the caller derives `packages` from two fetches).
  React.useEffect(() => {
    if (!open) return;
    setOn(packages.map(() => true)); setCopies(1); setPreview(false); setAskConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, packages.length]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "Converted-packages-labels",
    onAfterPrint: () => setAskConfirm(true),
  });

  if (!open) return null;

  const chosen = packages.filter((_, i) => on[i]);
  const labels: LabelSpec[] = chosen.flatMap(({ pkg, sourceId }) =>
    packageLabels({
      packageId: pkg.item_id,
      packageType: pkg.item_type_desc,
      customerLine: customerLineOf(pkg),
      sourceId,
      items: pkg.items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no })),
    }),
  );
  const sheets = labels.length * copies;
  const all = chosen.length === packages.length;

  return (
    <div onClick={onClose} style={{ ...overlay, zIndex: DIALOG_Z - 10 }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(880px, 96vw)", maxHeight: "92vh", background: "#fff", borderRadius: 18, boxShadow: SHADOW, display: "flex", flexDirection: "column", overflow: "hidden", color: INK }}>
        <div className="no-print" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: `1px solid ${HAIR}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>מדבקות חדשות למארזים שהוסבו</div>
            <div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>
              {packages.length} מארזים עדיין נושאים מדבקה עם המזהה הישן. הסריקה של המדבקה הישנה עדיין עובדת, אבל כל קופסה צריכה את המדבקה החדשה שלה.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 34, height: 34, border: 0, borderRadius: 9999, background: "#f5f5f7", color: INK, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          <div className="no-print" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>מארזים</div>
            <button type="button" onClick={() => setOn(packages.map(() => !all))} style={{ fontSize: 12.5, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
              {all ? "נקה הכול" : "בחר הכול"}
            </button>
          </div>
          <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
            {packages.map(({ pkg, legacyIds }, i) => (
              <div key={pkg.item_id} onClick={() => setOn((v) => v.map((x, j) => (j === i ? !x : x)))} style={{ display: "flex", alignItems: "center", gap: 13, border: `1px solid ${on[i] ? BLUE : HAIR}`, background: on[i] ? "#f7fbff" : "#fff", borderRadius: 14, padding: "11px 14px", cursor: "pointer" }}>
                <Tick on={on[i]} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{pkg.item_type_desc} · {pkg.customer_name ?? pkg.customer_code ?? ""}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{codeOf(pkg.item_id)}</span>
                    <span>מזהה ישן: <span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{legacyIds.join(", ") || "—"}</span></span>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: INK_2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{pkg.items.length + 1} מדבקות</div>
              </div>
            ))}
          </div>

          <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 20, maxWidth: 640 }}>
            <div>
              <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>עותקים מכל מדבקה</div>
              <CopiesStepper copies={copies} onChange={setCopies} />
            </div>
          </div>

          {chosen.length === 0 && (
            <div className="no-print" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", marginTop: 18 }}>לא נבחר אף מארז להדפסה.</div>
          )}

          {askConfirm && (
            <div className="no-print" role="alertdialog" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13.5, color: INK, background: "#f7fbff", border: `1px solid ${BLUE}`, borderRadius: 10, padding: "12px 14px", marginTop: 18 }}>
              <span style={{ flex: 1, minWidth: 220 }}>חלון ההדפסה נסגר. המדבקות של {printedRef.current.length} המארזים הודפסו? אישור מסמן אותם כמודבקים ומוריד אותם מהרשימה.</span>
              <button type="button" onClick={() => setAskConfirm(false)} style={{ ...pillGhost, padding: "9px 16px", fontSize: 13.5 }}>לא, עדיין לא</button>
              <button type="button" onClick={() => { setAskConfirm(false); onPrinted?.(printedRef.current); }} style={{ background: BLUE, color: "#fff", border: 0, borderRadius: 9999, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>כן, הודפסו</button>
            </div>
          )}

          <LabelSheet ref={printRef} labels={labels} copies={copies} preview={preview} />
        </div>

        <div className="no-print" style={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: MUTED }}>{chosen.length === 0 ? "בחר מארז אחד לפחות" : `${chosen.length} מארזים · ${sheets} מדבקות יישלחו למדפסת`}</div>
          <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ ...pillGhost, padding: "11px 20px" }}>ביטול</button>
            <button type="button" onClick={() => setPreview((p) => !p)} style={{ ...pillGhost, padding: "11px 20px" }}>{preview ? "הסתר תצוגה מקדימה" : "תצוגה מקדימה"}</button>
            <button type="button" disabled={chosen.length === 0}
              onClick={() => { printedRef.current = chosen.map((c) => c.pkg.item_id); setPreview(true); setTimeout(() => handlePrint(), 50); }}
              style={{ background: chosen.length === 0 ? HAIR : BLUE, color: chosen.length === 0 ? MUTED_LT : "#fff", border: 0, borderRadius: 9999, padding: "11px 24px", fontSize: 15, fontWeight: 600, cursor: chosen.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {chosen.length === 0 ? "הדפס" : `הדפס ${sheets} מדבקות`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
