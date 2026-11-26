"use client";

// The Puck config the template EDITOR uses: the shared `puckConfig` (labels,
// defaults and the print renders, which the server renderer uses too) plus
// what the author sets on each block — its fields, their options and the array
// summaries. Ported from ticketflow's lib/pdf/editor-config; the pickers know
// the route being edited:
//   - text → the rich-text editor with the route's variables
//   - FieldValue.field → a select of the variables
//   - StepFields / Photos .step → a select of the route's steps (+ kit steps)
//   - Photos.field → the photo fields of the chosen step
//   - Signature.bind → the closing signature, the approver's final one, or a step's worker
//   - header logos → ReportLogoField (bundled emblems or an upload)

import * as React from "react";
import { FieldLabel } from "@measured/puck";
import type { Config, CustomField, Fields } from "@measured/puck";
import { ATTR_LABELS, SIGNER_ATTRS, puckConfig } from "@/app/lib/item-report/puck-config";
import type { PdfComponentProps, TableProps } from "@/app/lib/item-report/puck-config";
import { CLASSIFICATION_OPTIONS, type RootProps } from "@/app/lib/item-report/document";
import { REPORT_FONTS, type ReportFont } from "@/app/lib/item-report/fonts";
import { CLOSING_SIGNATURE_BIND, EXTERNAL_SIGNATURE_BIND, FINAL_SIGNATURE_BIND } from "@/app/lib/item-report/types";
import type { ReportStepRef, ReportVar, SignCell } from "@/app/lib/item-report/types";
import type { RichValue } from "@/app/lib/item-report/rich";
import { RichTextField } from "./RichTextField";
import { ReportLogoField } from "./ReportLogoField";

type EditorConfig = Config<PdfComponentProps, RootProps>;
type Align = "right" | "center" | "left";

/** The palette's groups, in order (PageBreak is not in it — pages have their own controls). */
export const PALETTE: { title: string; components: (keyof PdfComponentProps)[] }[] = [
  { title: "תוכן", components: ["Section", "Text", "DetailsTable", "FieldValue", "List", "Table"] },
  { title: "תוצאות הבדיקות", components: ["ResultsTable", "StepDetails", "StepFields", "Photos", "StepBacks"] },
  { title: "חתימות וערכים", components: ["Signature", "FieldLine"] },
  { title: "מרווחים ומפרידים", components: ["Spacer", "Divider"] },
];

const BOOL_OPTIONS = [
  { label: "כן", value: true },
  { label: "לא", value: false },
];
const ALIGN3_OPTIONS = [
  { label: "ימין", value: "right" },
  { label: "מרכז", value: "center" },
  { label: "שמאל", value: "left" },
];
const PER_ROW_OPTIONS = [1, 2, 3, 4].map((n) => ({ label: String(n), value: n }));
const FONT_OPTIONS = (Object.keys(REPORT_FONTS) as ReportFont[]).map((f) => ({ label: REPORT_FONTS[f].label, value: f }));

const SIGN_CELL_KINDS = [
  { label: "✍ חתימה", value: "signature" },
  ...SIGNER_ATTRS.map((a) => ({ label: a.label, value: a.suffix })),
  { label: "טקסט חופשי", value: "text" },
];

/** A cell's chip in the editor's list. */
function signCellSummary(c: SignCell): string {
  const base =
    c.kind === "signature"
      ? "✍ חתימה"
      : c.kind === "text"
        ? `טקסט: ${c.text || "—"}`
        : c.kind === "role" && c.text
          ? `${ATTR_LABELS.role} (בלי תפקיד: ${c.text})`
          : ATTR_LABELS[c.kind] ?? c.kind;
  return c.label ? `${base}  ·  ${c.label}` : base;
}

const radio = <T,>(label: string, options: { label: string; value: T }[]) => ({ type: "radio" as const, label, options });
const select = <T,>(label: string, options: { label: string; value: T }[]) => ({ type: "select" as const, label, options });
const text = (label: string) => ({ type: "text" as const, label });
const number = (label: string, range: { min?: number; max?: number } = {}) => ({ type: "number" as const, label, ...range });
const yesNo = (label: string) => radio(label, BOOL_OPTIONS);
const photoHeight = () => number("גובה תמונה (מ\"מ)", { min: 20, max: 200 });

/** A <select> with <optgroup>s — Puck's own select field has no groups. */
function groupedSelect(
  label: string,
  options: { value: string; label: string; group?: string }[],
  empty: string,
): CustomField<string> {
  return {
    type: "custom",
    label,
    render: ({ onChange, value }) => {
      const groups = new Map<string, { value: string; label: string }[]>();
      const loose: { value: string; label: string }[] = [];
      for (const o of options) {
        if (!o.group) loose.push(o);
        else (groups.get(o.group) ?? groups.set(o.group, []).get(o.group)!).push(o);
      }
      const known = options.some((o) => o.value === value);
      return (
        <FieldLabel label={label}>
        <select className="rpted-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{empty}</option>
          {value && !known ? <option value={value}>(לא קיים במסלול)</option> : null}
          {loose.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {[...groups.entries()].map(([g, opts]) => (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        </FieldLabel>
      );
    },
  };
}

/** Alignment as an icon button group (ימין / מרכז / שמאל) instead of a select. */
function alignField<A extends string>(): CustomField<A> {
  return {
    type: "custom",
    label: "יישור",
    render: ({ onChange, value }) => {
      const cur = value || "right";
      const choices: { d: Align; t: string }[] = [
        { d: "right", t: "ימין" },
        { d: "center", t: "מרכז" },
        { d: "left", t: "שמאל" },
      ];
      const bars: Record<Align, [number, number][]> = {
        right: [[3, 13], [7, 13], [5, 13]],
        left: [[3, 13], [3, 9], [3, 11]],
        center: [[3, 13], [5, 11], [4, 12]],
      };
      return (
        <FieldLabel label="יישור" el="div">
        <div className="pdf-alignfield">
          {choices.map(({ d, t }) => (
            <button
              key={d}
              type="button"
              title={t}
              aria-label={t}
              aria-pressed={cur === d}
              className={`pdf-alignbtn${cur === d ? " is-on" : ""}`}
              // Every choice here is a value of the component's own align (A includes these three).
              onClick={() => onChange(d as A)}
            >
              <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
                {bars[d].map(([x1, x2], i) => (
                  <rect key={i} x={x1} y={1 + i * 4} width={x2 - x1} height="2" rx="1" />
                ))}
              </svg>
            </button>
          ))}
        </div>
        </FieldLabel>
      );
    },
  };
}

export function buildEditorConfig(opts: { vars: ReportVar[]; steps: ReportStepRef[] }): Config {
  const { vars, steps } = opts;
  const c = puckConfig.components;

  const richField = (label: string, minHeight?: number): CustomField<string | RichValue> => ({
    type: "custom",
    label,
    render: ({ onChange, value }) => (
      <FieldLabel label={label} el="div">
        <RichTextField value={value} onChange={onChange} variables={vars} minHeight={minHeight} />
      </FieldLabel>
    ),
  });
  const logoField = (label: string): CustomField<string> => ({
    type: "custom",
    label,
    render: ({ onChange, value }) => (
      <FieldLabel label={label} el="div">
        <ReportLogoField value={value ?? ""} onChange={onChange} />
      </FieldLabel>
    ),
  });
  const stepOptions = steps.map((s) => ({ value: s.uid, label: s.label, group: s.group }));

  // Table cells → WYSIWYG, each cell labelled by its column's header.
  const columnName = (columns: TableProps["columns"], i = 0): string => {
    const h = columns?.[i]?.header;
    return typeof h === "string" && h.trim() ? h.trim() : "תא";
  };
  const tableFields = (columns: TableProps["columns"]): Fields<TableProps> => ({
    headerBackground: yesNo("רקע לכותרות"),
    columns: {
      type: "array",
      label: "עמודות (כותרות)",
      arrayFields: { header: text("כותרת"), width: number("משקל רוחב") },
      defaultItemProps: { header: "עמודה", width: 1 },
      getItemSummary: (item) => item.header || "עמודה",
    },
    rows: {
      type: "array",
      label: "שורות",
      arrayFields: {
        cells: {
          type: "array",
          label: "תאים",
          arrayFields: { content: richField("תוכן", 40) },
          defaultItemProps: { content: "" },
          getItemSummary: (_cell, i) => columnName(columns, i ?? 0),
        },
      },
      defaultItemProps: { cells: [{ content: "" }] },
      getItemSummary: (_row, i) => `שורה ${(i ?? 0) + 1}`,
    },
  });

  // Photos: the step, then that step's photo fields (rebuilt when the step changes).
  const photosFields = (stepUid: string): Fields<PdfComponentProps["Photos"]> => {
    const photoFields = steps.find((s) => s.uid === stepUid)?.fields.filter((f) => f.type === "photo") ?? [];
    return {
      step: groupedSelect("עמדה", stepOptions, "כל העמדות"),
      field: groupedSelect("שדה צילום", photoFields.map((f) => ({ value: f.id, label: f.label })), "כל שדות הצילום"),
      perRow: select("תמונות בשורה", PER_ROW_OPTIONS),
      height: photoHeight(),
      captions: yesNo("כיתוב מתחת לתמונה"),
    };
  };

  const components: EditorConfig["components"] = {
    Section: {
      ...c.Section,
      fields: {
        heading: richField("טקסט הכותרת", 44),
        variant: select("סגנון", [
          { label: "סעיף ממוספר (1. 2. 3.)", value: "numbered" },
          { label: "רגיל", value: "plain" },
          { label: "מסגרת", value: "box" },
        ]),
        align: alignField(),
      },
    },
    Text: { ...c.Text, fields: { content: richField("תוכן", 72), align: alignField() } },
    FieldValue: {
      ...c.FieldValue,
      fields: {
        field: groupedSelect("משתנה (ימולא אוטומטית)", vars.map((v) => ({ value: v.name, label: v.label, group: v.group })), "בחר/י משתנה…"),
        caption: text("תווית לפני הערך (לא חובה)"),
      },
    },
    List: {
      ...c.List,
      fields: {
        ordered: yesNo("ממוספרת"),
        items: {
          type: "array",
          label: "פריטים",
          arrayFields: { content: richField("טקסט", 48) },
          defaultItemProps: { content: "פריט" },
          getItemSummary: (item) => (typeof item.content === "string" ? item.content || "פריט" : "פריט"),
        },
      },
    },
    Table: {
      ...c.Table,
      fields: tableFields(c.Table.defaultProps?.columns ?? []),
      resolveFields: (data) => tableFields(data?.props?.columns ?? []),
    },
    DetailsTable: {
      ...c.DetailsTable,
      fields: {
        perRow: radio("זוגות בשורה", [{ label: "1", value: 1 }, { label: "2", value: 2 }]),
        rows: {
          type: "array",
          label: "שורות",
          arrayFields: { label: text("תווית"), value: richField("ערך", 36) },
          defaultItemProps: { label: "תווית", value: "" },
          getItemSummary: (item) => item.label || "שורה",
        },
      },
    },
    FieldLine: { ...c.FieldLine, fields: { value: richField("ערך", 44), caption: text("תווית מתחת") } },
    ResultsTable: {
      ...c.ResultsTable,
      fields: {
        showFields: yesNo("להציג את השדות של כל עמדה"),
        showStation: yesNo("עמודת עמדה"),
        showWorker: yesNo("עמודת עובד"),
        showDate: yesNo("עמודת תאריך"),
        showComments: yesNo("עמודת הערות"),
      },
    },
    StepBacks: { ...c.StepBacks, fields: { showTitle: yesNo("כותרת מעל הטבלה") } },
    StepFields: {
      ...c.StepFields,
      fields: {
        step: groupedSelect("עמדה", stepOptions, "בחר/י עמדה…"),
        showHeader: yesNo("שורת עמדה · עובד · תאריך"),
        showNotes: yesNo("עמודת הערות"),
      },
    },
    StepDetails: {
      ...c.StepDetails,
      fields: {
        showPhotos: yesNo("להציג את התמונות של כל עמדה"),
        perRow: select("תמונות בשורה", PER_ROW_OPTIONS),
        height: photoHeight(),
        showComments: yesNo("להציג הערות"),
      },
    },
    Photos: { ...c.Photos, fields: photosFields(""), resolveFields: (data) => photosFields(data?.props?.step ?? "") },
    // Signature: a hand-drawn signature (at the kit's closing, or the approver's final one) or a step's worker.
    Signature: {
      ...c.Signature,
      fields: {
        bind: groupedSelect(
          "חותם",
          [
            { value: CLOSING_SIGNATURE_BIND, label: "החותם בסגירת המארז (חתימה ידנית)" },
            { value: FINAL_SIGNATURE_BIND, label: "מאשר הדוח · חתימה סופית (חתימה ידנית, נועלת את הדוח)" },
            { value: EXTERNAL_SIGNATURE_BIND, label: "גורם חיצוני · מאשר דוח לא תקין (מודפס רק כשאושר, במקום החתימה הסופית)" },
            ...steps.map((s) => ({ value: `step:${s.uid}`, label: `העובד · ${s.label}`, group: s.group })),
          ],
          "בחר/י חותם…",
        ),
        cells: {
          type: "array",
          label: "תאים בשורה (בחר/י סוג וסדר)",
          arrayFields: {
            kind: select("סוג התא", SIGN_CELL_KINDS),
            label: text("כיתוב מתחת (לא חובה)"),
            text: text('טקסט (ל"טקסט חופשי"; ב"תפקיד החותם" — מה שיודפס לחתימה ישנה בלי תפקיד)'),
            weight: number("רוחב יחסי", { min: 1 }),
          },
          defaultItemProps: { kind: "signature", label: "", text: "", weight: 1 },
          getItemSummary: (item) => signCellSummary(item),
        },
      },
    },
    Spacer: { ...c.Spacer, fields: { height: number("גובה (מ\"מ)") } },
    Divider: { ...c.Divider, fields: {} },
    PageBreak: { ...c.PageBreak, fields: {} },
  };

  const root: EditorConfig["root"] = {
    ...puckConfig.root,
    fields: {
      header: {
        type: "object",
        label: "כותרת עליונה",
        objectFields: {
          show: yesNo("להציג כותרת עליונה"),
          org: richField("הגוף המוציא (שורה לכל רמה)", 64),
          meta: richField("פרטי המסמך (מספר, תאריך, סימוכין)", 64),
          title: richField("כותרת המסמך", 40),
          subtitle: richField("כותרת משנה", 40),
          rightLogo: logoField("סמל ימין"),
          leftLogo: logoField("סמל שמאל"),
        },
      },
      footer: {
        type: "object",
        label: "כותרת תחתונה",
        objectFields: {
          show: yesNo("להציג כותרת תחתונה"),
          text: text("טקסט קבוע בתחתית"),
          textAlign: radio("מיקום הטקסט", ALIGN3_OPTIONS),
          pageNumbers: yesNo("מספור עמודים"),
          pageNumberStyle: select("תבנית מספור", [
            { label: "עמוד N", value: "plain" },
            { label: "עמוד N מתוך M", value: "of" },
            { label: "N / M", value: "slash" },
          ]),
          pageNumberAlign: radio("מיקום המספור (שורה נפרדת)", ALIGN3_OPTIONS),
        },
      },
      classification: select("סיווג (בראש ובתחתית כל עמוד)", CLASSIFICATION_OPTIONS),
      font: select("גופן", FONT_OPTIONS),
      border: select("מסגרת לכל העמודים", [
        { label: "ללא מסגרת", value: "none" },
        { label: "מסגרת מלאה", value: "solid" },
        { label: "מסגרת מקווקוות", value: "dashed" },
      ]),
    },
  };

  const config: EditorConfig = { ...puckConfig, components, root };
  // <Puck> takes the untyped Config; ours is the same object with its props spelled out.
  return config as unknown as Config;
}
