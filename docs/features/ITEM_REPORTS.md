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
| Download an item's report / give its final signature / a missing closing signature / an external approval of a failed one | היסטוריית פריט (`/items/<id>/history`) — the buttons under the status (`ItemReportControl.tsx`) |
| A kit's combined report (every item's report in one PDF) | עמוד מארז (`/packages/<id>`) — "דוח מאוחד"; `GET /api/packages/<id>/report` (`getPackageReport` → `renderCombinedPdf`) |
| Sign a kit's reports at its closing (the closing signature) | the closing template's "חתימה על הדוחות" step (`report_sign`) — see below |
| Template components (shared by editor + server) | `src/app/lib/item-report/puck-config.tsx` (the print renders); the page, the document settings and what prints on every page: `document.ts` |
| Variables: catalog + values | `src/app/lib/item-report/variables.ts` (pure, unit-tested) |
| Route catalog (server) | `src/app/lib/item-report/catalog.ts` |
| What a report is built from (DB) | `src/app/lib/item-report/source.ts` |
| Build the HTML / PDF | `src/app/lib/item-report/build.ts` |
| State, freeze, sign | `src/app/lib/item-report/lifecycle.ts`; the status the clients read: `contract.ts` |
| Chromium | `src/app/lib/item-report/render.ts`, `html.ts` (fonts inlined — air-gap safe) |
| Photos in the PDF | `src/app/lib/item-report/photos.ts` — each photo over 300 KB goes into the report as a JPEG of at most 1600 px on its longer side (`PDF_PHOTO_MAX_PX`, made small by Chromium; EXIF orientation kept), kept in memory between renders by etag. The photo in MinIO is never changed |
| Fonts | `src/app/lib/item-report/fonts.ts`, `public/fonts/` |
| Starter / general template | `src/app/lib/item-report/starter.ts` (`officialStarterTemplate`, `generalStarterTemplate`) |
| Editor UI | `src/app/components/item-report/` (mounted by the routes screen's `RouteReportTab`) |
| APIs | `src/app/api/item-reports/` |
| DB | `report_templates`, `item_reports` (migration `20261020120000_item_reports`); `report_general_template` (`20261104120000_report_general_template`); `item_reports.closing_*` (`20261110120000_report_closing_signature`); both signatures in every template (`20261110130000_report_templates_both_signatures`); the closing signer's role (`20261119120000_report_closing_signer_role`); the external approval (`item_reports.external_*` + the "גורם חיצוני" row in every template, `20261126140000_report_external_approval`) |
| Production SQL | `db/upgrades/2026-10-19-item-reports/1-item-reports.sql`, `db/upgrades/2026-11-05-report-general-template/1-report-general-template.sql`, `db/upgrades/2026-11-10-report-closing-signature/1-report-closing-signature.sql` + `2-report-templates-both-signatures.sql`, `db/upgrades/2026-11-19-report-closing-role/1-report-closing-role.sql`, `db/upgrades/2026-11-26-report-external-approval/1-report-external-approval.sql` |

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
  - **גורם חיצוני · מאשר דוח לא תקין** (`external`) — an external approver's signature (below). Its
    row prints only on a report they approved, and there the final row does not;
  - a step's worker — name / number / date, no drawn signature.

  The closing row's role is a **"תפקיד החותם"** cell (`kind: "role"`): the signer's role when they
  signed — "בודק" for a tester, "מנהל" for a manager (also one who is a tester too;
  `signerRoleLabel` in `http.ts`), kept in `item_reports.closing_signed_by_role` and in
  `report.closing_signer_role`. It is empty until someone signs; a closing signature given before
  roles were kept prints the cell's own text ("בודק"). The final row's role stays a "טקסט חופשי"
  cell ("מאשר סופי"). Migration `20261119120000_report_closing_signer_role` turned every closing
  row's "בודק" text cell into a role cell (a cell an author wrote other text in was left). Every template has both
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
  `ACCESS.reportClosingSign` of the signed-in user — before saving anything (400 / 403), and once
  the result has finished the route records it in the same request (`signReportWithResult` →
  `signClosingSignature`; the answer's `reportSign`: `signed` / `nothing_to_sign` / `failed`). A
  refresh before "סגור מארז" saves nothing; after it, the box is closed with its reports signed.
- It does **not** lock the reports: those whose template has the final signature wait for it on the
  item page ("ממתין לחתימה הסופית"), and the done step says how many.
- The signer is the signed-in user. A signing that fails after the save (`failed`) leaves that
  report's closing spot blank; the done step names it.
- A user who may not sign (not `ACCESS.reportClosingSign`) cannot close a box whose reports ask for
  the closing signature: "סגור מארז" stays blocked ("רק בודק או מנהל יכולים לחתום על הדוחות ולסגור
  את המארז").
- Nothing to sign (no report with a closing signature block) → the step says so and the box closes.
- Today's closing wizard (no template) and a template without the part are unchanged.

### A closing signature given later, on the item page

A finished item whose report waits for the final signature and was never signed at a closing (its
box closed before the template had the block, or the closing had no "חתימה על הדוחות") shows
"חסרה חתימה בסגירה" and a **"חתימה בסגירה"** button on the item page
(`POST /api/item-reports/<id>/sign-closing`, the same `signClosingSignature`):

- `ACCESS.reportClosingSign` (`canSignClosing` in `/status`), once per finish; it does not lock.
- It prints the signer and the day it is given, not the closing's date.
- Only before the lock: the final signature freezes the report, and after that the closing spot stays
  blank (409 `ALREADY_FINAL`). So the final signature's dialog warns while the closing one is
  missing ("לנעול בלי חתימת בודק") — a warning, not a block.
- A report frozen before the update is not touched; reopening the item is the only way to sign it again.

## The final signature

The packages list (`/packages`) has a tab for the closed boxes whose items wait for it —
"הושלמו · ממתינים לחתימת מאשר": `PackageView.awaiting_final_signature` counts the box's items in
the state `awaiting_signature` (`itemsAwaitingFinalSignature` in `lifecycle.ts`, the same `stateOf`
rule as the item page, in a few queries for every closed box). A closed box with none is "ממתינים
ליציאה". A box one of whose waiting reports came out "לא תקין" is in "הושלמו · ממתינים לאישור גורם
חיצוני" instead (`PackageView.awaiting_external_approval`, `itemsWithFailedResults` in `lifecycle.ts` —
the same rule as the item page's button); its row's note counts both kinds.

On the item page, "חתימה סופית על הדוח" (`POST /api/item-reports/<id>/sign`, `signItemReport`):
only `ACCESS.reportFinalSign`, once per finish — the one who signed at the closing may give it
too. It freezes the report with both signatures on it.

## An external approval of a failed report — אישור גורם חיצוני

A finished item whose report came out **"לא תקין"** may be passed by someone outside the system who
examined it (a manufacturer's representative, an outside lab…). A manager shows them the report and
they sign on the manager's screen: "אישור גורם חיצוני" on the item page, beside "חתימה סופית על הדוח"
(`ExternalApprovalDialog` in `ItemReportControl.tsx`; `POST /api/item-reports/<id>/approve-external`,
`approveExternal` in `lifecycle.ts`).

- **Who / when**: `ACCESS.reportFinalSign` (a manager — the same people as the final signature), while
  the report waits for the final signature and its overall verdict is "לא תקין"
  (`ReportStatus.failed`, read only in that state; `externalApprovalOpen` in `contract.ts`). A template
  without the final signature is frozen at the finish, so it has no such moment and no button. A
  template that asks for the closing signature needs it **first** (409 `CLOSING_MISSING`,
  `closingBlocksExternalApproval`): the approval locks the report, and the closing spot would stay
  blank. The item page shows the button disabled with "יש לחתום עליה לפני אישור הגורם החיצוני" until
  then. On the failed report "חתימה סופית על הדוח" does not show — the approval takes its place.
  A report an external approval already locked **without** the closing signature (approved before
  this rule, or before the template had the row) still offers "חתימה בסגירה" on the item page
  (`closingMissingAfterExternal`): the signature is added and the report frozen again (a new version)
  with both. A report the final signature locked stays as it was (409 `ALREADY_FINAL`).
- **What they write**: their name and a drawn signature (required); their role / body and a reason
  (optional). The signed-in manager is kept as the one who showed them the report.
- **It overwrites the failure**, in one transaction: the latest row of every failed step
  (`failedStepRows` in `variables.ts`) gets `passed = true` and `details.verdict.ok = "pass"` — so the
  item's history and the metrics count it as passed — and `details.external_approval` keeps who
  approved, when, the manager, and the verdict the row had before (`previous`). The measured values
  in the row's fields are not changed.
- **It stands for the final signature**: kept on `item_reports.external_*` for the finish it was given
  for (as the other signatures), the report is frozen with it, and the final signature is refused after
  it (409 `ALREADY_SIGNED`). The packages list no longer counts the item as waiting for the approver.
- **In the PDF**: the overall verdict prints "תקין (אושר ע״י גורם חיצוני)"; every step it passed prints
  "✓ תקין *" — and so do the fields that failed in it (the value as measured) — with the footnote
  "* נמצא לא תקין בבדיקה, ואושר כתקין ע״י גורם חיצוני." under the results table, the station details
  and a step's fields table; the **"גורם חיצוני"** signature row (bind `external`: role cell "גורם
  חיצוני" with their role / body under it, name, date, signature) with their reason and the manager's
  name under it; the "מאשר סופי" row does not print. `report.external_signer`,
  `report.external_signer_role` and `report.external_signed_at` print the same in text.
- **Templates**: the starters end with the external row after the final one, and migration
  `20261126140000_report_external_approval` added it after the final row of every template that has one.
  It prints nothing on a report nobody approved, so a template keeps one row for both cases.
- **Reopen**: as the other signatures, the approval counts only for the finish it was given for. The
  passed rows stay passed (they are the record); a step run again after the reopen prints its new row.

## A kit's combined report — דוח מאוחד למארז

"דוח מאוחד" on the kit's page downloads the report of every item in the box, in the box's order
(`package_seq`), in ONE PDF (`getPackageReport` in `lifecycle.ts`, `renderCombinedPdf` in `build.ts`):

- Each item's part is built by the same `buildReportBody` as its own report — its template, values,
  photos and valid signatures. A final report prints without a mark, a draft with "טיוטה" — on its
  own first page only (a fixed mark would repeat on every page of the file, the final ones too).
- Each item starts on a new page; one Chromium render, no extra library. The page settings
  (margins, footer, page numbers) are the first report's; page numbers run through the whole file;
  the classification is the strictest of the items'.
- Items whose route has no report are left out; none at all → 204.
- Rendered live on every download and **never stored**. A finished item's frozen copy stays its
  record: the combined report re-renders it from today's data (a template edited after the freeze
  shows here, not in the item's own PDF).

## Storage

Bucket `MINIO_BUCKET`, registered in `file_objects` (the keys: `ReportKeys` in `src/lib/storage/keys.ts`):

| Object | Key | entity_type |
|---|---|---|
| Final report | `reports/items/<item_id>/v<n>.pdf` | `item_report` |
| Signature (closing or final) | `reports/items/<item_id>/signature-<uuid>.png` | `item_report_signature` |
| Uploaded logo | `reports/logos/<uuid>.<ext>` | `report_logo` |

## Roles

- Edit templates: `manager`, `tester` (as the station fields) — `ACCESS.reportTemplate`.
- Sign at the kit's closing: `manager`, `tester` — `ACCESS.reportClosingSign`.
- The final signature: `manager` — `ACCESS.reportFinalSign` (whoever signed at the closing too).
- Show a failed report to an external approver (`approve-external`): the same `ACCESS.reportFinalSign`.
  (All in `src/lib/auth/roles.ts`.)
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

1. Run `db/upgrades/2026-10-19-item-reports/1-item-reports.sql`, then `db/upgrades/2026-11-05-report-general-template/1-report-general-template.sql`, then `db/upgrades/2026-11-10-report-closing-signature/1-report-closing-signature.sql` and `2-report-templates-both-signatures.sql` (the first additive; the second adds the closing signature row to every report template — the old image keeps working with both). Then, right before the new image, `db/upgrades/2026-11-19-report-closing-role/1-report-closing-role.sql` (a column + the closing row's role cell; the old image prints that cell empty until the new one is up). Then, also right before the new image, `db/upgrades/2026-11-26-report-external-approval/1-report-external-approval.sql` (the `external_*` columns + the "גורם חיצוני" row after the final row of every template; the old image prints that row as an empty signature row until the new one is up).
2. Build the image — the Dockerfile now installs Chromium in the runner stage
   (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).
3. The new npm dependency `@measured/puck@0.20.2` must be in the offline npm cache
   (`docs/runbooks/RUNBOOK_OFFLINE_BUILD.md`, `scripts/release/refresh-offline-cache.ps1`).
