# Handoff: Settings pages — restyle to match the Items & Shipments pages

## Overview
Restyle every page under **`/settings/*`** ("הגדרות מערכת") so it uses the exact
same visual language as the already-redesigned **Items** ("ניהול פריטים") and
**Shipments** ("משלוחים נכנסים") pages — the calm Shifthouse / Apple system.

This is a **visual alignment only**. No routes, data, API calls, CRUD logic, or
validation change. The settings pages keep doing exactly what they do today —
they just look like they belong to the same product as Items and Shipments.

The settings section is not one page but a family that all share the sub-nav:
- **Simple CRUD pages** (one entity, one table): customers, item-types, sources,
  item-status, test-station-status, workers, reference-items.
- **Master–detail page**: test-stations (station → sub-stations) + the testing
  routes editor.

Both get the same treatment; the CRUD pages are the common case.

## About the design files
The `reference/*.dc.html` files are **design references authored in HTML** (Design
Component prototypes) that show the intended final look — they are **not production
code to ship**. Recreate their look in the existing **Next.js + React + MUI**
codebase, reusing the primitives the Items/Shipments pages already use.

- `reference/Settings.dc.html` — **the target.** Shows the redesigned settings:
  the header row, the table card, the master–detail stations screen, the route
  editor, and all modals (add/edit, delete confirm, station, sub-station).
- `reference/Items-reference.dc.html` — the Items page, **visual source of truth**.
- `reference/Shipments.dc.html` — the Shipments page (already aligned to Items).
- `reference/Reference Item Settings.dc.html` — the "פריטי ייחוס" settings page
  (a richer settings screen already on-system), for reference.
- `reference/TopNav.dc.html`, `reference/support.js` — needed to open the prototypes
  in a browser.

Open `reference/Settings.dc.html` in a browser and click the sub-nav tabs to see
every state. **The real app already renders the sidebar/top nav via `AppShell`** —
the `TopNav` inside the prototype is only there to make the standalone file look
complete. Do not rebuild nav from the prototype.

## Fidelity
**High-fidelity.** Colors, type, spacing, and radii are final — match them exactly.

## The core idea: reuse the shared primitives, don't re-invent
The Items and Shipments pages get their look from three shared, already-built,
already-on-system pieces. The settings redesign is largely a matter of routing the
settings pages through the **same** three:

1. **`src/components/DataTable.tsx`** — THE app table. Flat white card
   (`border:1px solid #e0e0e0; border-radius:16px; box-shadow:none`), parchment
   header (`#f5f5f7`), `th` 600/`#7a7a7a`, hairline row dividers (`#f0f0f0`), row
   hover `#fafafc`, `StatusPill` / `ProgressCell` / `RowActions` + `IconAction`
   helpers, sticky-header contained scroll via `maxHeight`.
2. **`src/components/ItemsToolbar.tsx`** — the header+filters block: a large
   left-aligned (in RTL) title, a subtitle, a blue pill primary action on the far
   side, then a plain inline filter/search row underneath.
3. **`@/styles/shifthouse.css`** — the `shx-*` classes (`shx-btn shx-btn-primary`,
   `shx-input`, `shx-icon-btn`, `shx-table`, `shx-scroll`, `shx-btn-ghost-link`).

`CrudTable.tsx` already uses `DataTable` and the `shx-*` classes — so the table
body of the CRUD pages is **already correct**. What is off-system is the **header**
(currently the centered `PageHeader`) and the **toolbar placement**. Fix those and
the CRUD pages match.

## What changes, page by page

### 1. Page header — replace `PageHeader` with the Items-style header
**Current (off-system):** `settings/components/PageHeader.tsx` renders a *centered*
title at `1.4rem`/700 with a bottom border and a tiny `0.8rem` subtitle. Items and
Shipments do not look like this.

**Target (match Items):** a header row that is the top of the content, in the RTL
flow (title on the right):
- Title: `font-size:34px; font-weight:700; letter-spacing:-0.6px; line-height:1.1`,
  `color:#1d1d1f`. (The prototype uses 30px inside its narrower 1100px lock; use
  **34px** to match the live Items page exactly — see `ItemsToolbar.tsx`.)
- Optional **count pill** beside the title (like Shipments' "N משלוחים"): e.g.
  "N לקוחות" — neutral chip, `#f5f5f7`, `1px solid #e0e0e0`, radius 9999,
  `font-size:13px; color:#7a7a7a`, tabular-nums. Nice-to-have, not required.
- Subtitle: `font-size:16px; color:#444; line-height:1.5; margin-top:8px`.
- **Primary action** ("הוסף לקוח" / "הוסף סוג פריט" …) is a **blue pill** on the
  opposite end of the header row: `shx-btn shx-btn-primary` (`#0066cc`,
  `padding:12px 22px`, `border-radius:9999`, white text, `Plus` icon 18/1.75).
  Hover darken ~4%; press `transform:scale(0.96)`.
- No bottom border under the header, no centered text.

**Simplest implementation:** delete `PageHeader` usage and let the toolbar own the
header — generalize `ItemsToolbar` into a shared `PageToolbar` that takes
`title`, `subtitle`, `count?`, `onAdd`, `addLabel`, `search`, `onSearch`,
`filters[]`. Then `CrudTable` renders it at the top instead of its current
search+add strip, and each settings `page.tsx` passes its `title`/`subtitle`.

### 2. CRUD toolbar — fold search + add into the header row
**Current:** `CrudTable.tsx` renders its own toolbar — a search input on one side
and the add button on the other — *below* the `PageHeader`. That's two stacked
header-ish rows.

**Target (match Items):** one header row (title + subtitle + blue pill add), then a
single inline **filters/search row** beneath it (`margin-top:24px; display:flex;
gap:12; flex-wrap:wrap`). CRUD pages usually have only a search field here; that's
fine — it sits alone in the row. Search field: `shx-input`, `height:42;
border-radius:10`, right-aligned magnifier (`Search` 16/1.75) with
`padding-inline-start:40`. Use the exact `ItemsToolbar` search markup.

### 3. Table — keep `DataTable`, drop any bespoke wrappers
The CRUD table is already `DataTable`. Confirm each settings table:
- Card: `#fff`, `1px solid #e0e0e0`, radius **16**, no shadow.
- Header: `#f5f5f7`, `th` `font-size:12px`/600/`#7a7a7a`, `padding:13px 18px`.
- Rows: `border-top:1px solid #f0f0f0`, hover `#fafafc`.
- ID column muted (`#9a9aa0`) + tabular-nums; the name column bold (600).
- Actions column centered, width ~110–120: two `IconAction`s — `Pencil` (edit,
  hover blue) and `Trash2` (delete, `danger` → `#bf3535`), 16px/1.75 lucide, flat
  32×32 `shx-icon-btn`.
- **Contained scroll** for long lists: pass `maxHeight="100%"` (or
  `calc(100vh - <header+subnav>)`) so `thead` is sticky and the body scrolls inside
  the card — the whole page must not scroll. The settings layout already gives the
  content box a bounded height (`flex:1; min-height:0`); keep that.

### 4. Master–detail: test-stations page
See the "עמדות בדיקה" tab in `reference/Settings.dc.html`. Two flat cards side by
side (grid `330px 1fr`, gap 20), each `#fff / 1px #e0e0e0 / radius 16`:
- **Left (master) — "עמדות":** a list of stations. Each row: name (bold when
  selected), a count chip of its sub-stations, and edit/delete icon buttons. The
  **selected** row gets `background:#f3f8ff` + a `3px solid #0066cc`
  `border-inline-start` (same treatment as `DataTable`'s `rowSelected`). A small blue
  pill "הוסף" in the card header. Row hover `#f5f5f7`.
- **Right (detail) — "תת-עמדות · {station}":** a `DataTable` of the selected
  station's sub-stations — columns תיאור / סטטוס / מחקר / פעולות. Status is a
  `StatusPill` (neutral chip + dot: blue = פעילה, muted = otherwise — **never**
  green/orange). "מחקר" is a small blue-tinted text pill or an em-dash. When no
  station is selected, an empty state (grid icon + "בחר עמדה מהרשימה").

### 5. Testing routes editor
Below the stations grid (or on the `/settings/testing-routes` page). A flat card:
header with a route-picker combobox + "מסלול חדש" button; body with a route-name
input and an **ordered step list** — each step a numbered blue chip
(`26×26`, `#0066cc`, white, radius 9999) + station name + up/down/remove icon
buttons, plus a dashed "הוסף שלב" combobox. See the route editor in the prototype.
Comboboxes should use the app's unified `SearchableCombobox`.

### 6. Sub-nav — already on-system
`settings/components/SettingsSubNav.tsx` is already the frosted sticky strip with
the `#0066cc` active tab + underline. **Leave it as is.** (The prototype's sub-nav is
a simplified stand-in — do not copy its pill-style tabs over the real underline
tabs.)

## Modals / dialogs (all already on-system — keep behavior, confirm styling)
The prototype shows the intended dialog look; the app's MUI `Dialog` wrappers
already match. Confirm:
- Dialog surface: white, `border-radius:18`, the one system shadow
  `rgba(0,0,0,0.22) 3px 5px 30px`. Title 19px/700/`-0.3px`.
- Fields: label 13px/600/`#333`; input `height:44; border:1px solid #e0e0e0;
  border-radius:8`, focus border `#0071e3`.
- Footer: right-aligned actions — "ביטול" ghost/outline pill, primary "שמירה" blue
  pill. **Delete confirm** uses a `#bf3535` destructive pill and the "פעולה זו אינה
  ניתנת לביטול" caption.
- Sub-station status picker: three segmented buttons (selected =
  `border:#0066cc; background:#f3f8ff; color:#0066cc`); research toggle switch
  (`#0066cc` on).

## Design tokens (identical to Items / Shipments)
```
Action Blue        #0066cc    buttons, links, active dot, selected edge, step chip
Focus Blue         #0071e3    input focus border
Ink                #1d1d1f    headings, values
Body               #444       subtitle, secondary text
Muted              #7a7a7a    th labels, captions, muted cells
Muted light        #9a9aa0    placeholder, ID column
Hairline           #e0e0e0    card border, th/row divider
Row divider        #f0f0f0    tr border-top
Row hover          #fafafc
Header row bg      #f5f5f7    parchment (also sticky-header bg, soft chip fill)
Selected tint      #f3f8ff    selected master row / active segmented button
Action hover bg    #e6efff / #f0f0f0
Destructive        #bf3535    delete icons, delete pill, validation text
Canvas             #f5f5f7    page background

Radii   card 16 · dialog 18 · input/button-rect 8–10 · pill & status & step 9999
Type    Heebo (Hebrew) / Inter fallback. Weights 300/400/600/700 — NO 500.
        Title 34 · subtitle 16 · body/cell 14 · th 12 · status/caption 11–12.
        letter-spacing -0.6px on the 34px title.
Icons   Lucide, 1.75px stroke, outline only, currentColor. 16 in tables, 18 nav.
Numbers font-variant-numeric: tabular-nums on all numeric / ID cells.
Motion  press scale(0.96); hover 4% darken/lighten; no shadow on cards/buttons.
```
The only shadow in the whole system is under a dialog. No gradients, no second
accent color, no green/orange status colors, no emoji, no exclamation marks.

## Files in this bundle
- `reference/Settings.dc.html` — the redesigned settings prototype (the target).
- `reference/Items-reference.dc.html` — Items page (visual source of truth).
- `reference/Shipments.dc.html` — Shipments page (already aligned).
- `reference/Reference Item Settings.dc.html` — on-system "פריטי ייחוס" screen.
- `reference/TopNav.dc.html`, `reference/support.js` — to open the prototypes.
- `screenshots/settings-generic.png` — rendered CRUD screen.
- `screenshots/settings-stations.png` — rendered master–detail screen.

## Existing code this maps to
- `src/app/settings/components/PageHeader.tsx` — **replace/retire**; header now
  comes from the shared toolbar (Items-style). 
- `src/app/settings/components/CrudTable.tsx` — move its search+add into the
  Items-style header row; keep its `DataTable`, CRUD, validation, snackbar logic.
- `src/app/settings/*/page.tsx` (customers, item-types, sources, item-status,
  test-station-status, workers, reference-items) — pass `title`/`subtitle`; drop the
  centered `PageHeader`.
- `src/app/settings/test-stations/{page,StationsTable,StationTypesTable}.tsx` —
  master–detail styling per §4.
- `src/app/settings/testing-routes/page.tsx` — route editor per §5.
- `src/app/settings/components/SettingsSubNav.tsx`, `settings/layout.tsx` —
  unchanged (already on-system).
- Shared, reused as-is: `src/components/DataTable.tsx`,
  `src/components/ItemsToolbar.tsx`, `@/styles/shifthouse.css`,
  `src/app/components/common/SearchableCombobox.tsx`.
