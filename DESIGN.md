---
name: Shifthouse
description: Hebrew RTL operations tool for item testing, packages and shipments; dense, flat, one action blue.
colors:
  action-blue: "#0066cc"
  action-blue-hover: "#0058b3"
  focus-blue: "#0071e3"
  on-dark-blue: "#2997ff"
  primary-tint: "#f3f8ff"
  primary-soft: "#e6efff"
  primary-border: "#cfe3fb"
  on-primary: "#ffffff"
  destructive: "#bf3535"
  destructive-hover: "#a82d2d"
  danger-bg: "#fbf2f2"
  success-ink: "#17784f"
  success-ink-hover: "#12663f"
  success-bg: "#eaf5ef"
  warning-ink: "#9a5b06"
  warning-bg: "#fdf3e6"
  warning-border: "#f0e2cc"
  status-late: "#d97706"
  status-approved: "#1f8a5b"
  canvas: "#ffffff"
  parchment: "#f5f5f7"
  pearl: "#fafafc"
  ink: "#1d1d1f"
  ink-muted-80: "#333333"
  ink-muted-70: "#444444"
  ink-muted-48: "#6e6e73"
  ink-muted-40: "#9a9aa0"
  divider-soft: "#f0f0f0"
  hairline: "#e0e0e0"
  border-strong: "#d4d4dc"
  field-border: "#949499"
  nav-bg: "#15171a"
  nav-ink: "#b8bcc2"
  nav-ink-muted: "#9aa0a6"
  nav-hover: "rgba(255,255,255,.06)"
  scrim: "rgba(0,0,0,.4)"
typography:
  page:
    fontFamily: "Rubik, 'SF Pro Display', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.374px"
  heading:
    fontFamily: "Rubik, 'SF Pro Display', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.374px"
  title:
    fontFamily: "Rubik, 'SF Pro Display', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  lead:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.47
  body-sm:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  fine:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  micro:
    fontFamily: "Rubik, 'SF Pro Text', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
  kpi:
    fontFamily: "Rubik, 'SF Pro Display', system-ui, -apple-system, Inter, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  xs: "5px"
  sm: "8px"
  field: "8px"
  md: "11px"
  card: "16px"
  lg: "18px"
  pill: "9999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  ml: "20px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  section: "80px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "9px 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.action-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 19px"
    height: "40px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.action-blue}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "9px 20px"
    height: "40px"
  button-destructive-hover:
    backgroundColor: "{colors.destructive-hover}"
  button-disabled:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink-muted-48}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "40px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
    height: "40px"
  input-disabled:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink-muted-48}"
  field-label:
    textColor: "{colors.ink-muted-80}"
    typography: "{typography.label}"
  tag-primary:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.action-blue}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tag-neutral:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink-muted-70}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tag-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tag-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tag-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  dialog:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    width: "520px"
  dialog-actions:
    backgroundColor: "{colors.pearl}"
    padding: "16px 24px"
  table-frame:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.card}"
  table-header:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink-muted-48}"
    typography: "{typography.fine}"
    padding: "13px 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "42px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.xs}"
    padding: "6px 10px"
---

# Design System: Shifthouse

## Overview

**Creative North Star: "The Quiet Workbench"**

Shifthouse is a Hebrew, right-to-left operations tool that testers, packers and shipping staff keep open all day, on desktops and station touchscreens, on an air-gapped network. The system is built for that: flat white surfaces, hairline edges, one action blue, and a dense product type scale (11 to 30px) in a single locally bundled family, Rubik. Nothing on screen decorates. A colour means something is clickable or reports a status, and a status colour always comes with a word, a dot or an icon.

Every surface uses logical properties and reads from the inline start (the right). Primary actions sit last, at the inline end. Numbers that get compared or scanned (IDs, KPIs, counters, durations) use tabular figures. The components are an in-house primitive set (`src/components/ui`, Radix underneath where needed). No MUI and no new npm packages, and package screens follow the artboards in `claude-code-handoff/packages/design`.

Motion is short and decelerating, and only on occasional surfaces. Hover exists only for fine pointers. Every interactive element shares one 2px focus ring.

**Key Characteristics:**
- Flat white canvas on parchment, hairline borders, no gradients, no elevation on cards.
- One action blue for everything clickable. Status colour reaches text only through an AA `*-ink` token.
- Dense product type scale in Rubik (bundled locally, never from a CDN) with no weight 500.
- RTL first: logical properties, primary action last at the inline end, reading-direction fills.
- Controls are 40px tall at 15px text. Fields share one radius (8px), buttons are pills.
- Motion under 300ms, `--ease-out`, exits faster than entrances, with a reduced-motion path.

## Colors

A neutral Apple-like greyscale with one saturated action blue. Status hues are functional, never brand.

### Primary
- **Action Blue** (action-blue): every clickable thing on light surfaces, including filled buttons, links, outlined buttons, checked controls, the active settings sub-tab and the caret. Hover darkens to action-blue-hover.
- **Focus Blue** (focus-blue): only the 2px keyboard focus ring and the focused-field border with its 3px 15% halo.
- **On-Dark Blue** (on-dark-blue): links and the focus ring on the dark nav rail, and the 16% wash behind the current rail item. Never used on light.
- **Blue washes**: primary-tint for selected table rows, selected combobox options and info alerts. primary-soft for selected chips and the primary Tag fill. primary-border for the edge of a soft-blue chip or selected card.

### Secondary (status)
- **Success Ink** (success-ink): success text, the success Tag, and the success button fill.
- **Warning Ink** (warning-ink): warning text and the warning button. warning-bg and warning-border carry the band.
- **Destructive** (destructive): error text, destructive buttons, the danger Tag, invalid field borders. danger-bg is the error band and the remove-row wash.
- **Status dots** (status-late, status-approved): dots, bars and chart fills only, never text. The single status-to-tone map (`src/app/lib/status-tones.ts`) colours waiting amber (status-late), in-test blue (action-blue), done green (status-approved) and neutral grey (ink-muted-48).

### Neutral
- **Ink** (ink): all body text and headings, and the dark utility button and tooltip fill.
- **Ink Muted 80 / 70** (ink-muted-80, ink-muted-70): field labels (80), page subtitles, secondary lines and neutral Tag text (70).
- **Secondary Grey** (ink-muted-48): captions, table headers, helper text, placeholders, icons in adornments, and disabled text. It reaches 5.07:1 on white and 4.66:1 on parchment.
- **Faint Grey** (ink-muted-40): 2.8:1. Placeholder and disabled text only, never data or labels.
- **Canvas / Parchment / Pearl** (canvas, parchment, pearl): white surfaces. Parchment is the page ground, table headers, disabled fills and menu highlight. Pearl is row hover and the dialog footer.
- **Hairlines** (divider-soft, hairline, border-strong): table row dividers, card and table edges, and secondary-button and hover borders.
- **Field Border** (field-border): the edge of every input, select, checkbox, radio and the off switch track. It reaches 3.02:1 on white.
- **Nav rail** (nav-bg, nav-ink, nav-ink-muted, nav-hover): the dark side navigation only.
- **Scrim** (scrim): the one backdrop under every popup. It is plain grey with no blur.

### Named Rules
**The One Blue Rule.** If it is blue on a light surface, it is clickable or selected. Don't use blue for decoration (for example, a page-header icon is grey).

**The Ink-For-Text Rule.** Status colours are for dots, bars and fills. Text in a status colour uses the matching `*-ink` token, which passes AA. status-late (3.19:1) and status-approved (4.33:1) never set small text.

**The 3:1 Edge Rule.** Any edge that identifies a form control uses field-border. Decorative edges (cards, dividers) use hairline.

## Typography

**Display Font:** Rubik variable, bundled locally via `next/font` as `--font-rubik` (fallbacks: SF Pro Display, system-ui, -apple-system, Inter, sans-serif)
**Body Font:** Rubik (fallbacks: SF Pro Text, system-ui, -apple-system, Inter, sans-serif)
**Label/Mono Font:** `--font-mono` (SF Mono, ui-monospace, JetBrains Mono, Menlo, Consolas) for code only. IDs use Rubik with tabular-nums.

**Character:** One rounded humanist sans that handles Hebrew and Latin evenly. Hierarchy comes from size and the 400/600/700 weights. Case and tracking play no part.

### Hierarchy
- **Page** (700, 30px, 1.1, -0.374px): the h1 of a page, for example the settings header. A 15px muted subtitle follows it.
- **Heading** (700, 24px, 1.15, -0.374px): large in-page headings (Typography h2).
- **Title** (600, 20px, 1.25): dialog and card titles (DialogTitle). Typography h3 and h4 use the same 20px at 700 and 1.2.
- **Lead** (600, 17px, 1.25): section titles and emphasised body (h5).
- **Body** (400, 15px, 1.47): controls (button, input, select), dialog body and body1.
- **Body-sm** (14px): table cells, menus, alerts, the nav rail and body2.
- **Label** (600, 13px): field labels and dense secondary lines.
- **Fine** (12px): table headers (600), helper text, captions, medium Tags.
- **Micro** (600, 11px, 1.3): small Tags, counters and badges.
- **KPI** (700, 26px, line-height 1, tabular-nums): KPI values.

### Named Rules
**The No-Caps Rule.** Hebrew has no capitals. Don't use `text-transform: uppercase` or added letter-spacing on labels, overlines, table headers or eyebrows.

**The Tabular Rule.** IDs, KPIs, counters, durations and code fields set `font-variant-numeric: tabular-nums` in Rubik. Inter is not bundled, so the artboards' Inter for IDs maps to Rubik plus tabular-nums.

**The No-500 Rule.** The weights are 300, 400, 600 and 700. Don't use 500. Use the `--text-*` product scale. The legacy `--fs-*` marketing scale (17/21/28/56) is not for new code.

## Layout

The shell is a dark side rail (240px, collapsing to 56px) beside a top bar (56px) and an optional sub-nav (52px), with content up to 1440px. Settings, files and shipments use a 1180px content column. Spacing is on a 4px base (4, 8, 12, 16, 20, 24, 32, 48, 80). Gaps of 8 and 12 sit inside components, 16 to 24 between groups, and dialogs pad 24px at the sides.

The layout is responsive by need, not by template. Package screens use a container query at 1040px, a short-screen layout at 720px tall, and full-screen dialogs at 760px or narrower. Settings grids collapse to one column under 900px. Popups fill the screen on phones (under 600px), and their headers stop being drag handles there. Content may sit in dir="ltr" islands (charts, codes, usernames) inside the RTL page. Directional icons mirror in RTL, and progress and load bars fill from the reading edge.

## Elevation & Depth

Surfaces are flat. Depth comes from tone (parchment ground, white cards, a pearl footer) and hairlines, not from shadows. Cards and Paper never take a shadow. The few shadows that exist are tied to a role.

### Shadow Vocabulary
- **Modal** (`box-shadow: rgba(0,0,0,.22) 3px 5px 30px 0`): package-artboard dialogs. The same value as `--shadow-product`, which goes under photographs.
- **Pop** (`box-shadow: 0 10px 34px rgba(17,21,31,.14)`): floating lists.
- **Focus halo** (`box-shadow: 0 0 0 3px` focus-blue at 15%, or destructive at 15% on an invalid field): the focused field.
- **Sticky rule** (`box-shadow: 0 1px 0` hairline): the rule under a sticky table header, where a collapsed border would scroll away.

### Named Rules
**The Flat-By-Default Rule.** A card, table or panel is white with a hairline edge. If you reach for a shadow to separate it, use tone instead.

## Shapes

Buttons and Tags are pills. Fields, icon buttons, menus and nav items have gently rounded corners (8px). Cards and table frames round to 16px, and dialogs to 18px. Alerts and snackbars use 11px. Menu items, tooltips and checkboxes use 5px. All borders are 1px.

**The One Field Radius Rule.** Every input, select and combobox in a row uses `--r-field` (8px), the dense package combobox included. The artboards' 10px is not used. The search field is the one exception: a 44px pill.

## Components

### Buttons
Confident pills at control height. The only motion is a press.
- **Shape:** pill (9999px) for contained and outlined. The text and dark utility buttons use 8px.
- **Primary:** contained action-blue with white text, 15px/600, 40px tall. Sizes are small (14px, 32px) and large (17px, 44px). The colours are primary, error, success (success-ink), warning (warning-ink) and inherit (ink).
- **Hover / Focus:** hover darkens, on fine pointers only. Outlined and text buttons get a 6% tint of their colour. Press scales to 0.97 over 120ms. Focus uses the shared ring. Disabled buttons are parchment with muted text.
- **Loading:** `loading` swaps the icon for a 16px spinner (14px on small), sets aria-busy and disables the button.
- **Secondary:** outlined in action-blue, or neutral outlined (inherit: ink on border-strong). Cancel is outlined inherit.
- **IconButton:** 40px square (32 small, 44 large) at 8px radius, with a 5% ink hover and a 0.95 press. The `round` variant is a translucent chip. An accessible name is required.

### Tags
- **Style:** one Tag spec (11/600, 3px 10px padding, pill), with medium at 12px and 4px 10px padding. The tones are primary (blue on primary-soft), neutral (ink-muted-70 on parchment), success, warning and danger, each in its `*-ink` on its `*-bg`.
- **Status pill:** the DataTable status pill is 12/600 ink text on parchment with a hairline edge and a 7px dot coloured by the status-tone map.
- **Chips:** clickable chips are buttons (Tab, then Enter or Space). The delete × is a named button with a 24px hit area around a 14px glyph.

### Cards / Containers
- **Corner Style:** cards, table frames and KPI tiles use 16px (`--r-card`), the Card primitive included. Paper uses 11px.
- **Background:** canvas on parchment.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline.
- **Internal Padding:** 24px for card content. KPI tiles use 16px by 18px.

### Inputs / Fields
- **Style:** white, 1px field-border, 8px radius, 40px tall, 15px text, 10px 14px padding. Placeholder is ink-muted-48.
- **Label:** above the field, 13/600 ink-muted-80, 6px gap. TextField generates the id and links the label with `htmlFor`. A placeholder-only field still carries a visually hidden label.
- **Focus:** the border turns focus-blue with a 3px 15% halo. Never `outline: none` without a replacement.
- **Error / Disabled:** errors get a destructive border, label and helper, with a destructive halo on focus. Disabled fields are parchment with muted text. A locked combobox is parchment with a lock icon and no focus ring.
- **Dense combobox:** package screens use 44px (38 or 34 for the compact sizes), 14.5px text, with the clear × and the arrow pinned at fixed inline-end insets. Its behaviour lives in the Autocomplete primitive.
- **Controls:** checkbox and radio are 20px on field-border and fill action-blue when checked. The switch is 44 by 26 with a field-border off track and a mirrored thumb in RTL.

### Dialogs
- **Frame:** white with an 18px radius, max 520px, sitting on the scrim. It fades and scales in from 0.97 over 180ms and leaves over 120ms. Headers are drag handles at 600px and up.
- **Title:** 20/600, padding 22px 24px 14px. `onClose` renders the single named × at the inline end.
- **Actions:** in a pearl footer with a hairline top. The buttons are aligned to the inline end with a 12px gap, and the contained (primary) action is always ordered last.
- **ConfirmDialog:** Cancel comes first and the action last. When the action is destructive, focus starts on Cancel, so Enter never deletes, and the text names the item and says the action cannot be undone.

### Tables
- **Style:** one look for the Table primitive and DataTable. The header is parchment, 12/600, ink-muted-48, with no uppercase. Body cells are 14px with 12px padding and divider-soft row rules. Rows get a pearl hover, and selected rows are primary-tint with aria-selected. The frame is white with a hairline edge and a 16px radius.
- **Interaction:** a clickable row is a Tab stop (Enter or Space opens it) with an inset focus ring. Sort labels are buttons that set aria-sort. Row actions are quiet 32px icon buttons.

### Navigation
- **Rail:** dark nav-bg. Items are 42px (nested 38px, 13px text) at 14px in nav-ink with an 8px radius. Hover (fine pointers only) uses nav-hover with white text. The current page gets a 16% on-dark-blue wash, white text and weight 600, and no side stripe. The focus ring is on-dark-blue, inset.
- **Settings sub-nav:** 14px ink-muted-70 tabs. The current tab is action-blue/600 with a 2px underline, set by aria-current.
- **Tabs:** 16px muted text. The active tab is ink/600 with a 2px ink underline.

### Feedback
- **Alert:** a tinted band per severity (bg plus a matching border at 11px radius). The icon carries the colour and the text stays ink. There is no side stripe. Error and warning use role alert, info and success use role status. The × is a named button with a 32px hit area.
- **Snackbar:** an ink band at 11px radius with 14px text. It slides up 8px over 180ms and uses role status.
- **Tooltip:** ink, 13px, 6px 10px padding, 5px radius, max 260px. One shared provider (300ms delay, 400ms skip-delay) opens a second tooltip instantly.
- **Skeleton / Progress:** a divider-soft-to-parchment shimmer that holds still under reduced motion. The linear progress bar fills with scaleX from the reading edge. The spinner is named "טוען" and keeps turning under reduced motion.

## Do's and Don'ts

### Do:
- **Do** take every value from `src/styles/tokens.css`. Never inline a raw hex.
- **Do** put the primary action last, at the inline end, in every dialog and footer.
- **Do** use one field radius (8px) and the 40px, 15px control size across a row.
- **Do** use the one Tag spec (11/600, 3px 10px, pill) and colour status through `status-tones.ts`.
- **Do** set IDs, KPIs and durations in Rubik with tabular-nums.
- **Do** gate hover behind `(hover: hover) and (pointer: fine)` and keep the shared 2px focus-blue ring with a 2px offset (on-dark-blue on the rail).
- **Do** animate only occasional surfaces, with `--ease-out` under 300ms and exits faster than entrances. Leave menus and the command palette unanimated.
- **Do** show an empty state that distinguishes "no data" from "no match", a retry on load errors, and "—" when no number is available instead of a fake 0.

### Don't:
- **Don't** use MUI, add npm packages, or load fonts from a CDN. Rubik is bundled.
- **Don't** uppercase or letter-space Hebrew text.
- **Don't** set text in status-late, status-approved or ink-muted-40.
- **Don't** add coloured side stripes to alerts, rows, nav items or KPI tiles.
- **Don't** put shadows on cards or tables, or use gradients on screens.
- **Don't** use font-weight 500 or the legacy `--fs-*` scale in new code.
- **Don't** use ease-in or `transition: all`, or start anything from scale(0).
