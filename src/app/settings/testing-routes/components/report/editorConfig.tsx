"use client";

// Builds the Puck config used by the EDITOR from the shared `puckConfig` (which
// the server renderer also uses). Ported from ticketflow's lib/pdf/editor-config:
// render functions are reused verbatim — only the editor-side FIELD definitions
// are swapped for pickers that know the route being edited:
//   - text → the rich-text editor with the route's variables
//   - FieldValue.field → a select of the variables
//   - StepFields / Photos .step → a select of the route's steps (+ kit steps)
//   - Photos.field → the photo fields of the chosen step
//   - Signature.bind → the closing signature, the approver's final one, or a step's worker
//   - header logos → ReportLogoField (bundled emblems or an upload)

import * as React from "react";
import { FieldLabel } from "@measured/puck";
import type { ArrayField, Config, CustomField, Field, Fields, ObjectField } from "@measured/puck";
import { puckConfig } from "@/app/lib/item-report/puck-config";
import type { PdfComponentProps, RootProps, TableProps } from "@/app/lib/item-report/puck-config";
import { CLOSING_SIGNATURE_BIND, FINAL_SIGNATURE_BIND } from "@/app/lib/item-report/types";
import type { ReportStepRef, ReportVar } from "@/app/lib/item-report/types";
import type { RichValue } from "@/app/lib/item-report/rich";
import { RichTextField } from "./RichTextField";
import { ReportLogoField } from "./ReportLogoField";

type EditorConfig = Config<PdfComponentProps, RootProps>;
type Align = "right" | "center" | "left";

/** A component's own fields (every component of puckConfig declares them). */
function fieldsOf<F>(fields: F | undefined, name: string): F {
  if (!fields) throw new Error(`report editor: ${name} declares no fields`);
  return fields;
}
/** A field puckConfig declares as an array (its rows) — checked, so its arrayFields can be swapped. */
function arrayOf<T extends { [key: string]: unknown }[]>(f: Field<T>, name: string): ArrayField<T> {
  if (f.type !== "array") throw new Error(`report editor: ${name} is not an array field`);
  return f;
}
/** A field puckConfig declares as an object — checked, so its objectFields can be swapped. */
function objectOf<T>(f: Field<T>, name: string): ObjectField<T> {
  if (f.type !== "object") throw new Error(`report editor: ${name} is not an object field`);
  return f;
}

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

export function buildEditorConfig(opts: { vars: ReportVar[]; steps: ReportStepRef[] }): Config {
  const { vars, steps } = opts;
  const components: EditorConfig["components"] = { ...puckConfig.components };

  // Alignment as an icon button group (ימין / מרכז / שמאל) instead of a select.
  const alignField = <A extends string>(): CustomField<A> => ({
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
  });

  const richField = (label: string, minHeight?: number): CustomField<string | RichValue> => ({
    type: "custom",
    label,
    render: ({ onChange, value }) => (
      <FieldLabel label={label} el="div">
        <RichTextField value={value} onChange={onChange} variables={vars} minHeight={minHeight} />
      </FieldLabel>
    ),
  });

  const text = components.Text;
  const textFields = fieldsOf(text.fields, "Text");
  components.Text = { ...text, fields: { ...textFields, content: richField("תוכן", 72), align: alignField() } };

  const list = components.List;
  const listFields = fieldsOf(list.fields, "List");
  components.List = {
    ...list,
    fields: { ...listFields, items: { ...arrayOf(listFields.items, "List.items"), arrayFields: { content: richField("טקסט", 48) } } },
  };

  const section = components.Section;
  const sectionFields = fieldsOf(section.fields, "Section");
  components.Section = {
    ...section,
    fields: { ...sectionFields, heading: richField("טקסט הכותרת", 44), align: alignField() },
  };

  const fieldLine = components.FieldLine;
  components.FieldLine = { ...fieldLine, fields: { ...fieldsOf(fieldLine.fields, "FieldLine"), value: richField("ערך", 44) } };

  // Table cells → WYSIWYG, each cell labelled by its column's header.
  const table = components.Table;
  const tableBase = fieldsOf(table.fields, "Table");
  const tableRows = arrayOf(tableBase.rows, "Table.rows");
  const tableCells = arrayOf(tableRows.arrayFields.cells, "Table.rows.cells");
  const columnName = (columns: TableProps["columns"], i = 0): string => {
    const h = columns?.[i]?.header;
    return typeof h === "string" && h.trim() ? h.trim() : "תא";
  };
  const tableFields = (columns: TableProps["columns"]): Fields<TableProps> => ({
    ...tableBase,
    rows: {
      ...tableRows,
      arrayFields: {
        cells: {
          ...tableCells,
          arrayFields: { content: richField("תוכן", 40) },
          getItemSummary: (_cell: unknown, i?: number) => columnName(columns, i ?? 0),
        },
      },
    },
  });
  components.Table = {
    ...table,
    fields: tableFields(table.defaultProps?.columns ?? []),
    resolveFields: (data) => tableFields(data?.props?.columns ?? []),
  };

  // DetailsTable: each row's value takes variables.
  const dt = components.DetailsTable;
  const dtFields = fieldsOf(dt.fields, "DetailsTable");
  const dtRows = arrayOf(dtFields.rows, "DetailsTable.rows");
  components.DetailsTable = {
    ...dt,
    fields: {
      ...dtFields,
      rows: {
        ...dtRows,
        arrayFields: { label: dtRows.arrayFields.label, value: richField("ערך", 36) },
      },
    },
  };

  // FieldValue: one variable, from the grouped list.
  const fv = components.FieldValue;
  components.FieldValue = {
    ...fv,
    fields: {
      ...fieldsOf(fv.fields, "FieldValue"),
      field: groupedSelect("משתנה (ימולא אוטומטית)", vars.map((v) => ({ value: v.name, label: v.label, group: v.group })), "בחר/י משתנה…"),
    },
  };

  const stepOptions = steps.map((s) => ({ value: s.uid, label: s.label, group: s.group }));

  const sf = components.StepFields;
  components.StepFields = { ...sf, fields: { ...fieldsOf(sf.fields, "StepFields"), step: groupedSelect("עמדה", stepOptions, "בחר/י עמדה…") } };

  // Photos: the step, then that step's photo fields (rebuilt when the step changes).
  const ph = components.Photos;
  const phFields = fieldsOf(ph.fields, "Photos");
  const photosFields = (stepUid: string): typeof phFields => {
    const photoFields = steps.find((s) => s.uid === stepUid)?.fields.filter((f) => f.type === "photo") ?? [];
    return {
      ...phFields,
      step: groupedSelect("עמדה", stepOptions, "כל העמדות"),
      field: groupedSelect("שדה צילום", photoFields.map((f) => ({ value: f.id, label: f.label })), "כל שדות הצילום"),
    };
  };
  components.Photos = { ...ph, fields: photosFields(""), resolveFields: (data) => photosFields(data?.props?.step ?? "") };

  // Signature: a hand-drawn signature (at the kit's closing, or the approver's final one) or a step's worker.
  const sig = components.Signature;
  components.Signature = {
    ...sig,
    fields: {
      ...fieldsOf(sig.fields, "Signature"),
      bind: groupedSelect(
        "חותם",
        [
          { value: CLOSING_SIGNATURE_BIND, label: "החותם בסגירת המארז (חתימה ידנית)" },
          { value: FINAL_SIGNATURE_BIND, label: "מאשר הדוח · חתימה סופית (חתימה ידנית, נועלת את הדוח)" },
          ...steps.map((s) => ({ value: `step:${s.uid}`, label: `העובד · ${s.label}`, group: s.group })),
        ],
        "בחר/י חותם…",
      ),
    },
  };

  const logoField = (label: string): CustomField<string> => ({
    type: "custom",
    label,
    render: ({ onChange, value }) => (
      <FieldLabel label={label} el="div">
        <ReportLogoField value={value ?? ""} onChange={onChange} />
      </FieldLabel>
    ),
  });
  const root = puckConfig.root;
  const rootFields = fieldsOf(root?.fields, "root");
  const header = objectOf(rootFields.header, "root.header");
  const newRoot: EditorConfig["root"] = {
    ...root,
    fields: {
      ...rootFields,
      header: {
        ...header,
        objectFields: {
          ...header.objectFields,
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

  const config: EditorConfig = { ...puckConfig, components, root: newRoot };
  // <Puck> takes the untyped Config; ours is the same object with its props spelled out.
  return config as unknown as Config;
}
