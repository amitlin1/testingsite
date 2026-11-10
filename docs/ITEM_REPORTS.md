# דוחות PDF לפריטים — Item reports

Every item gets a PDF report at the end of its route, built from its route's
template — or, when the route has none, from the **general template** — and filled
with the results of **every station the item passed**.
The engine is ported from ticketflow's ticket PDF (`ticketflow/src/lib/pdf`):
a Puck document edited in a WYSIWYG editor, rendered to HTML on the server and
printed to PDF by headless Chromium, stored in MinIO and frozen once final.

## Where things are

| What | Where |
|---|---|
| Edit the general template / a route's template | הגדרות מערכת → מסלולי בדיקה → לשונית **דוח PDF** (the general template's row leads it) |
| Download an item's report / give its final signature | היסטוריית פריט (`/items/<id>/history`) — the buttons under the status |
| Sign a kit's reports at its closing (the closing signature) | the closing template's "חתימה על הדוחות" step (`report_sign`) — see below |
| Template components (shared by editor + server) | `src/app/lib/item-report/puck-config.tsx` |
| Variables: catalog + values | `src/app/lib/item-report/variables.ts` (pure, unit-tested) |
| Route catalog (server) | `src/app/lib/item-report/catalog.ts` |
| Render + freeze + sign | `src/app/lib/item-report/generate.ts` |
| Chromium | `src/app/lib/item-report/render.ts`, `html.ts` (fonts inlined — air-gap safe) |
| Fonts | `src/app/lib/item-report/fonts.ts`, `public/fonts/` |
| Starter / general template | `src/app/lib/item-report/starter.ts` (`officialStarterTemplate`, `generalStarterTemplate`) |
| Editor UI | `src/app/settings/testing-routes/components/report/` |
| APIs | `src/app/api/item-reports/` |
| DB | `report_templates`, `item_reports` (migration `20261020120000_item_reports`); `report_general_template` (`20261104120000_report_general_template`); `item_reports.closing_*` (`20261110120000_report_closing_signature`); both signatures in every template (`20261110130000_report_templates_both_signatures`) |
| Production SQL | `scripts/prod-item-reports/1-item-reports.sql`, `scripts/prod-report-general-template/1-report-general-template.sql`, `scripts/prod-report-closing-signature/1-report-closing-signature.sql` + `2-report-templates-both-signatures.sql` |

## The look — an official document

Reports print as an official document (מסמך רשמי), black ink only, so a
black-and-white copy loses nothing:

- **Font**: David Libre (the David face of official documents; SIL OFL,
  `public/fonts/david-libre/`). Rubik can be chosen per template.
- **Letterhead**: emblems on both sides of the issuing body's lines
  ("מדינת ישראל / שם היחידה / …"), a double rule, the document's particulars
  on the left (מספר / תאריך / סימוכין), then the title — bold, centred, underlined.
- **Classification** (בלמ"ס / שמור / סודי / סודי ביותר) at the top and bottom of
  every page, when set.
- **Numbered sections** (1. 2. 3.), **ruled tables** with grey label cells, the
  **טבלת פרטים** block for particulars, verdicts as words (✓ תקין / ✕ לא תקין).
- A section heading never ends a page; it moves with what follows it.

## The general template, and a route's own

Every item gets a report. Its template is chosen in `loadRouteAndTemplate`:

1. the route's own (`report_templates`, one per `testing_routes` row = item type + route number) —
   "מותאמת" in the tab;
2. else the **general template** (`report_general_template`, one row) — "כללית";
3. a kit's box gets none: the report is per **item** (on a kit, the tab lists the routes of the
   kit's lines).

The general template binds only what every route has — `item.*` and `report.*`, no step — and
prints the tests from the item's own results: פרטי הפריט, the results table, **פירוט לפי עמדה**
(StepDetails: every station with what it saved and its photos), סיכום, and אישור with the approver's
signature (`generalStarterTemplate`; the migration seeds the same document). It cannot be deleted
or saved empty; saving it asks first, naming how many routes use it (`GET …/templates/general` →
`routes`). "התאמה למסלול" starts a route's own template from a copy of it; "חזרה לתבנית הכללית" deletes
the route's template.

## Variables

| Variable | Value |
|---|---|
| `item.<key>` | the item: מספר פריט, סריאלי, מק"ט, דגם, יצרן, לקוח, משלוח, מארז, תאריכים, תוצאה כוללת |
| `step.<uid>.<attr>` | a station step: שם השלב, עמדה, עובד, מספר עובד, תאריך, שעה, תוצאה, ערך תוצאה, הערות |
| `field.<uid>.<fieldId>` | the value a worker filled in a station field (`.status` = תקין / לא תקין, `.note`) |
| `report.<key>` | תאריך ההפקה, מאשר הדוח ותאריך החתימה הסופית, החותם בסגירה ותאריך החתימה בסגירה |

Steps are addressed by **step uid**, never by position (the station-fields
contract): moving or removing steps never re-points a variable. A kit's
package-level steps (opening / closing) are offered too — an item's row there
carries the kit route's uid.

A step run more than once prints its **latest** result. Research benches are not
route steps. Worker names come from the metrics ledger (the name at the time),
else from today's Keycloak directory.

## Blocks

Ticketflow's blocks (טקסט, כותרת — numbered by default, ערך ממשתנה, רשימה, טבלה, שורת ערך, רווח, קו
מפריד, מעבר עמוד) plus:

- **טבלת פרטים** — label / value rows, one or two pairs per row.
- **טבלת תוצאות** — every step the item passed: עמדה, עובד, תאריך, תוצאה,
  הערות, and optionally the fields under each row.
- **פירוט לפי עמדה** — every station the item passed, in route order, each with a head (עמדה ·
  עובד · תאריך · תוצאה), a table of what it saved (the popup's components and the route's fields,
  with status and note), its comments and its photos from every source. Binds no step, so the
  general template uses it on every route.
- **שדות של עמדה** — one step's fields as שדה / ערך / סטטוס / הערה.
- **תמונות מעמדה** — the photos of a step's photo fields (or every step's).
- **בלוק חתימה** — one row; its "חותם" is one of:
  - **החותם בסגירת המארז** (`closing`) — a hand-drawn signature given at the kit's closing, before
    "סגור מארז" (below). It is printed but never locks the report;
  - **מאשר הדוח · חתימה סופית** (`final`) — a hand-drawn signature given on the item page once the
    route finished. It locks the report;
  - a step's worker — name / number / date, no drawn signature.

  The role's name ("בודק", "מאשר סופי") is a "טקסט חופשי" cell of the row. Every template has both
  signatures: the starters (`starter.ts`) begin with a "בודק" row (closing) and a "מאשר סופי" row
  (final), and migration `20261110130000_report_templates_both_signatures` added the closing row to
  every template that existed. A report has the signatures its template has blocks for, so removing
  a block in the editor removes that signature.

## Lifecycle — draft, signatures, freeze

```
in route ──────────────► every download = live DRAFT (watermark "טיוטה"), not stored
kit closing, template
has a closing signature ► the closing signature, given with the closing result (does not lock)
finished, template has
the final signature ────► still a draft, "ממתין לחתימה הסופית"; "חתימה סופית על הדוח" on the item page
finished (+ signed) ────► FINAL: rendered once, stored in MinIO, served byte-for-byte
```

- The final copy is rendered **when the item finishes** (after the last result
  is saved — `api/testing/results`, best-effort) or when it gets its final
  signature; if that failed, on the first download.
- Only the **final** signature holds the report back. A template with only a closing signature
  freezes at the finish — at the closing with the signature on it, or blank on a route that never
  passes a closing.
- Once final it never changes: template edits, renamed workers, new logos do not
  touch it (ticketflow's freeze; the record of what the item went through).
- **Reopen / retype**: the final copy and both signatures are valid only while
  `item_routes.finished_at` equals the `finished_at` they were given for. A
  reopened item is a draft again; when it finishes again a new final copy is
  frozen — and both signatures are needed again. No reopen path has to clean anything.
- A lost blob is rebuilt once from current data on download (as in ticketflow).

## Signing at the kit's closing

A closing popup template (תבניות חלון, role `closing`) may end with the system part
**חתימה על הדוחות** (`report_sign`, "הוסף חתימה על הדוחות" in the editor). It is a step of its own
and always the last one (lint `REPORT_SIGN_NOT_LAST`), so the finish button ("סגור מארז") is on it:
the signature comes **before** anything is saved (`TemplatePackageClosing.tsx`, `ReportSignStep.tsx`).

- It lists the arrived items whose report asks for the **closing signature**
  (`needsClosingSignature`, not given yet) and that the signed-in user may sign (`canSignClosing`),
  shows each report as it is now (`?html=1`; the closing's own row is added on save), and takes
  **one signature for all of them**.
- "סגור מארז" waits for it. Each of those items' closing result carries it (`POST
  /api/testing/results` `ReportSignature`, a PNG data URL); the server checks it — shape, and
  `REPORT_CLOSING_SIGN_ROLES` of the signed-in user — before saving anything (400 / 403), and once
  the result has finished the route records it in the same request (`signReportWithResult` →
  `signClosingSignature`; the answer's `reportSign`: `signed` / `nothing_to_sign` / `failed`). A
  refresh before "סגור מארז" saves nothing; after it, the box is closed with its reports signed.
- It does **not** lock the reports: those whose template has the final signature wait for it on the
  item page ("ממתין לחתימה הסופית"), and the done step says how many.
- The signer is the signed-in user. A signing that fails after the save (`failed`) leaves that
  report's closing spot blank; the done step names it.
- A user who may not sign (not `REPORT_CLOSING_SIGN_ROLES`) cannot close a box whose reports ask for
  the closing signature: "סגור מארז" stays blocked ("רק בודק או מנהל יכולים לחתום על הדוחות ולסגור
  את המארז").
- Nothing to sign (no report with a closing signature block) → the step says so and the box closes.
- Today's closing wizard (no template) and a template without the part are unchanged.

## The final signature

On the item page, "חתימה סופית על הדוח" (`POST /api/item-reports/<id>/sign`, `signItemReport`):
only `REPORT_FINAL_SIGN_ROLES`, once per finish — the one who signed at the closing may give it
too. It freezes the report with both signatures on it.

## Storage

Bucket `MINIO_BUCKET`, registered in `file_objects`:

| Object | Key | entity_type |
|---|---|---|
| Final report | `reports/items/<item_id>/v<n>.pdf` | `item_report` |
| Signature (closing or final) | `reports/items/<item_id>/signature-<uuid>.png` | `item_report_signature` |
| Uploaded logo | `reports/logos/<uuid>.<ext>` | `report_logo` |

## Roles

- Edit templates: `manager`, `tester` (as the station fields) — `REPORT_TEMPLATE_ROLES`.
- Sign at the kit's closing: `manager`, `tester` — `REPORT_CLOSING_SIGN_ROLES`.
- The final signature: `manager` — `REPORT_FINAL_SIGN_ROLES` (whoever signed at the closing too).
  (Both are one line in `src/app/lib/item-report/roles.ts`.)
- Download: any signed-in user.

## Tests

- `src/app/lib/item-report/__tests__/variables.test.ts` — pure: values, catalog,
  verdict, starter template (`npm test`).
- `src/app/lib/item-report/__tests__/item-report.integration.test.ts` — the whole
  flow through the real handlers: an item runs its route with station fields, the
  report freezes at the finish (also via research, also a kit item with kit-level
  fields), signature, roles, reopen, delete, lost blob, concurrent downloads,
  template edits after the freeze, preview, logos, escaping. MinIO is an
  in-process S3 stand-in; it needs a scratch database and a Chromium:

  ```
  TEST_DATABASE_URL=postgresql://…/scratch PUPPETEER_EXECUTABLE_PATH=/path/to/chrome \
    node --import tsx --test src/app/lib/item-report/__tests__/item-report.integration.test.ts
  ```

## Deploy

1. Run `scripts/prod-item-reports/1-item-reports.sql`, then `scripts/prod-report-general-template/1-report-general-template.sql`, then `scripts/prod-report-closing-signature/1-report-closing-signature.sql` and `2-report-templates-both-signatures.sql` (the first additive; the second adds the closing signature row to every report template — the old image keeps working with both).
2. Build the image — the Dockerfile now installs Chromium in the runner stage
   (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).
3. The new npm dependency `@measured/puck@0.20.2` must be in the offline npm cache
   (`docs/RUNBOOK_OFFLINE_BUILD.md`, `scripts/refresh-offline-cache.ps1`).
