"use client";

// Builds the Puck config used by the EDITOR from the shared `puckConfig` (which
// the server renderer also uses). Ported from ticketflow's lib/pdf/editor-config:
// render functions are reused verbatim — only the editor-side FIELD definitions
// are swapped for pickers that know the route being edited:
//   - text → the rich-text editor with the route's variables
//   - FieldValue.field → a select of the variables
//   - StepFields / Photos .step → a select of the route's steps (+ kit steps)
//   - Photos.field → the photo fields of the chosen step
//   - Signature.bind → "the report's signer" or a step's worker
//   - header logos → ReportLogoField (bundled emblems or an upload)

import * as React from "react";
import { FieldLabel } from "@measured/puck";
import type { Config, CustomField } from "@measured/puck";
import { puckConfig } from "@/app/lib/item-report/puck-config";
import { FINAL_SIGNATURE_BIND } from "@/app/lib/item-report/types";
import type { ReportStepRef, ReportVar } from "@/app/lib/item-report/types";
import type { RichValue } from "@/app/lib/item-report/rich";
import { RichTextField } from "./RichTextField";
import { ReportLogoField } from "./ReportLogoField";

// Puck's component/field types are heavily generic; this builder does shallow
// structural overrides, so we work in `any` locally and re-assert Config.

/** A <select> with <optgroup>s — Puck's own select field has no groups. */
function groupedSelect(
  label: string,
  options: { value: string; label: string; group?: string }[],
  empty: string,
): CustomField<string> {
  return {
    type: "custom",
    label,
    render: ({ onChange, value }: any) => {
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

export function buildEditorConfig(opts: { vars: ReportVar[]; steps: ReportStepRef[] }): Config {
  const { vars, steps } = opts;
  const components: any = { ...(puckConfig.components as any) };

  // Alignment as an icon button group (ימין / מרכז / שמאל) instead of a select.
  const alignField = (): CustomField<string> => ({
    type: "custom",
    label: "יישור",
    render: ({ onChange, value }: any) => {
      const cur = value || "right";
      const choices: { d: "right" | "center" | "left"; t: string }[] = [
        { d: "right", t: "ימין" },
        { d: "center", t: "מרכז" },
        { d: "left", t: "שמאל" },
      ];
      const bars: Record<string, [number, number][]> = {
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
              onClick={() => onChange(d)}
            >
              <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
                {bars[d]!.map(([x1, x2], i) => (
                  <rect key={i} x={x1} y={1 + i * 4} width={x2 - x1} height="2" rx="1" />
                ))}
              </svg>
            </button>
          ))}
        </div>
        </FieldLabel>
      );
    },
  });

  const richField = (label: string, minHeight?: number): CustomField<RichValue> => ({
    type: "custom",
    label,
    render: ({ onChange, value }: any) => (
      <FieldLabel label={label} el="div">
        <RichTextField value={value} onChange={onChange} variables={vars} minHeight={minHeight} />
      </FieldLabel>
    ),
  });

  const text: any = components.Text;
  components.Text = { ...text, fields: { ...text.fields, content: richField("תוכן", 72), align: alignField() } };

  const list: any = components.List;
  components.List = {
    ...list,
    fields: { ...list.fields, items: { ...list.fields.items, arrayFields: { content: richField("טקסט", 48) } } },
  };

  const section: any = components.Section;
  components.Section = {
    ...section,
    fields: { ...section.fields, heading: richField("טקסט הכותרת", 44), align: alignField() },
  };

  const fieldLine: any = components.FieldLine;
  components.FieldLine = { ...fieldLine, fields: { ...fieldLine.fields, value: richField("ערך", 44) } };

  // Table cells → WYSIWYG, each cell labelled by its column's header.
  const table: any = components.Table;
  const columnName = (columns: any[], i = 0): string => {
    const h = columns?.[i]?.header;
    return typeof h === "string" && h.trim() ? h.trim() : "תא";
  };
  const tableFields = (columns: any[]) => ({
    ...table.fields,
    rows: {
      ...table.fields.rows,
      arrayFields: {
        cells: {
          ...table.fields.rows.arrayFields.cells,
          arrayFields: { content: richField("תוכן", 40) },
          getItemSummary: (_cell: unknown, i?: number) => columnName(columns, i ?? 0),
        },
      },
    },
  });
  components.Table = {
    ...table,
    fields: tableFields(table.defaultProps?.columns ?? []),
    resolveFields: (data: any) => tableFields(data?.props?.columns ?? []),
  };

  // DetailsTable: each row's value takes variables.
  const dt: any = components.DetailsTable;
  components.DetailsTable = {
    ...dt,
    fields: {
      ...dt.fields,
      rows: {
        ...dt.fields.rows,
        arrayFields: { label: dt.fields.rows.arrayFields.label, value: richField("ערך", 36) },
      },
    },
  };

  // FieldValue: one variable, from the grouped list.
  const fv: any = components.FieldValue;
  components.FieldValue = {
    ...fv,
    fields: {
      ...fv.fields,
      field: groupedSelect("משתנה (ימולא אוטומטית)", vars.map((v) => ({ value: v.name, label: v.label, group: v.group })), "בחר/י משתנה…"),
    },
  };

  const stepOptions = steps.map((s) => ({ value: s.uid, label: s.label, group: s.group }));

  const sf: any = components.StepFields;
  components.StepFields = { ...sf, fields: { ...sf.fields, step: groupedSelect("עמדה", stepOptions, "בחר/י עמדה…") } };

  // Photos: the step, then that step's photo fields (rebuilt when the step changes).
  const ph: any = components.Photos;
  const photosFields = (stepUid: string) => {
    const photoFields = steps.find((s) => s.uid === stepUid)?.fields.filter((f) => f.type === "photo") ?? [];
    return {
      ...ph.fields,
      step: groupedSelect("עמדה", stepOptions, "כל העמדות"),
      field: groupedSelect("שדה צילום", photoFields.map((f) => ({ value: f.id, label: f.label })), "כל שדות הצילום"),
    };
  };
  components.Photos = { ...ph, fields: photosFields(""), resolveFields: (data: any) => photosFields(data?.props?.step ?? "") };

  // Signature: the report's signer (hand-drawn, at the end) or a step's worker.
  const sig: any = components.Signature;
  components.Signature = {
    ...sig,
    fields: {
      ...sig.fields,
      bind: groupedSelect(
        "חותם",
        [
          { value: FINAL_SIGNATURE_BIND, label: "מאשר הדוח (חתימה ידנית בסיום)" },
          ...steps.map((s) => ({ value: `step:${s.uid}`, label: `העובד · ${s.label}`, group: s.group })),
        ],
        "בחר/י חותם…",
      ),
    },
  };

  const logoField = (label: string): CustomField<string> => ({
    type: "custom",
    label,
    render: ({ onChange, value }: any) => (
      <FieldLabel label={label} el="div">
        <ReportLogoField value={value ?? ""} onChange={onChange} />
      </FieldLabel>
    ),
  });
  const root: any = puckConfig.root;
  const newRoot = {
    ...root,
    fields: {
      ...root.fields,
      header: {
        ...root.fields.header,
        objectFields: {
          ...root.fields.header.objectFields,
          org: richField("הגוף המוציא (שורה לכל רמה)", 64),
          meta: richField("פרטי המסמך (מספר, תאריך, סימוכין)", 64),
          title: richField("כותרת המסמך", 40),
          subtitle: richField("כותרת משנה", 40),
          rightLogo: logoField("סמל ימין"),
          leftLogo: logoField("סמל שמאל"),
        },
      },
    },
  };

  return { ...(puckConfig as any), components, root: newRoot } as Config;
}
