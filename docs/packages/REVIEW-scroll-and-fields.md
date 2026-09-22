# Review handoff — internal scroll on /packages + the list-field contract

Branch `feat/package-model`. Work done in the session of 2026-09-17, written up 2026-09-22, and
**revised the same day after a review pass** (§0 lists what that pass changed).
**Everything below is uncommitted in the working tree.** The review pass also touched the
production upgrade kit (one auxiliary table gained a column; the builder was rerun and the operator
copies refreshed) — see §7. Nothing touches Prisma or the schema migration.

Two fixes, both "put the new package screens back to how the rest of the system already
behaves", not new features:

1. `/packages` is a fixed-height screen that never scrolls the page.
2. Every field that shows a list of options is the shared `SearchableCombobox`.

---

## 0. What the review pass changed (2026-09-22)

The first write-up of this work was reviewed against the code; every finding was acted on. The
result was then reviewed a second time by four independent reviewers (primitive and consumers;
layout and dialogs; server routes and scripts; tests and docs) and their findings were folded into
the rows below and re-verified. In review order:

| Finding | What was done |
|---|---|
| The popup flip rule compared free space to a fixed 280px, so short lists flipped upward for no reason on every screen | The primitive now flips only when the room below is smaller than what the list **actually needs** (its rendered height, capped at 264px, plus gap and edge) and there is more room above. Measured twice on open (before and right after the list mounts, both before paint). |
| Enter selected by finding the row in the DOM and clicking it; the wrapper kept its own copy of the text and highlight, and silently overrode a consumer's `inputValue` / `onInputChange` | Keyboard, highlight and the text reset on close moved **into the primitive** (`Autocomplete.tsx`), so every consumer gets them and the wrapper no longer controls the text. Consumer props pass straight through again. |
| Dense CSS keyed on lucide's generated class names, with a caret range on the package | The primitive's × and arrow carry their own classes, `sh-ac-clear` / `sh-ac-arrow`; the stylesheet uses those. |
| Raw hex colours in the dense styles and the page layout, where the rest of the stylesheet uses tokens | Two tokens added (`--color-primary-tint`, `--color-ink-muted-40`); the layout uses `--color-canvas-parchment` / `--color-hairline`. |
| The page injected a global `<style>` block from the component | The layout lives in `src/app/packages/packages.css`, imported by the page. Class names are unchanged (the suite queries them). |
| The stat cards vanished under 720px of viewport height, which is every 1366×768 laptop | They collapse to one compact strip instead (`.pkg-stat*` classes; the numbers stay visible). |
| Under 1100px the table header stopped sticking | The card's boxes are no longer scroll containers there (`overflow: clip` / `visible`), so the header sticks to the split, which is the scroller. The horizontal bar moves to the split. A second review pass then moved the breakpoint onto the page's own width (container query, 1040px) because the rail made a 1280px window scroll the table sideways inside the card, and released the fixed frame on phones (< 640px), where the fixed rows alone could exceed the screen. |
| The package dialogs' overlays (z 70–90) sat under the top bar (1100) and the rail (1200) | One constant, `DIALOG_Z = 1250` in `packageUi.ts`; every package dialog and wizard is placed relative to it, below the design-system dialogs (1300) and the poppers (1400+). The labels dialog takes a `zIndex` prop: the intake dialog (whose overlay stays mounted) and the wizard pass a value above their own, which also fixed a pre-existing bug where labels printed right after intake sat behind the intake overlay. |
| A failed photo upload left "המשך" enabled (silent loss) | A failed shot now blocks the step in both wizard photo steps and at the regular photo station, and the button says to remove it. The wizard's step rail no longer jumps forward past an incomplete step, and `finish()` refuses while any shot is failed or still uploading. |
| Old barcodes stop scanning after the production upgrade; no bulk reprint | `locate-by-barcode` resolves a pre-upgrade id through `legacy_id_map` and says so; the testing screen shows a notice; `/packages` gains "מדבקות למארזים שהוסבו" (a bulk print; after the print dialog closes the operator confirms, and only then are the boxes marked relabeled through `POST /api/packages/converted` — a browser cannot tell a printed job from a cancelled dialog). The upgrade's `legacy_id_map` gained `relabeled_at` (added idempotently) and an index (builder rerun); the API tolerates a map without the column. |
| The integration suite was permanently red on one §2.8 test | The by-station p95 queue age now ships its work-clock twin (`_new_p95QueueAgeWorkMinutes`). |
| The browser suites hard-coded dev-config ids | `resolveConfig(page)` in `lib.mjs` resolves them by name after login; env overrides documented in the README. Suites 04 and 06 never existed — noted there. |
| The backup script only listed the dump's table of contents | It now restores the dump into `<db>_restorecheck`, compares row counts (taken before the dump), and drops it (`-SkipRestoreCheck` to skip). |
| `legacy_id_map` is outside Prisma's model | Added to the guard list in `scripts/check-migration-safety.js` and to `docs/PRISMA_UNMANAGED_OBJECTS.md`. |

---

## 1. Internal scroll on /packages

**The bug.** The whole page scrolled: heading, the 4 stat cards, the filter row and the legend
left the screen together with the table. Every other screen (items, shipments, tests) keeps its
frame fixed and scrolls only the table body.

**The one thing to understand before reviewing.** The handed-over spec asked for a page wrapper
with `height:100vh; overflow:hidden; padding-inline-start:240px; padding-top:56px`. That is the
artboard's description of the frame. In the real app `AppShell`
([src/app/components/AppShell.tsx](../../src/app/components/AppShell.tsx)) already owns all of
it: its content box is `margin-inline-start: <rail width>; margin-top: 56px;
height: calc(100vh - 56px); overflow-y: auto`, and the rail width is dynamic (240 expanded,
56 collapsed, 0 under 980px). Re-applying the padding would have double-offset the page, and a
hard `100vh` would have overflowed it by 56px. So the page fills the shell box with
`height:100%; overflow:hidden` instead. The effect the spec asked for holds: the document never
scrolls, and neither does the shell box — verified at six viewport sizes.

**Structure** ([src/app/packages/page.tsx](../../src/app/packages/page.tsx)), CSS in
[src/app/packages/packages.css](../../src/app/packages/packages.css):

```
.pkg-page          height:100%; overflow:hidden; display:flex; flex-direction:column
  header           .pkg-fixed  → flex-shrink:0
  .pkg-stats       flex-shrink:0; grid of .pkg-stat cards (value / label classes)
  filters+legend   .pkg-fixed  → flex-shrink:0
  .pkg-split       flex:1; min-height:0            ← absorbs the height
    .pkg-table-wrap   flex:1; min-height:0; display:flex; column; overflow:hidden; radius 16
      .pkg-table-scroll  flex:1; min-height:0; overflow:auto; overscroll-behavior:contain
        table            min-width:680px; thead tr sticky top:0; th box-shadow 0 1px 0 hairline
    .pkg-panel        width:340px; flex-shrink:0; min-height:0; overflow-y:auto
```

`min-height:0` on the split, the table card and the panel is what stops the scroll leaking back
to the page. The rule under the sticky header row is a `box-shadow`, not a border, because a
collapsed border scrolls away from a sticky row.

**The trap worth knowing (it bit once).** Inline styles beat stylesheet rules, so any property a
media query needs to change cannot stay inline. The first test run caught the stats still showing
at 700px tall: `display:grid` was inline and the media query could never win. That is why the
layout — and now the stat cards' own styles — live in `packages.css`, and why nothing on this page
that a breakpoint has to override may be written inline.

**Responsive** — `overflow:hidden` on the wrapper is never released:

- `max-height:720px` → the stat cards collapse to one compact strip (value and label on a line,
  smaller type). The numbers never disappear; a 1366×768 laptop leaves about 660px and would
  otherwise never show them.
- **Page narrower than 1040px** (a container query on `.pkg-page`, not a viewport query: beside
  the 240px rail a 1280px window leaves the page under 1000px, and table 680 + panel 340 + gap need
  1036 side by side) → the panel drops under the table and `.pkg-split` becomes the scroller (so
  the heading and filters still stay put). The card's boxes stop being scroll containers there
  (`.pkg-table-wrap { overflow: clip }`, `.pkg-table-scroll { overflow: visible }`), which keeps
  the header row sticky against the split. The card gets the same 680px minimum as the table, so
  on narrow screens the horizontal bar is on the split — the only scroller there. Intended.
- **Viewport narrower than 640px** (phones) → the fixed-frame contract is released: header, stats
  and filters alone can be taller than the screen there, which would leave the list no height at
  all, so the page scrolls in the shell like every other narrow screen.

**Other changes on the page:** the side panel is no longer `position:sticky`, and the inner
`maxHeight:300` list inside it is gone so the panel itself is the single scroller there.

**`/packages/[id]`** ([src/app/packages/[id]/page.tsx](../../src/app/packages/%5Bid%5D/page.tsx)):
same principle, simpler — the page's own wrapper is `height:100%; overflow-y:auto`, so it scrolls
its content inside the fixed frame rather than scrolling the shell box. Note the inner content
div was not re-indented, to keep the diff readable.

---

## 2. The list-field contract

**The bug.** In the package screens, fields that looked like dropdowns were flat `div`s (or
native `<select>`s) with a drawn `ChevronDown`: no search, no keyboard, no clear button. Two
fields in one dialog looked and behaved differently.

### What was actually found, and the decision

The instruction was "use the existing `SearchableCombobox`, don't build, don't wrap, don't copy
styles, and don't change `Autocomplete.tsx`". Measured against the contract in the running app,
**the existing component did not meet it**: 47.5px/17px instead of 44px/14.5px, ArrowDown/ArrowUp
and Enter did nothing, a partial search survived Esc and outside clicks, and there was no locked
mode. So the contract could not be met by swapping alone.

The user was asked and chose a **split**:

- **Behaviour → global**, so every screen gets it (these are bugs against the component's own
  contract). After the review pass the behaviour lives in the primitive itself,
  [src/components/ui/Autocomplete.tsx](../../src/components/ui/Autocomplete.tsx), which
  `SearchableCombobox` is the only consumer of.
- **Design metrics → opt-in**, a `dense` prop used only by the package screens, so the other
  call sites keep their current size and stay aligned with the TextFields next to them.

Changing `Autocomplete.tsx` was approved explicitly, twice: first for three constants, then for
the review pass (the flip rule, keyboard, text reset, disabled adornments, icon classes).

### Behaviour now in the primitive (every consumer)

- **The text snaps back when the list closes** — Esc, Tab, outside click — to the selected
  option's label (or empty), so a half-typed search never survives. It also follows a value
  changed from outside while closed. `freeSolo` keeps its text. The reason reported to
  `onInputChange` is `"reset"`.
- **ArrowDown/ArrowUp** move a highlight, **Enter** selects it, Escape closes. The highlight is
  `data-highlighted` on the row (the existing `.sh-select-item[data-highlighted]` rule) and
  `highlighted` in `renderOption`'s state; hover sets the same state. With nothing highlighted
  yet, the arrows step from the selected row, so it keeps its tint until the cursor reaches it.
  Typing highlights the first match. The highlighted row is kept in view.
- **Disabled is inert**: the × is not rendered and the arrow does nothing. This was a real
  pre-existing bug: a disabled combobox could be opened and its value changed from the arrow —
  reachable in `ShipmentInsertPopup` (`disabled={scanned}`) and `ShipmentUpdatePopup`.
- **The × and arrow have stable class names**, `sh-ac-clear` and `sh-ac-arrow`. No stylesheet
  depends on lucide's generated names any more.
- **Flip rule** (see §0): height-aware, two-pass measure, `MENU_MAX_H` 264 / `GAP` 6 / `EDGE` 8.

### What `SearchableCombobox` adds

[src/app/components/common/SearchableCombobox.tsx](../../src/app/components/common/SearchableCombobox.tsx)
is thin again: the above-field / floating label, `startIcon`, `getOptionSubtitle` (a second line
that typing also matches, unless the consumer brings its own `filterOptions`), `locked` (a
read-only input, grey field, a lock where the arrow was, no ×, never opens — the primitive's
handlers are simply not attached), and `dense`. It no longer holds text, highlight or keyboard
state, and a consumer's `inputValue` / `onInputChange` pass through untouched.

### Dense (package screens only)

`dense` + `denseHeight` (44 default, 38/34 for table rows). All styles are in
[src/components/ui/ui.css](../../src/components/ui/ui.css) under `.sh-combo--*`, never at the call
sites: 44px, radius 8, 14.5px text, padding 13/66, × pinned at `inset-inline-end:38px`, arrow at
`12px`, compact option rows, a `--color-primary-tint` selected row with a 15px blue check,
`--color-ink-muted-40` subtitles and empty state.

Two implementation details a reviewer should look at:

- The panel's radius/padding are applied with **`:has()`** (`.sh-select-content:has(> .sh-combo-option)`)
  because the `<ul>` is created inside `Autocomplete.tsx` and carries no per-instance class.
- Icons must be sized with the `fontSize` **prop**, not `sx={{fontSize}}` — the icon wrapper sets
  the SVG's `size` from the prop and only passes `sx` through to CSS, so `sx` leaves a 24px icon.
  This was caught in review of a screenshot, not by the numbers.

### Blast radius

`SearchableCombobox` is used 28 times in 16 files outside the package screens (dashboard
filters, shipments popups, settings, the testing dock, the worker picker, the items toolbar), plus
the package screens. Everything under "Behaviour now in the primitive" applies to all of them.

### Where the fields were replaced

| Screen | Field(s) |
|---|---|
| `/packages` filters | customer, shipment, package type, status (`FilterSelect`) |
| Intake — step 1 | shipment (with the customer as subtitle) |
| Intake — step 2 | package route; package type (locked) |
| Intake — step 3 | per-row item type (38px), per-row route (34px) |
| Edit package | the 4 locked fields (type, route, customer, shipment) + add-item type |
| Labels dialog | printer, label size |
| `/settings/packages` | item type in the contents editor rows (38px) |
| Opening wizard | add-item type (`PackageOpenWizard`) |

The last two rows were **not** in the original list; a sweep of the branch found them. A final
sweep leaves no `<select>` and no drawn arrow in the package code — the only `ChevronDown` left
in `/settings/packages` is the move-row-down button, which is not a field.

Small deliberate side effects: the text inputs in the two add-item forms went 40px → 44px so they
line up with the type field; printer and label size have one option each (the browser's print
dialog picks the real printer and the print CSS is 57×32mm), and when cleared their placeholder
still names what will print.

---

## 3. Verification

- `npx tsc --noEmit`: clean apart from the two pre-existing errors in generated `.next`
  validator files. `npx eslint` clean on every changed file.
- Integration suites (`npm test`, `TEST_DATABASE_URL` → `testingsite_metrics_test`):
  see the table below.
- Browser suite [scripts/e2e-packages/08-scroll-fields.mjs](../../scripts/e2e-packages/08-scroll-fields.mjs)
  (in that folder's README table), against the image rebuilt from this working tree:
  see the table below.

| Check (2026-09-22, image rebuilt from this working tree after the second review round) | Result |
|---|---|
| `npm test`, 8 suites | 144 / 144 |
| `08-scroll-fields` | 60 / 60 (one click in the test made exact: the panel’s מדבקות button, not the new header button that contains the word; the narrow branch now runs at 1280×640 too, because beside the rail the page is under 1040px there) |
| `01-smoke`, `07-hydration` | 22 / 22, 9 / 9 |
| `02-flow`, `05-rules`, `03-wizards-ui` | 30 / 30, 30 / 30, 37 / 37, with the ids resolved by name |
| Ad-hoc script on the same harness | converted-packages API, old-barcode fallback, unknown id still a plain 404, POST validation, both p95 clocks on by-station: 7 / 7 |

```
E2E_CREDS_FILE=<path to kc-test-user.json>  node scripts/e2e-packages/08-scroll-fields.mjs
# or leave .e2e-user.json beside the scripts (see scripts/e2e-packages/README.md)
```

Suite 08 creates packages until there are 50, plus one with 8 items, so the scroll cases are
real. It covers: document/shell never scrolling at 1440×900, 1440×700, 1280×640, 1000×900,
1000×650 and 700×800; the heading and filters not moving while the table or the content area
scrolls; the sticky header and its rule (wide and narrow); the stats collapsing under 720px; the
panel below the table under 1100px; the horizontal bar at 700px; the 8-item panel scrolling on its
own; `/packages/[id]` scrolling its wrapper; and for the fields: geometry to the pixel, typing
filter, ArrowDown/Up + Enter, Esc and outside-click revert, × clearing, locked fields not
opening, the panel's 6px gap / 264px cap / radius 10 / padding 5, the bottom field opening
upward, the list staying glued while a dialog scrolls, the settings row field opening over the
following rows, and that `/settings/testing-routes` still measures 17px (i.e. dense did not leak)
while gaining the keyboard.

**Test environment** (the dev machine; the specifics are in [SESSION_SUMMARY.md](SESSION_SUMMARY.md)
§6): image `testingsite-next-app:packages` built from the working tree, compose project
`testingsite` with the override that points `DATABASE_URL` at **`testingsite_pkgtest`** and sets a
browser-reachable `MINIO_PUBLIC_ENDPOINT`; the Keycloak test user from `kc-test-user.mjs`. The
live `testingsite` database is untouched and still old-schema.
`testingsite_pkgtest` had the upgrade applied with the dev config; on 2026-09-22 its
`legacy_id_map` was given the new `relabeled_at` column and index by hand (the same DDL the
rebuilt one-shot now creates) so the relabel path could be exercised there.

---

## 4. What to look at first

- [Autocomplete.tsx](../../src/components/ui/Autocomplete.tsx): the two-pass measure
  (`measure`, the `listMounted` layout effect), the close-time text reset (`reason: "reset"`),
  and `moveHighlight`. These now run for every combobox in the system.
- The `renderOption` contract grew (`highlighted` in state, `data-highlighted` in props). The
  wrapper is the only consumer; anything else that renders its own rows must spread the props.
- The narrow-viewport CSS in `packages.css` (`overflow: clip` / `visible`) — it is what keeps the
  header sticky under 1100px, and it is the least obvious rule on the page.
- `DIALOG_Z` and the ±10 offsets in the six dialog files: the relative order between the package
  dialogs is unchanged; only the base moved above the chrome.
- `locate-by-barcode`: the handler was split into `locate()` + the legacy fallback. The fallback
  runs only on a plain not-found, never on "no station" or "finished".

## 5. Known, not fixed

- The `/packages` search input is 42px with radius 10 next to the 44px/radius-8 filters, and the
  "copies" stepper in the labels dialog is radius 10 next to the two comboboxes. Both are text
  inputs, not list fields, so they were left as designed.
- **Open decision 3 in [SESSION_SUMMARY.md](SESSION_SUMMARY.md) §7** (a separate `/packages`
  page vs. packages inside the items page) must be closed before this work merges: the
  fixed-height layout, its stylesheet and suite 08 all assume the separate page.

## 6. Commits

The owner's two commits on this branch titled "5454" and "85454" should be reworded before a
pull request; and because phases 1/3a/3c import `@/lib/api/direct-upload`, which `a38dc93`
added, the branch does not build at any commit before it.

## 7. Production DB migration — paths for review

Listed so the reviewer has the whole branch in view; see [PLAN.md](PLAN.md) §8 for the narrative
and the 2026-09-17 production findings (110 KVM items in one shipment, none tested, 6 awaiting
research, 3 with files — all convertible). **The review pass changed one thing here:** the
`legacy_id_map` DDL in `build-upgrade.mjs` gained `relabeled_at timestamptz` and an index on
`legacy_id`; `2-upgrade-to-packages.sql` was regenerated (same migration checksum) and the
operator's copies outside the repo refreshed together with the backup script (where they live is
machine-local: SESSION_SUMMARY §6).

| Path | What it is |
|---|---|
| [prisma/migrations/20260915120000_package_model/migration.sql](../../prisma/migrations/20260915120000_package_model/migration.sql) | The schema migration itself (Prisma). |
| [scripts/diagnose-legacy-for-packages.sql](../../scripts/diagnose-legacy-for-packages.sql) | Step 01 — read-only diagnosis of the legacy data. |
| [scripts/prod-package-model/02-migrate-production.sql](../../scripts/prod-package-model/02-migrate-production.sql) | Step 02 — the migration verbatim in one transaction, plus the `_prisma_migrations` row (sha256) so `migrate deploy` skips it. |
| [scripts/prod-package-model/03-fix-production.sql](../../scripts/prod-package-model/03-fix-production.sql) | Step 03 — data fix driven by a `CONFIG` block: orphan routes, status 6, `package_level` flags, package types/contents/routes, item route fix-ups, shipment declarations, and the legacy-group conversion (new 16-digit ids, ledger re-recorded, files and research rows re-pointed). Ends in `ROLLBACK;` — a dry run with a report — until switched to `COMMIT;`. `cfg_strict` is **false** here (report everything). |
| [scripts/prod-package-model/2-upgrade-to-packages.sql](../../scripts/prod-package-model/2-upgrade-to-packages.sql) | The operator-facing one-shot: a single `DO` block built from the migration + `03`, atomic, so nobody handles BEGIN/COMMIT by hand. Persists the id mapping in `legacy_id_map` (with `relabeled_at`). Refuses to run twice. `cfg_strict` is **forced to true** by the builder. |
| [scripts/prod-package-model/1-backup-before-packages.ps1](../../scripts/prod-package-model/1-backup-before-packages.ps1) | Backup first: `pg_dump -Fc` out of the postgres container, copied out with `docker cp`, verified, then **restored into a scratch database and compared** before the scratch is dropped. |
| [scripts/prod-package-model/build-upgrade.mjs](../../scripts/prod-package-model/build-upgrade.mjs) | Builds `2-upgrade-to-packages.sql` from the other two — regenerate rather than hand-editing the big file. |

Order on production: stop the app → `1-backup-before-packages.ps1` → `2-upgrade-to-packages.sql`
(or 01/02/03 by hand for a dry run first) → start the new app version → from `/packages`, print
the new labels for the converted boxes ("מדבקות למארזים שהוסבו"); until then the old labels still
scan.
