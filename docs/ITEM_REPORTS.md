# דוחות PDF לפריטים — Item reports

Every item gets a PDF report at the end of its route, built from a **template
per route** and filled with the results of **every station the item passed**.
The engine is ported from ticketflow's ticket PDF (`ticketflow/src/lib/pdf`):
a Puck document edited in a WYSIWYG editor, rendered to HTML on the server and
printed to PDF by headless Chromium, stored in MinIO and frozen once final.

## Where things are

| What | Where |
|---|---|
| Edit a route's template | הגדרות מערכת → מסלולי בדיקה → לשונית **דוח PDF** |
| Download / sign an item's report | היסטוריית פריט (`/items/<id>/history`) — the buttons under the status |
| Template components (shared by editor + server) | `src/app/lib/item-report/puck-config.tsx` |
| Variables: catalog + values | `src/app/lib/item-report/variables.ts` (pure, unit-tested) |
| Route catalog (server) | `src/app/lib/item-report/catalog.ts` |
| Render + freeze + sign | `src/app/lib/item-report/generate.ts` |
| Chromium | `src/app/lib/item-report/render.ts`, `html.ts` (fonts inlined — air-gap safe) |
| Fonts | `src/app/lib/item-report/fonts.ts`, `public/fonts/` |
| Starter template | `src/app/lib/item-report/starter.ts` |
| Editor UI | `src/app/settings/testing-routes/components/report/` |
| APIs | `src/app/api/item-reports/` |
| DB | `report_templates`, `item_reports` (migration `20261020120000_item_reports`) |
| Production SQL | `scripts/prod-item-reports/1-item-reports.sql` |

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

A new template starts from `officialStarterTemplate()` (`starter.ts`): פרטי
הפריט, תוצאות הבדיקות, סיכום, אישור with the approver's signature.

## Template = one per route

A template belongs to a testing route (`testing_routes` row = item type + route
number); an item gets the template of the route it runs. On a kit, the tab lists
the routes of the kit's lines — the report is per **item**, the box gets none.

## Variables

| Variable | Value |
|---|---|
| `item.<key>` | the item: מספר פריט, סריאלי, מק"ט, דגם, יצרן, לקוח, משלוח, מארז, תאריכים, תוצאה כוללת |
| `step.<uid>.<attr>` | a station step: שם השלב, עמדה, עובד, מספר עובד, תאריך, שעה, תוצאה, ערך תוצאה, הערות |
| `field.<uid>.<fieldId>` | the value a worker filled in a station field (`.status` = תקין / לא תקין, `.note`) |
| `report.<key>` | תאריך ההפקה, החותם, תאריך החתימה |

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
- **שדות של עמדה** — one step's fields as שדה / ערך / סטטוס / הערה.
- **תמונות מעמדה** — the photos of a step's photo fields (or every step's).
- **בלוק חתימה** — bound to **מאשר הדוח** (a hand-drawn signature given on the
  item page once the route finished) or to a step's worker (name / number / date).

## Lifecycle — draft, signature, freeze

```
in route ──────────────► every download = live DRAFT (watermark "טיוטה"), not stored
finished, template has
"מאשר הדוח" signature ──► still a draft; "חתימה על הדוח" on the item page
finished (+ signed) ────► FINAL: rendered once, stored in MinIO, served byte-for-byte
```

- The final copy is rendered **when the item finishes** (after the last result
  is saved — `api/testing/results`, best-effort) or when it is signed; if that
  failed, on the first download.
- Once final it never changes: template edits, renamed workers, new logos do not
  touch it (ticketflow's freeze; the record of what the item went through).
- **Reopen / retype**: the final copy is valid only while
  `item_routes.finished_at` equals the `finished_at` it was frozen against. A
  reopened item is a draft again; when it finishes again a new final copy is
  frozen — and a new signature is needed. No reopen path has to clean anything.
- A lost blob is rebuilt once from current data on download (as in ticketflow).

## Storage

Bucket `MINIO_BUCKET`, registered in `file_objects`:

| Object | Key | entity_type |
|---|---|---|
| Final report | `reports/items/<item_id>/v<n>.pdf` | `item_report` |
| Signature | `reports/items/<item_id>/signature-<uuid>.png` | `item_report_signature` |
| Uploaded logo | `reports/logos/<uuid>.<ext>` | `report_logo` |

## Roles

- Edit templates: `manager`, `tester` (as the station fields) — `REPORT_TEMPLATE_ROLES`.
- Sign a report: `manager`, `tester` — `REPORT_SIGN_ROLES` (one line in
  `src/app/lib/item-report/roles.ts`).
- Download: any signed-in user.

## Deploy

1. Run `scripts/prod-item-reports/1-item-reports.sql` (additive; the old image keeps working).
2. Build the image — the Dockerfile now installs Chromium in the runner stage
   (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).
3. The new npm dependency `@measured/puck@0.20.2` must be in the offline npm cache
   (`docs/RUNBOOK_OFFLINE_BUILD.md`, `scripts/refresh-offline-cache.ps1`).
