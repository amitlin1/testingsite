# Handoff: קליטה וצילום wizard — exact popup spec (workspace chrome)

## Why this handoff exists
The implemented wizard came out **cramped and off-spec** (see the user's screenshot):
a small dialog, a wrapping top row of step-chips, an over-large bare item number in
the header, and broken hierarchy. This document is the **exact, unambiguous spec** to
rebuild it as the agreed *workspace* popup: a side-rail vertical stepper, a clear
item card, one blue, and a dialog that fills **65% of the screen** and scrolls
internally. Match it pixel-for-pixel.

`reference/Testing Popup Wizard.dc.html` is the design of record. `screenshots/wizard.png`
is how it must look on desktop.

## Stack
Next.js + React + MUI, RTL. Same `StationTestDialogProps` contract as the existing
`src/app/testing/tests-popups/Photo.tsx`. Keep Photo.tsx's phase state machine and
per-phase content (`PhaseBody`, `PhotoUploader`, `PassFail`, `SystemNote`, weight
logic, accessory sub-flow) — **only the shell/chrome changes**. `src/PhotoWizard.tsx`
here is the reference shell to adopt.

## Do NOT (the mistakes to fix)
- ❌ Do not put the steps in a wrapping chip row across the top on desktop. On desktop
  steps live in a **fixed 264px left rail** as a vertical list.
- ❌ Do not render the raw item id as a giant number. The item identity is a **card in
  the rail** (model + meta + worker), never a bare 40px+ numeral in the header.
- ❌ Do not let the dialog be small/auto-sized. It is **max(760px, 65vw) wide × min(900px, 86vh) tall** on desktop.
- ❌ No green as an accent except the single OK/approved green on the final "סיום" action and done-step ticks.

## Exact layout — desktop (viewport ≥ 920px)

**Overlay**: `position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex;
align-items:center; justify-content:center; padding:3vh 3vw;` RTL.

**Dialog paper**: `display:flex; flex-direction:row; width:max(760px, 65vw);
height:min(900px, 86vh); background:#fff; border-radius:20px; overflow:hidden;
box-shadow:rgba(0,0,0,0.22) 3px 5px 30px;`

### Left rail — 264px
`width:264px; flex-shrink:0; background:#f5f5f7; border-inline-end:1px solid #e0e0e0;
padding:24px 20px; display:flex; flex-direction:column;`
1. **Eyebrow** "קליטה וצילום": 12px / 600 / uppercase / letter-spacing 0.04em /
   color `#0066cc`; margin-bottom 12px.
2. **Item card**: `background:#fff; border:1px solid #e0e0e0; border-radius:16px;
   padding:16px; margin-bottom:22px;`
   - Model: 16px / 700 / letter-spacing −0.3px.
   - Meta lines: 12.5px / `#7a7a7a` (`#{id} · מק״ט {makat}`, then `לקוח {code} · S/N`).
   - Worker chip: inline-flex, `background:rgba(0,102,204,0.08)`, `color:#0066cc`,
     radius 9999, padding 4px 11px, 12px / 600, 13px person icon.
3. **Stepper** (vertical list, `gap:2px`). Each row:
   `display:flex; align-items:center; gap:12px; padding:9px 10px; border-radius:12px;
   cursor:pointer;` active row `background:rgba(0,102,204,0.07)`.
   - Circle: 28×28, radius 9999, 12.5px / 700, tabular-nums.
     - done → `background:#1f8a5b; color:#fff` with a check icon (no number).
     - current → `background:#0066cc; color:#fff` + number.
     - upcoming → `background:#fff; border:1.5px solid #e0e0e0; color:#9a9aa0` + number.
   - Label: 14px; current 700 `#1d1d1f`; done `#1d1d1f`; upcoming `#9a9aa0`.
   - Clicking a row jumps to that phase.
4. Spacer (`flex:1`), then step counter "שלב N מתוך M": 12px / `#9a9aa0`.

Phases (5): `סריקת מק״ט יצרן` · `צילום האריזה` · `פתיחת המארז` ·
`בדיקת פריטים נלווים` · `העברת המוצר`.

### Main column (`flex:1; min-width:0`)
- **Header**: `padding:24px 32px; border-bottom:1px solid #e0e0e0; display:flex;
  align-items:flex-start; justify-content:space-between; gap:12px;`
  - Left: phase title 24px / 700 / letter-spacing −0.4px; under it the step counter
    13px / `#7a7a7a` (margin-top 3px). **No item id here** — identity is in the rail.
  - Right: close button 36×36 circle, `background:#f0f0f2`, icon `#7a7a7a`, hover `#e6e6ea`.
- **Body**: `flex:1; padding:28px 32px; overflow-y:auto;` inner content
  `max-width:680px; margin:0 auto;`. Renders the current phase's building blocks
  (Photo.tsx `PhaseBody`). Blocks (see `reference/TestStepBody.dc.html` and the
  companion 3A handoff for exact block specs): SystemNote, reference-slot
  PhotoUploader, PassFail (`תקין`/`לא תקין`), weight + deviation, count/labels,
  accessories list, transfer confirmation.
- **Footer**: `padding:18px 32px; border-top:1px solid #e0e0e0; display:flex;
  align-items:center; justify-content:space-between; gap:12px;`
  - "חזור" — text button, `#7a7a7a`/600, icon chevron; `opacity:0.4` + non-interactive on step 1.
  - Primary — pill `height:46px; border-radius:9999px; padding:0 24px; 15px/600; color:#fff`.
    Steps 1..M−1: `background:#0066cc`, label "המשך" + forward chevron.
    Last step: `background:#1f8a5b`, label "סיום קליטה" + check-circle icon.

## Responsive
- **Tablet (600–919px)**: dialog `width:94vw; height:94vh; flex-direction:column;
  border-radius:20px`. Rail hidden. Steps become a **horizontal scrolling chip row**
  under the header (`padding:12px 20px; border-bottom:1px solid #e0e0e0; gap:8px`),
  chips: pill 6px 14px / 13px / 600 — current `#0066cc`/white, done
  `rgba(31,138,91,0.1)`/`#1f8a5b`, upcoming `#f0f0f2`/`#7a7a7a`; label "N. title".
  Header eyebrow shows "קליטה וצילום · {model}".
- **Phone (<600px)**: `fullScreen` — `width:100vw; height:100dvh; border-radius:0`;
  header/body/footer paddings tighten to 16–20px.
Implement with `useMediaQuery(theme.breakpoints…)` — see `PhotoWizard.tsx`.

## Design tokens
```
Action Blue   #0066cc   current step, primary pill, links, worker chip text
OK / approved #1f8a5b   done step + tick, final "סיום קליטה" pill
Ink           #1d1d1f   titles, step labels
Muted         #7a7a7a   sub-labels, back button, meta
Muted light   #9a9aa0   upcoming steps, counter, placeholder
Hairline      #e0e0e0   dividers, card + upcoming-circle border
Rail bg       #f5f5f7   left rail
Chip bg       #f0f0f2   close button, upcoming step chip
Active row    rgba(0,102,204,0.07)
Product shadow rgba(0,0,0,0.22) 3px 5px 30px  (dialog only)
Radii  dialog 20 (0 phone) · item card 16 · step row 12 · circle/pill/chip 9999
Type   Heebo (Hebrew)/Inter → SF Pro on Apple. Weights 300/400/600/700 — no 500.
       Title 24, body 15–17, rail label 14, meta 12.5, eyebrow 12.
Icons  Lucide 1.75px outline, currentColor.
```

## Files
- `reference/Testing Popup Wizard.dc.html` — the exact design (open in a browser).
- `reference/TestStepBody.dc.html` — the per-step building blocks used in the body.
- `reference/support.js` — runtime to open the `.dc.html` files.
- `src/PhotoWizard.tsx` — reference shell for the codebase (drop Photo.tsx's PhaseBody into the body).
- `screenshots/wizard.png` — desktop target.

### Maps to
`src/app/testing/tests-popups/Photo.tsx` — replace its `Dialog` chrome (Paper sizing,
header, footer) with this shell; keep its phase state + PhaseBody + upload pipeline.
