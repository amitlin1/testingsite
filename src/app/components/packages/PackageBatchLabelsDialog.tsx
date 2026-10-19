"use client";
import React from "react";
import { useReactToPrint } from "react-to-print";
import { INK_2, MUTED, AMBER_INK, AMBER_BG, AMBER_BORDER, fmtId, pressKeys } from "./packageUi";
import { PackageDialog, PackageDialogHeader } from "./PackageDialog";
import { CopiesStepper, LabelSheet, Tick, packageLabels, type LabelSource, type LabelSpec } from "./PackageLabelsDialog";

/**
 * Labels for every box taken in during one intake run ("שמור והמשך למארז
 * הבא"), printed together at the end instead of after each box. The same
 * sheet as PackageLabelsDialog: per box the box label, then one per item.
 * A preset picks boxes / items / both for the whole run; each box can be
 * left out. The caller mounts it fresh for each run, so its state starts
 * from "everything" without a reset effect.
 */
export type PackageBatchLabelsDialogProps = {
  open: boolean;
  onClose: () => void;
  packages: LabelSource[];
  /** "SH-2041 · מארז מגבר" */
  subtitle: string;
};

const codeOf = (id: string | number) => { const f = fmtId(id); return `${f.head} ${f.suffix}`.trim(); };
const boxes = (n: number) => (n === 1 ? "מארז אחד" : `${n} מארזים`);

export default function PackageBatchLabelsDialog({ open, onClose, packages, subtitle }: PackageBatchLabelsDialogProps) {
  const [on, setOn] = React.useState<boolean[]>(() => packages.map(() => true));
  const [boxOn, setBoxOn] = React.useState(true);
  const [itemsOn, setItemsOn] = React.useState(true);
  const [copies, setCopies] = React.useState(1);
  const [preview, setPreview] = React.useState(false);
  const printRef = React.useRef<HTMLDivElement>(null);
  const copiesLabelId = React.useId();

  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: "Packages-labels" });

  if (!open) return null;

  const chosen = packages.filter((_, i) => on[i]);
  const labels: LabelSpec[] = chosen.flatMap((src) => packageLabels(src, { box: boxOn, items: src.items.map(() => itemsOn) }));
  const sheets = labels.length * copies;
  const all = chosen.length === packages.length;
  const toggle = (i: number) => setOn((v) => v.map((x, j) => (j === i ? !x : x)));
  const presets = [
    { key: "all", label: "הכול", active: boxOn && itemsOn },
    { key: "box", label: "קופסאות בלבד", active: boxOn && !itemsOn },
    { key: "items", label: "פריטים בלבד", active: !boxOn && itemsOn },
  ];
  const pick = (key: string) => { setBoxOn(key !== "items"); setItemsOn(key !== "box"); };
  const perBox = (src: LabelSource) => (boxOn ? 1 : 0) + (itemsOn ? src.items.length : 0);

  return (
    <PackageDialog open onClose={onClose} width="min(880px, 96vw)">
      <PackageDialogHeader
        title={`הדפסת מדבקות · ${boxes(packages.length)}`}
        onClose={onClose}
        subtitle={<div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>{subtitle}</div>}
      />

      <div className="pkg-dlg-body">
        <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {presets.map((p) => (
            <button key={p.key} type="button" aria-pressed={p.active} onClick={() => pick(p.key)} className="pkg-choice pkg-choice--soft pkg-press"
              style={{ width: "auto", borderRadius: 9999, padding: "7px 15px", fontSize: 13, fontWeight: 600 }}>
              {p.label}
            </button>
          ))}
          <div style={{ marginInlineStart: "auto", fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{labels.length} מדבקות · {sheets} הדפסות</div>
        </div>

        <div className="no-print" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מארזים</div>
          <button type="button" onClick={() => setOn(packages.map(() => !all))} className="pkg-link pkg-link--hit" style={{ fontSize: 12.5 }}>
            {all ? "נקה הכול" : "בחר הכול"}
          </button>
        </div>
        <div className="no-print" role="group" aria-label="מארזים להדפסה" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
          {packages.map((src, i) => {
            const serials = src.items.map((it) => it.serial_no).filter(Boolean).join(", ");
            return (
              <div key={String(src.packageId)} role="checkbox" aria-checked={on[i]} tabIndex={0}
                aria-label={`${src.packageType} · ${codeOf(src.packageId)}`}
                onClick={() => toggle(i)} onKeyDown={pressKeys(() => toggle(i))}
                className="pkg-choice" style={{ display: "flex", alignItems: "center", gap: 13, borderRadius: 14, padding: "11px 14px" }}>
                <Tick on={on[i]} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>{src.packageType}</span>
                    <span style={{ fontWeight: 400, color: MUTED, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate" }}>{codeOf(src.packageId)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    S/N <span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{serials || "—"}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: INK_2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{perBox(src)} מדבקות</div>
              </div>
            );
          })}
        </div>

        <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 20, maxWidth: 640 }}>
          <div>
            <div id={copiesLabelId} style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>עותקים מכל מדבקה</div>
            <CopiesStepper copies={copies} onChange={setCopies} labelId={copiesLabelId} />
          </div>
        </div>

        {labels.length === 0 && (
          <div className="no-print" role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", marginTop: 18 }}>לא נבחרה אף מדבקה להדפסה.</div>
        )}

        <LabelSheet ref={printRef} labels={labels} copies={copies} preview={preview} />
      </div>

      <div className="pkg-dlg-foot no-print">
        <div style={{ fontSize: 12.5, color: MUTED }}>{labels.length === 0 ? "בחר מדבקה אחת לפחות" : `${boxes(chosen.length)} · ${sheets} מדבקות יישלחו למדפסת`}</div>
        <div className="pkg-dlg-foot-actions">
          <button type="button" onClick={onClose} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>סגור</button>
          <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>{preview ? "הסתר תצוגה מקדימה" : "תצוגה מקדימה"}</button>
          <button type="button" disabled={labels.length === 0} onClick={() => { setPreview(true); setTimeout(() => handlePrint(), 50); }}
            className="pkg-pill pkg-pill--primary" style={{ padding: "11px 24px", fontSize: 15 }}>
            {labels.length === 0 ? "הדפס" : `הדפס ${sheets} מדבקות`}
          </button>
        </div>
      </div>
    </PackageDialog>
  );
}
