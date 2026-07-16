# Handoff: Shipments page — restyle to match the Items page

## Overview
Restyle the **Shipments** page ("משלוחים נכנסים") so it uses the exact same visual
language as the already-redesigned **Items** page ("ניהול פריטים") — the calm
Shifthouse/Apple system. No behavior or data changes: the same filters, table
columns, row actions, and all dialogs (add / edit / return-send / history /
barcodes / PDF / QR scan) stay functionally identical. This is a **visual
alignment** only, plus one scroll-behavior requirement (below).

## About the design files
`reference/Shipments.dc.html` is a **design reference authored in HTML** (a Design
Component prototype), showing the intended final look. It is not production code to
ship. Recreate it in the existing **Next.js + React + MUI** codebase, applying the
changes to the current shipments feature (`ShipmentTable.tsx`,
`ShipmentInsertPopup.tsx`, `ShipmentUpdatePopup.tsx`, `ShipmentSendPopup.tsx`,
`ShipmentHistoryPopup.tsx`, `ShipmentBarcodesDialog.tsx`, the shipments page under
`src/app/shipments`). Use the same primitives the Items page already uses.

`reference/Items-reference.dc.html` is the redesigned Items page — the visual source
of truth to copy from.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii are final. Match pixel-for-pixel.

## What changed vs the old shipments page
The old page (see the user's first screenshot) drifted off-system. Bring it in line:

1. **Header** — title 34px / 700 / letter-spacing −0.6px, left-aligned in the RTL
   flow with a count pill ("N משלוחים") beside it; subtitle 16px / `#444`. Primary
   action "משלוח חדש" is a blue pill (`#0066cc`, padding 12px 22px, radius 9999).
   Page top padding 36px. (Was: centered title, smaller type, muted subtitle.)
2. **Filters** — a plain **inline row** (no white card, no heavy container): search
   field + customer dropdown + from/to date inputs + "נקה" clear control, wrapping.
   Matches the Items filter row. (Was: a bordered white card with stacked labels.)
3. **Table card** — `background:#fff; border:1px solid #e0e0e0; border-radius:16px;
   overflow:hidden`. Header row `background:#f5f5f7`, `th` 11.5px / 600 / `#7a7a7a`,
   padding 13px 12px. Rows: `border-top:1px solid #f0f0f0`, hover `#fafafc`, whole
   row clickable (opens edit). (Was: radius 12, alternating row backgrounds, blue
   `#f1f6ff` hover, 12px header.)
4. **No green accents.** The old "כמות תקינה" green pill and the green "sent"
   checkmark are removed — Shifthouse is **one blue**, green is not an accent. Valid
   quantity is now a plain bold tabular number. "Sent" is shown as a **neutral status
   pill** ("נשלח") with a small blue dot — identical to the Items status-pill style
   (`background:#f5f5f7; border:1px solid #e0e0e0; border-radius:9999px; 6px dot`).
5. **Customer code** — plain text (`#444`), not a blue tinted pill.
6. **Row action buttons** (edit / return / history / PDF / barcodes) — minimal:
   32×32, `border:0`, `border-radius:8px`, `background:#f5f5f7`, icon `#5a5a5f`,
   hover `background:#e6efff; color:#0066cc`. (Was: 1px bordered white boxes.) Lucide
   icons, 1.75px stroke.
7. **Dialogs** were already on-system and are unchanged.

## Scroll behavior (important — the user's emphasis)
When the table is longer than the viewport, the **scroll must stay inside the
screen**, not scroll the whole page:
- The table's scroll container has `overflow:auto` and a bounded height —
  `max-height: calc(100vh - 240px)` in the reference (tune the offset to the real
  header + filter height in the app).
- The `thead` is **sticky**: each `th` has `position:sticky; top:0;
  background:#f5f5f7; z-index:1`, so column headers stay pinned while the body
  scrolls within the card.
- Horizontal overflow also scrolls inside the same container (the table has a
  min-width so narrow viewports scroll sideways rather than crushing columns).
In MUI terms: a `TableContainer` with `sx={{ maxHeight: 'calc(100vh - 240px)' }}`
and `<Table stickyHeader>`, header cells given the parchment background.

## Design tokens
```
Action Blue        #0066cc    buttons, links, active dot, action-hover text
Focus Blue         #0071e3    input focus border
Ink                #1d1d1f    headings, values
Body               #444       subtitle, secondary cell text
Muted              #7a7a7a    th labels, captions
Muted light        #9a9aa0    placeholder
Hairline           #e0e0e0    card border, row/th divider top
Row divider        #f0f0f0    tr border-top
Row hover          #fafafc
Header row bg      #f5f5f7    (also sticky-header bg + soft action-button fill)
Action hover bg    #e6efff
Destructive        #bf3535    delete icons / validation only

Radii   card 16 · button/input 8–10 · pill & status 9999
Type    Heebo (Hebrew) / Inter fallback. Weights 300/400/600/700 — no 500.
        Title 34, body 16, cell 14, th 11.5, status 11.
Icons   Lucide, 1.75px, outline, currentColor.
Numbers font-variant-numeric: tabular-nums on all numeric cells.
```
No shadows on the table/cards. The only shadow in the system is under dialogs
(`rgba(0,0,0,0.22) 3px 5px 30px`).

## Columns (unchanged)
מקור · מס׳ משלוח · קוד לקוח · תאריך קבלה · עובד מקבל · כמות כוללת · כמות מדגם ·
תת פריטים · כמות תקינה · פעולות. Numeric columns (כמות…, תת פריטים) center-aligned;
text columns right-aligned (RTL). "כמות כוללת" is bold.

## Files
- `reference/Shipments.dc.html` — the redesigned shipments prototype.
- `reference/Items-reference.dc.html` — the Items page (visual source of truth).
- `reference/TopNav.dc.html` — shared nav used by both (needed to open the prototypes).
- `reference/support.js` — runtime to open the `.dc.html` files in a browser.
- `screenshots/shipments-new.png` — rendered reference.

### Existing code this maps to
- `src/app/components/shipments/ShipmentTable.tsx` — the table (apply header/rows/
  status pill/action buttons + sticky-header contained scroll here).
- `src/app/shipments/…` — the page (header + inline filters).
- `ShipmentInsertPopup / ShipmentUpdatePopup / ShipmentSendPopup /
  ShipmentHistoryPopup / ShipmentBarcodesDialog` — dialogs (already on-system).
