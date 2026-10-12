"use client";
import React from "react";
import { useReactToPrint } from "react-to-print";
import type { PackageView } from "@/app/lib/packages/read";
import { BLUE, INK, INK_2, MUTED, AMBER_INK, AMBER_BG, AMBER_BORDER, fmtId, pressKeys } from "./packageUi";
import { PackageDialog, PackageDialogHeader } from "./PackageDialog";
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
  const copiesLabelId = React.useId();
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
  const toggle = (i: number) => setOn((v) => v.map((x, j) => (j === i ? !x : x)));

  return (
    <PackageDialog open onClose={onClose} width="min(880px, 96vw)">
      <PackageDialogHeader
        title="מדבקות חדשות למארזים שהוסבו"
        onClose={onClose}
        subtitle={
          <div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>
            {packages.length} מארזים עדיין נושאים מדבקה עם המזהה הישן. הסריקה של המדבקה הישנה עדיין עובדת, אבל כל קופסה צריכה את המדבקה החדשה שלה.
          </div>
        }
      />

      <div className="pkg-dlg-body">
        <div className="no-print" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מארזים</div>
          <button type="button" onClick={() => setOn(packages.map(() => !all))} className="pkg-link pkg-link--hit" style={{ fontSize: 12.5 }}>
            {all ? "נקה הכול" : "בחר הכול"}
          </button>
        </div>
        <div className="no-print" role="group" aria-label="מארזים להדפסה" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
          {packages.map(({ pkg, legacyIds }, i) => (
            <div key={pkg.item_id} role="checkbox" aria-checked={on[i]} tabIndex={0}
              aria-label={`${pkg.item_type_desc} · ${pkg.customer_name ?? pkg.customer_code ?? ""} · ${codeOf(pkg.item_id)}`}
              onClick={() => toggle(i)} onKeyDown={pressKeys(() => toggle(i))}
              className="pkg-choice" style={{ display: "flex", alignItems: "center", gap: 13, borderRadius: 14, padding: "11px 14px" }}>
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
            <div id={copiesLabelId} style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>עותקים מכל מדבקה</div>
            <CopiesStepper copies={copies} onChange={setCopies} labelId={copiesLabelId} />
          </div>
        </div>

        {chosen.length === 0 && (
          <div className="no-print" role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", marginTop: 18 }}>לא נבחר אף מארז להדפסה.</div>
        )}

        {askConfirm && (
          <div className="no-print" role="alertdialog" aria-label="אישור הדפסה" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13.5, color: INK, background: "var(--color-primary-tint)", border: `1px solid ${BLUE}`, borderRadius: 10, padding: "12px 14px", marginTop: 18 }}>
            <span style={{ flex: 1, minWidth: 220 }}>חלון ההדפסה נסגר. המדבקות של {printedRef.current.length} המארזים הודפסו? אישור מסמן אותם כמודבקים ומוריד אותם מהרשימה.</span>
            <button type="button" onClick={() => setAskConfirm(false)} className="pkg-pill pkg-pill--ghost pkg-pill--sm" style={{ paddingInline: 16 }}>לא, עדיין לא</button>
            <button type="button" onClick={() => { setAskConfirm(false); onPrinted?.(printedRef.current); }} className="pkg-pill pkg-pill--primary pkg-pill--sm" style={{ paddingInline: 18 }}>כן, הודפסו</button>
          </div>
        )}

        <LabelSheet ref={printRef} labels={labels} copies={copies} preview={preview} />
      </div>

      <div className="pkg-dlg-foot no-print">
        <div style={{ fontSize: 12.5, color: MUTED }}>{chosen.length === 0 ? "בחר מארז אחד לפחות" : `${chosen.length} מארזים · ${sheets} מדבקות יישלחו למדפסת`}</div>
        <div className="pkg-dlg-foot-actions">
          <button type="button" onClick={onClose} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>ביטול</button>
          <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>{preview ? "הסתר תצוגה מקדימה" : "תצוגה מקדימה"}</button>
          <button type="button" disabled={chosen.length === 0}
            onClick={() => { printedRef.current = chosen.map((c) => c.pkg.item_id); setPreview(true); setTimeout(() => handlePrint(), 50); }}
            className="pkg-pill pkg-pill--primary" style={{ padding: "11px 24px", fontSize: 15 }}>
            {chosen.length === 0 ? "הדפס" : `הדפס ${sheets} מדבקות`}
          </button>
        </div>
      </div>
    </PackageDialog>
  );
}
