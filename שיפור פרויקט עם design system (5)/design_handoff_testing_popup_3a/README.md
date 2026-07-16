# Handoff: Testing popup — "3A" single-screen station template

## Overview
A reusable **test popup template** for Shifthouse stations that do **not** need a
multi-step wizard — every check lives on one screen. It replaces the current
off-system `PopUpTestDialog.tsx` (gradients / glass / blue-on-blue chips) with a
calm, Apple/Shifthouse-aligned dialog that matches the polish of the intake wizard
(`Photo.tsx`).

The template is the agreed direction "3A": item identity as a hero band, all
building-blocks stacked in one scrollable body, a **section jump-list** on the side
(desktop) that becomes horizontal chips on smaller screens, and finish actions in
the footer. It is sized to **65% of the viewport** on desktop and is fully
responsive down to full-screen on phones.

Same building-blocks (system note, reference-slot photo uploader, pass/fail toggle,
weight + deviation, notes) can be composed either as **one screen** (this template)
or split into **wizard steps** (like `Photo.tsx`) — one shared block library, two
assemblies.

## About the design files
The files in `reference/` are **design references authored in HTML** (a Design
Component prototype), showing the intended look and behavior. They are **not**
production code to ship. The task is to **recreate this design in the existing
Next.js + React + MUI codebase** (`src/app`), using the app's established patterns:
the `@/components/ui` MUI wrappers, `@/components/ui/icons`, the
`StationTestDialogProps` contract, and the existing test-results API calls.

`src/TestingSingleScreenDialog.tsx` is a **ready reference implementation** written
to those conventions — start from it. It is close to drop-in but review the `TODO`s
(reference-image / reference-weight lookup) and wire them to your real endpoints.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final.
Recreate pixel-for-pixel using MUI + the tokens below. Do not introduce new colors,
shadows, or gradients.

---

## Screen: TestingSingleScreenDialog

### Purpose
Perform and record a single-screen test for one item at one station, then either
**save & finish** or **send to research**.

### Layout
- **Overlay**: MUI `Dialog` centered over a `rgba(0,0,0,0.4)` scrim.
- **Dialog paper**: flex container.
  - **Desktop (`md`, ≥ 900px)**: `flex-direction: row` — a **200px side rail** +
    a flexible main column. Paper `width: max(760px, 65vw)`, `height: min(900px, 86vh)`,
    `border-radius: 20px`.
  - **Tablet (`sm`, 600–899px)**: `flex-direction: column`, **no rail** — the
    section list becomes a horizontal scrolling **chip row** under the hero. Paper
    `width: 94vw`, `height: 94vh`.
  - **Phone (`xs`, < 600px)**: `fullScreen` — `width: 100vw`, `height: 100dvh`,
    `border-radius: 0`; footer actions stack full-width (`column-reverse`).
- **Main column** (all breakpoints): `hero band` → (`chip row` on sm/xs) →
  `scrollable body` (`flex: 1; overflow-y: auto`) → `footer`.
- Body content is capped at `max-width: 680px` and centered.
- The whole dialog is `dir="rtl"`.

### Components

**Side rail (desktop only)** — `width: 200px`, `background: #f5f5f7` (parchment),
`border-inline-end: 1px solid #e0e0e0`, `padding: 24px 16px`.
- Eyebrow "מקטעים": 11px / 600 / uppercase / letter-spacing 0.04em / color `#0066cc`, margin-bottom 14px.
- Section rows (4): `padding: 9px 10px`, `border-radius: 12px`, `gap: 11px`,
  `cursor: pointer`. Active row `background: rgba(0,102,204,0.07)`.
  - Dot: 7×7 circle — active `#0066cc`, inactive `#c7c7cf`.
  - Label: 14px, active `700`/`#1d1d1f`, inactive `600`/`#7a7a7a`.
- Footer caption "עמדה ללא שלבים": 11.5px / `#9a9aa0`, pinned to bottom.
- Clicking a row **smooth-scrolls** the body to that section (`container.scrollTo`,
  never `scrollIntoView`).

**Chip row (tablet/phone)** — replaces the rail. Horizontal scroll, `gap: 8px`,
`padding: 12px 20px`, `border-bottom: 1px solid #e0e0e0`. Chips: 13px / 600, pill
(`border-radius: 9999px`), `padding: 6px 14px`. Active `#0066cc`/white; inactive
`#f0f0f2`/`#7a7a7a`.

**Hero band** — `padding: 20px 32px` (16px 18px on phone), `border-bottom: 1px solid #e0e0e0`, flex row, `gap: 16px`.
- Thumbnail: 60×60 (52 on phone), `border-radius: 14px`, `background: #f0f0f2`,
  `border: 1px solid #e0e0e0`, centered camera icon in `#9a9aa0`. (Swap for a real
  item photo when available.)
- Text block:
  - Eyebrow = station name: 12px / 600 / uppercase / 0.04em / `#0066cc`.
  - Title = item model: 19px / 700 / letter-spacing −0.3px.
  - Meta chips (wrap, `gap: 6px`, margin-top 8px): each 11.5px / 600,
    `background: #f0f0f2`, pill, `padding: 3px 10px` — `#{item_id}`, `מק״ט {makat}`,
    `{customer_code}`. Worker chip is tinted: `background: rgba(0,102,204,0.08)`,
    `color: #0066cc`, with a 13px person icon.
- Close button: 36×36 circle, `background: #f0f0f2`, icon `#7a7a7a`, hover
  `#e6e6ea`, aligned to top (`align-self: flex-start`).

**Body building-blocks** (stacked, `gap: 16px`):
1. **SystemNote** — `background: rgba(0,102,204,0.05)`, `border: 1px solid rgba(0,102,204,0.14)`,
   `border-radius: 14px`, `padding: 14px 16px`. Label "הודעת מערכת" 11px / 700 / `#0066cc`;
   body 15px / line-height 1.5 / `#1d1d1f`.
2. **PhotoUploader** (section 0) + **PassFail** (section 1) share one flex-wrap row
   (`gap: 18px`); photo column `min-width: 280px`, verdict column `min-width: 240px`.
   - Uploader: progress bar dots (`height: 4px`, filled `#1f8a5b`, active `#0066cc`,
     empty `#e0e0e0`) + counter pill "`X / Y צולמו`" (12.5px / 700 / `#0066cc` on
     `rgba(0,102,204,0.08)`, tabular-nums). Big frame `height: 210px`,
     `border-radius: 16px`, `background: #f0f0f2`, `border: 1px solid #e0e0e0`; empty
     state = camera icon + "תמונת ייחוס · צלם את הפריט" in `#9a9aa0`. Capture button
     `height: 50px`, `border-radius: 12px`, `background: #0066cc`, white, 16px / 600,
     hover `#0058b3`, active `scale(0.98)`. Filmstrip thumbs 64×64, `border-radius: 12px`;
     active 2.5px `#0066cc` border, captured 1.5px `#1f8a5b` + green check badge.
   - PassFail: two buttons, `flex: 1`, `height: 50px`, `border-radius: 12px`, 15px / 600.
     Idle `border: 1.5px #e0e0e0` / white / `#1d1d1f`. Active "תקין" → `#1f8a5b` +
     `rgba(31,138,91,0.08)`; active "לא תקין" → `#bf3535` + `rgba(191,53,53,0.08)`.
     Icons: check / X. Press `scale(0.98)`.
3. **Weigh** (section 2) — divider with centered label "שקילה" (12px / 700 / `#9a9aa0`,
   1px `#e0e0e0` rules). Two fields (`row` on sm+, `column` on xs): reference weight
   (read-only) + measured weight (number). When measured is filled, an MUI `Alert`:
   `success` if `|measured − reference| / reference ≤ 5%`, else `error`, text
   "משקל תקין/לא תקין — סטייה ±N גר׳ (P% · סטייה תקנית ±5%)". `border-radius: 12px`.
4. **Notes** (section 3) — MUI `TextField`, multiline, 3 rows, label "הערות".

**Footer** — `padding: 18px 32px` (14px 18px phone), `border-top: 1px solid #e0e0e0`,
`justify-content: space-between`. On phone: `flex-direction: column-reverse`, actions
stack full-width.
- "ביטול" — text button, `#7a7a7a` / 600, hover `#f0f0f2`.
- "העבר לחקר" — outlined pill, `height: 46px`, 1.5px `#0066cc` border, `#0066cc` text,
  flask icon, hover `rgba(0,102,204,0.05)`.
- "שמור וסיים" — contained pill, `height: 46px`, `background: #1f8a5b`, white,
  check-circle icon, hover `#186f49`. Shows spinner + "שומר..." while submitting.
- Both actions disabled while `submitting` or when `workerId == null`.

---

## Interactions & behavior
- **Section nav**: rail row / chip click → set active + smooth-scroll body to that
  section's `offsetTop − 12`. Use `bodyRef.current.scrollTo({ behavior: "smooth" })`
  — **never** `scrollIntoView`.
- **Photo capture**: file input (`accept="image/*" capture="environment"`) → append
  `Shot` with an `URL.createObjectURL` preview; upload to the item-files pipeline
  (`POST /api/items/:id/files` with `worker_id` + `station_type_id`, as in `Photo.tsx`),
  then store the returned `objectKey`. Filmstrip thumb X removes a shot.
- **Weight deviation**: recomputed live; `TOLERANCE_PCT = 5`.
- **Pass logic**: `passed = ok === "pass" && (deviation == null || deviation.pass)`.
- **Submit**: builds `TestResultData` (`Result`, `Passed`, `Comments`, `WorkerID`,
  `sendToResearch`, `Details`) and calls `onSubmit(data)`, then `onClose()`. On throw,
  show error Alert. Requires `workerId` (from the page-level picker) — otherwise error
  "יש לבחור עובד בכותרת מסך הבדיקות".
- **Reset** on `open` / `item` change.
- **Press affordance**: buttons `transform: scale(0.98)` on `:active` only. Hover =
  4% darken/lighten, no movement. No bounce/spring.

## State management
| State | Type | Notes |
|---|---|---|
| `activeSection` | number | 0–3, drives rail/chip highlight + scroll |
| `photos` | `Shot[]` | `{ previewUrl, objectKey?, uploading? }` |
| `refImages` | `RefImg[]` | reference slots — fetch per item/station (TODO) |
| `ok` | `"" \| "pass" \| "fail"` | pass/fail verdict |
| `refWeight` | `number \| null` | reference weight — fetch (TODO); demo value 1240 |
| `measured` | string | measured weight input |
| `note` | string | comments |
| `error` | `string \| null` | submit / validation error |
| `submitting` | boolean | disables actions, shows spinner |

Data fetching: on open, look up reference images + reference weight for the item
(reuse the intake wizard's `reference-lookup` endpoint or equivalent). Marked `TODO`
in the reference component.

## Responsive behavior
Driven by MUI `useMediaQuery(theme.breakpoints…)`:
- `up("md")` → side rail visible (`isWide`).
- `down("sm")` → `fullScreen` dialog, stacked footer (`isMobile`).
- Between → column layout, chip row, `94vw × 94vh`.
Desktop width is literally **65% of the viewport** (`max(760px, 65vw)` — the `760px`
floor keeps the two-column photo/verdict row intact on small laptops).

## Design tokens
```
Action Blue          #0066cc   every interactive element on light
Focus Blue           #0071e3   2px focus ring
Approved / OK green   #1f8a5b   "save & finish", pass, weight-ok
Destructive red      #bf3535   fail verdict, weight-fail (functional only)
Ink                  #1d1d1f   headlines + body
Muted                #7a7a7a   secondary text
Muted light          #9a9aa0   captions, placeholder, empty icons
Hairline             #e0e0e0   1px dividers / card borders
Divider soft         #f0f0f0   progress track
Chip / thumb bg      #f0f0f2
Parchment (rail)     #f5f5f7
Product shadow       rgba(0,0,0,0.22) 3px 5px 30px   (dialog only)

Radii    chip/pill 9999 · button 12 · thumb/frame 14/16 · dialog 20 (0 on phone)
Spacing  8 / 12 / 16 / 24 / 32 (base 8)
Type     Heebo (Hebrew) / Inter fallback → SF Pro on Apple platforms.
         Weights 300/400/600/700 — NO 500. Body 15–17px. Eyebrow 11–12px uppercase.
Icons    Lucide, 1.75px stroke, outline only, currentColor. Sizes 16/20/24.
Tolerance ±5% weight deviation.
```

## Assets
No image assets required. The hero thumbnail and empty photo frame use a Lucide
camera icon as a placeholder until a real item photo is wired. Reference images come
from the reference-item lookup at runtime.

## Files
- `reference/Testing Popup 3A.dc.html` — the standalone responsive prototype (open in a browser).
- `reference/TestStepBody.dc.html` — the shared building-blocks component (renders `phase="all"` here; the wizard uses per-step phases).
- `reference/support.js` — runtime needed to open the two `.dc.html` files.
- `reference/Testing Popup Template.dc.html` — the full option board (turns 1–3) showing 3A next to the alternatives that were considered.
- `src/TestingSingleScreenDialog.tsx` — reference implementation for the target codebase.
- `screenshots/3a-standalone.png` — rendered reference.

### Existing code this replaces / relates to
- `src/app/components/PopUpTestDialog.tsx` — the current generic dialog (to be restyled/replaced by this template).
- `src/app/testing/tests-popups/Photo.tsx` — the intake **wizard** (shares the same building-blocks; keep block helpers in one place).
- `src/app/testing/tests-popups/mainPopUp.ts` — the `test_station_type_id → dialog` registry; register this component for single-screen station types.
- `src/types/index.ts` — `StationTestDialogProps`, `TestResultData`, `ItemRow`, `TestStation`.
