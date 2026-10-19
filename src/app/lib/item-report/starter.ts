/**
 * The template a route's report starts from: an official document (מסמך
 * רשמי) — letterhead, numbered sections, the item's particulars, every
 * station's result, a summary and the approver's signature. The admin edits
 * from here instead of from a blank page. Pure.
 */
import type { Data } from "@measured/puck";
import { DEFAULT_ROOT_PROPS } from "./puck-config";
import { FINAL_SIGNATURE_BIND } from "./types";

let n = 0;
const id = (type: string) => `${type}-starter-${++n}`;
const section = (text: string) => ({
  type: "Section",
  props: { id: id("Section"), heading: [{ text, b: true, u: true }], variant: "numbered", align: "right", width: "full" },
});
const v = (name: string) => [{ v: name }];

export function officialStarterTemplate(): Data {
  n = 0;
  return {
    root: { props: structuredClone(DEFAULT_ROOT_PROPS) },
    content: [
      section("פרטי הפריט"),
      {
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
      },
      section("תוצאות הבדיקות"),
      {
        type: "ResultsTable",
        props: { id: id("ResultsTable"), showFields: true, showStation: true, showWorker: true, showDate: true, showComments: true, width: "full" },
      },
      section("סיכום"),
      {
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
      },
      section("אישור"),
      { type: "Spacer", props: { id: id("Spacer"), height: 6 } },
      {
        type: "Signature",
        props: {
          id: id("Signature"),
          bind: FINAL_SIGNATURE_BIND,
          cells: [
            { kind: "fullName", label: "שם ושם משפחה", text: "", weight: 1 },
            { kind: "number", label: "מספר עובד", text: "", weight: 1 },
            { kind: "date", label: "תאריך", text: "", weight: 1 },
            { kind: "signature", label: "חתימה", text: "", weight: 1 },
          ],
          width: "full",
        },
      },
    ],
    zones: {},
  } as unknown as Data;
}
