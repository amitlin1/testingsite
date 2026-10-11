# תבנית דוחות אחידה — TESTINGSITE

Every printed document (תעודות, דוחות) is built from the kit in
`src/app/components/reports/`. Design reference (canvas):
https://claude.ai/artifact/PSd4Grmi3YkKawD6H55fxj

## Files

| File | Role |
| --- | --- |
| `reportTheme.ts` | Colors (from the emblems), fonts, logo paths, org line, classification, date format |
| `ReportKit.tsx` | `ReportPage`, `ReportSection`, `FieldGrid`, `ReportTable`, `StatusChip`, `SignatureBlock`, `EmblemStrip` |
| `testDetails.ts` | Reads `test_results.details` into report fields |
| `TestResultsReportDocument.tsx` | דוח תוצאות בדיקה |
| `../shipments/ShipmentPDFDocument.tsx` | תעודת משלוח / קבלת משלוח |
| `public/report-logos/` | The four emblems (copied from SIDECAR's `assets/`) |

## Page anatomy

1. Classification mark (only when `REPORT_CLASSIFICATION` is set)
2. Header — two emblems on each side, Hebrew title, English subtitle, optional "תעודה מבצעית" badge
3. Emblem strip — navy / red / yellow / sky at 6 : 2 : 1 : 1
4. Meta row — מס׳ מסמך · תאריך הפקה · הופק ע״י · extra cells
5. Sections (`ReportSection`) — field grids, tables, per-test blocks
6. Signatures
7. Footer — "הופק אוטומטית ממערכת TESTINGSITE"; "עמוד X מתוך Y" is printed by `@page` on every page

A4 portrait, 10–12 mm margins. Table headers repeat on every page; field
cells, per-test blocks and signatures never split across pages. Fonts are the
bundled Rubik (air-gapped — no web fonts).

## A new document

```tsx
const MyReport = React.forwardRef<HTMLDivElement, Props>((p, ref) => (
  <ReportPage ref={ref} titleHe="..." titleEn="..." documentNumber={p.code}>
    <ReportSection title="...">
      <FieldGrid fields={[{ label: "...", value: "..." }]} />
    </ReportSection>
    <ReportSection title="...">
      <ReportTable columns={[...]} rows={p.rows} />
    </ReportSection>
    <SignatureBlock slots={[{ role: "מוסר" }, { role: "מקבל" }]} />
  </ReportPage>
));
```

Print it with `useReactToPrint({ contentRef })`, as `ShipmentTable` does.

## Per-test fields (`test_results.details`)

Stations should write:

```json
{ "fields": [
  { "label": "מתח כניסה", "type": "number", "value": 27.9, "unit": "V", "min": 26, "max": 30 },
  { "label": "שלמות מארז", "type": "boolean", "value": true, "expected": true },
  { "label": "מצב מערכת", "type": "choice", "value": "תקין", "expected": "תקין" },
  { "label": "גרסת תוכנה", "type": "text", "value": "1.4.2" }
] }
```

- `number` — pass when inside `min`/`max` (inclusive); out of range prints red "✕ חריגה".
- `boolean` / `choice` — pass when `value` equals `expected`.
- `text` — shown without a verdict.
- `passed: true|false` on a field overrides the computed verdict.
- A legacy flat object (`{ "key": value }`) is still shown, as text fields.
