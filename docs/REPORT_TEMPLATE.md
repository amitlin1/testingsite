# תבנית דוחות אחידה — TESTINGSITE

> The per-item test report (דוח פריט) is NOT built with this kit: it is a
> template per route, edited in the app and rendered by the server — see
> [ITEM_REPORTS.md](ITEM_REPORTS.md). This kit remains for the shipment
> certificates.

The shipment documents (תעודות) are built from the kit in
`src/app/components/reports/`. Design reference (canvas):
https://claude.ai/artifact/PSd4Grmi3YkKawD6H55fxj

## Files

| File | Role |
| --- | --- |
| `reportTheme.ts` | Colors (from the emblems), fonts, logo paths, org line, classification |
| `ReportKit.tsx` | `ReportPage`, `ReportSection`, `FieldGrid`, `ReportTable`, `SignatureBlock`, `EmblemStrip` |
| `src/app/lib/datetime.ts` | The date format (`formatDocDate`) |
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

A one-page document (e.g. `ShipmentDeliveryForm`) can pass `fillPage` to
`ReportPage`: the page stretches to the full A4 height, and a child with
`marginTop: "auto"` — the signature — drops to the bottom together with the
footer. `FieldGrid large` gives bigger cells for a document with few fields.

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

Stations save their values through the station fields and popup templates; the
item report (ITEM_REPORTS.md) prints them. A legacy `fields` array of
`{ label, value, unit?, passed? }` is still printed by the item report as
label / value rows (`passed` sets the verdict) — `rowFields` in
`src/app/lib/item-report/variables.ts`.
