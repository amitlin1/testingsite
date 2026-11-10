/**
 * The templates a report starts from: an official document (מסמך רשמי) —
 * letterhead, numbered sections, the item's particulars, every station's
 * result, a summary and both signatures: the one given at the kit's closing
 * and the approver's final one. The admin edits from here
 * instead of from a blank page. Pure.
 *
 *   officialStarterTemplate  a new route template, before the general one existed
 *   generalStarterTemplate   the general template (תבנית כללית): the report of
 *                            every item route without a template of its own —
 *                            the production migration seeds the same document
 *                            (20261104120000_report_general_template), and
 *                            20261110130000_report_templates_both_signatures
 *                            adds the closing signature to it
 */
import type { Data } from "@measured/puck";
import { DEFAULT_ROOT_PROPS } from "./puck-config";
import { CLOSING_SIGNATURE_BIND, FINAL_SIGNATURE_BIND } from "./types";

type Block = { type: string; props: Record<string, unknown> };

const v = (name: string) => [{ v: name }];

/** The two documents' blocks, ids under one prefix ("starter" / "general"). */
function blocks(prefix: string) {
  let n = 0;
  const id = (type: string) => `${type}-${prefix}-${++n}`;
  return {
    section: (text: string): Block => ({
      type: "Section",
      props: { id: id("Section"), heading: [{ text, b: true, u: true }], variant: "numbered", align: "right", width: "full" },
    }),
    details: (): Block => ({
      type: "DetailsTable",
      props: {
        id: id("DetailsTable"),
        perRow: 2,
        rows: [
          { label: "מספר פריט", value: v("item.item_id") },
          { label: "מספר סידורי", value: v("item.serial_no") },
          { label: "סוג פריט", value: v("item.item_type") },
          { label: "מק\"ט", value: v("item.makat") },
          { label: "דגם", value: v("item.model") },
          { label: "יצרן", value: v("item.manufacturer_name") },
          { label: "לקוח", value: v("item.customer") },
          { label: "מספר משלוח", value: v("item.shipment_code") },
          { label: "תאריך קליטה", value: v("item.created_at") },
          { label: "תאריך סיום הבדיקות", value: v("item.finished_at") },
        ],
        width: "full",
      },
    }),
    results: (showFields: boolean): Block => ({
      type: "ResultsTable",
      props: { id: id("ResultsTable"), showFields, showStation: true, showWorker: true, showDate: true, showComments: true, width: "full" },
    }),
    stepDetails: (): Block => ({
      type: "StepDetails",
      props: { id: id("StepDetails"), showPhotos: true, perRow: 3, height: 45, showComments: true, width: "full" },
    }),
    summary: (): Block => ({
      type: "Text",
      props: {
        id: id("Text"),
        content: [
          { text: "הפריט עבר את שלבי מסלול הבדיקה המפורטים לעיל. תוצאה כוללת: " },
          { v: "item.verdict" },
          { text: "." },
        ],
        align: "justify",
        width: "full",
      },
    }),
    spacer: (): Block => ({ type: "Spacer", props: { id: id("Spacer"), height: 6 } }),
    /** One signature row: its role first ("בודק" / "מאשר סופי"), then the signer and the drawing. */
    signature: (bind: string, role: string): Block => ({
      type: "Signature",
      props: {
        id: id("Signature"),
        bind,
        cells: [
          { kind: "text", label: "תפקיד", text: role, weight: 1 },
          { kind: "fullName", label: "שם ושם משפחה", text: "", weight: 1 },
          { kind: "number", label: "מספר עובד", text: "", weight: 1 },
          { kind: "date", label: "תאריך", text: "", weight: 1 },
          { kind: "signature", label: "חתימה", text: "", weight: 1 },
        ],
        width: "full",
      },
    }),
    /** The closing signature, then the approver's final one. */
    signatures(): Block[] {
      return [this.signature(CLOSING_SIGNATURE_BIND, "בודק"), this.signature(FINAL_SIGNATURE_BIND, "מאשר סופי")];
    },
  };
}

const doc = (content: Block[]): Data =>
  ({ root: { props: structuredClone(DEFAULT_ROOT_PROPS) }, content, zones: {} }) as unknown as Data;

export function officialStarterTemplate(): Data {
  const b = blocks("starter");
  return doc([
    b.section("פרטי הפריט"), b.details(),
    b.section("תוצאות הבדיקות"), b.results(true),
    b.section("סיכום"), b.summary(),
    b.section("אישור"), b.spacer(), ...b.signatures(),
  ]);
}

/** Binds only what every route has (the item's, the report's) and prints the tests from the
 *  item's own results: the summary table, then each station with what it saved and its photos. */
export function generalStarterTemplate(): Data {
  const b = blocks("general");
  return doc([
    b.section("פרטי הפריט"), b.details(),
    b.section("תוצאות הבדיקות"), b.results(false),
    b.section("פירוט לפי עמדה"), b.stepDetails(),
    b.section("סיכום"), b.summary(),
    b.section("אישור"), b.spacer(), ...b.signatures(),
  ]);
}
