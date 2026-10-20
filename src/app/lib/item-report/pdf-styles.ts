// Shared print stylesheet for the item-report components (ported from
// ticketflow src/lib/pdf/pdf-styles.ts).
//
// ONE source of truth, injected into BOTH:
//   - the server print HTML (html.ts) → Chromium → PDF
//   - the template editor canvas (so the editor looks like the output)
//
// The look is an official document (מסמך רשמי): black ink, the David face,
// a letterhead with the issuing body and the document's particulars, numbered
// sections, ruled tables with grey label cells, verdicts as words — no colour
// carries meaning, so the page survives a black-and-white copier.
//
// The @font-face rules are injected separately (fonts.ts: inlined by html.ts
// for print, loaded from /fonts by the editor). --pdf-font is set on .pdf-page
// from the document's font setting.

export const PDF_CSS = `
:root { --pdf-ink:#000; --pdf-line:#000; --pdf-soft:#333; --pdf-head:#e6e6e6; --pdf-navy:#000; --pdf-border:#000; --pdf-font:'David Libre', 'David', 'Times New Roman', serif; }

* { box-sizing: border-box; }

.pdf-page {
  width: 210mm;
  min-height: 297mm;
  padding: 14mm 16mm;
  margin: 0 auto;
  background: #fff;
  color: var(--pdf-ink);
  /* --pdf-font, never var(--font-rubik) directly: an undefined custom property
     (the print HTML has no next/font) would void the whole declaration and
     drop to the browser's serif default. The editor overrides --pdf-font. */
  font-family: var(--pdf-font);
  direction: rtl;
  text-align: right;
  font-size: 12pt;
  line-height: 1.5;
  counter-reset: pdfsec;
  /* let the footer preview sink to the bottom of the A4 sheet in the editor */
  display: flex;
  flex-direction: column;
}
/* The footer preview is pushed to the bottom edge of the page sheet. */
.pdf-footer-preview { margin-top: auto; }

/* In print, the @page rule (or Puppeteer's own page.pdf margin option —
   see render.ts) owns the paper margins, so drop the on-screen A4 frame to
   avoid double margins / clipped content.
   display:block too — .pdf-page is ONE box holding the whole (possibly
   multi-page) document, not one box per printed page; the flex/column
   layout above exists only so the editor canvas can sink the footer
   preview to the sheet's bottom. Chromium's print fragmentation of a
   flex container across page breaks is unreliable and produces broken/
   overlapping layout on multi-page docs — block lets normal fragmentation
   (and .pdf-frame's position:fixed repeat-per-page) work correctly. The
   real footer is built by Puppeteer's footerTemplate (render.ts), not by
   .pdf-footer-preview, so losing the flex sink in print is harmless. */
@media print {
  .pdf-page { width: auto; min-height: 0; padding: 0; margin: 0; display: block; }

  /* Bordered documents ONLY: render.ts's no-footer-template render path
     (renderPdf() without opts.footerLines) zeroes BOTH Puppeteer's own
     page margin AND the @page CSS margin for these, specifically so this
     padding is the ONLY source of page-content spacing. .pdf-frame is
     position:fixed, so it's measured from a different reference box than
     normal-flow content in Chromium's print engine — content ends up
     overlapping a frame inset that "should" be well outside it (a
     Chromium/@page-margin quirk, not particular to any one component,
     confirmed to reproduce even in a minimal repro outside this app).
     Giving .pdf-page real padding — instead of the 0 above, and instead of
     relying on an external page margin position:fixed doesn't share a
     reference box with — keeps content and frame aligned on EVERY page,
     not just page 1.
     LIMITATION: this does NOT extend to documents that ALSO need a footer
     rendered via Puppeteer's displayHeaderFooter (real footer text /
     live page numbers) — that mode boxes print content into a sub-frame
     that .pdf-frame's position:fixed does not align with either, and no
     margin/padding value fixes it (confirmed empirically). A bordered
     form with footer text or page numbers will still show this overlap;
     that needs a separate fix (e.g. a CSS-counter page-number scheme that
     avoids displayHeaderFooter) before it can be resolved. */
  .pdf-page:has(.pdf-frame) { padding: 14mm 16mm; }
}

/* ---- header / footer (document-level, from the page settings) ---- */
.pdf-headerband { margin-bottom: 8px; }
.pdf-footer-preview { margin-top: 16px; border-top: 1px solid var(--pdf-line); padding-top: 6px; text-align: center; font-size: 9pt; color: var(--pdf-soft); }
.pdf-footer-preview__note { font-size: 7.5pt; color: #aab1c0; margin-bottom: 2px; }
/* Pull the logo row a bit toward the page edges (letterhead look) — the logos
   sit closer to the margin than the flowing content, near the corner texts. */
.pdf-header { display: flex; align-items: center; gap: 12px; margin-inline: -8mm; }
.pdf-header__side { flex: 0 0 auto; width: 96px; display: flex; align-items: center; }
.pdf-header__side--left { justify-content: flex-start; }
.pdf-header__side--right { justify-content: flex-end; }
.pdf-header__logo { max-height: 70px; max-width: 92px; object-fit: contain; }
.pdf-header__center { flex: 1 1 auto; text-align: center; }
.pdf-title { font-size: 18pt; font-weight: 800; margin: 0; color: var(--pdf-navy); }
.pdf-subtitle { font-size: 10pt; color: var(--pdf-soft); margin-top: 2px; }
.pdf-corner { display: flex; align-items: baseline; font-size: 10pt; font-weight: 700; gap: 8px; }
.pdf-corner__cell { flex: 1 1 0; min-width: 0; }
.pdf-corner__cell--right { text-align: right; }
.pdf-corner__cell--center { text-align: center; }
.pdf-corner__cell--left { text-align: left; }

/* A frame drawn on every page (bordered forms). position:fixed so Chromium
   repeats it on each printed page; in the editor each sheet gets its own.
   See the .pdf-page:has(.pdf-frame) print rule above for why content needs
   its OWN real padding (not an external page margin) to stay aligned with
   this. */
.pdf-frame { position: fixed; inset: 6mm; border: 1.5pt solid var(--pdf-line); pointer-events: none; z-index: 0; }
.pdf-frame--dashed { border-style: dashed; }

/* ---- section heading ----
   NOTE: no forced font-weight / text-decoration here — bold, underline, italic
   and size are controlled per-run by the rich-text editor, so the toolbar
   toggles work. The box variant is purely structural (a bordered header band). */
.pdf-section { font-size: 12.5pt; margin: 12px 0 6px; }
.pdf-section--box {
  border: 1px solid var(--pdf-line); background: var(--pdf-head);
  padding: 3px 8px; border-radius: 3px;
}

/* ---- text / list ---- */
.pdf-text { white-space: pre-wrap; margin: 4px 0; }
.pdf-text--center { text-align: center; }
.pdf-text--left { text-align: left; direction: ltr; }
.pdf-text--bold { font-weight: 700; }
.pdf-blank { display: inline-block; min-width: 90px; border-bottom: 1px solid var(--pdf-line); }
/* A variable / fill-in: the value sits on an underline, like a paper-form
   field — whether filled (shows the value) or empty (just the line). */
.pdf-fill { display: inline-block; min-width: 72px; border-bottom: 1px solid var(--pdf-line); text-align: center; padding: 0 6px; line-height: 1.5; }
/* Inside a signature/value box the box border already IS the line. */
.pdf-sign__box .pdf-fill { border-bottom: 0; min-width: 0; padding: 0; }
.pdf-list { margin: 4px 0; padding-inline-start: 22px; }
.pdf-list li { margin: 3px 0; }

/* ---- flow layout: blocks flow in a wrapping row; each block carries its
   own mm width, so two half-width blocks dropped side by side share a row.
   The output wraps blocks in .pdf-flow; the editor's Puck drop zone is made
   the same flex row via [data-puck-dropzone] (which only exists in-editor). */
.pdf-flow,
[data-puck-dropzone] {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
}
.pdf-block { box-sizing: border-box; padding-inline: 1.5mm; }

/* legacy (kept harmless) */
.pdf-row { display: flex; gap: 14px; align-items: stretch; margin: 4px 0; }
.pdf-col { flex: 1 1 0; min-width: 0; }

/* ---- page break ---- */
.pdf-pagebreak { flex-basis: 100%; break-after: page; -webkit-column-break-after: page; }
.pdf-pagebreak__marker {
  text-align: center; color: #9aa1ad; font-size: 9pt; margin: 6px 0;
  border-top: 1px dashed #c4c9d4; border-bottom: 1px dashed #c4c9d4; padding: 4px 0;
}
@media print { .pdf-pagebreak__marker { display: none; } }

/* ---- table ---- */
.pdf-table { width: 100%; border-collapse: collapse; margin: 4px 0; }
.pdf-table th, .pdf-table td {
  border: 1px solid var(--pdf-line); padding: 5px 6px;
  text-align: center; font-size: 10pt; vertical-align: middle;
}
.pdf-table th { background: var(--pdf-head); font-weight: 700; }
.pdf-table--noheadbg th { background: transparent; }

/* ---- signature ---- */
.pdf-sign { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.pdf-sign__box {
  width: 100%; min-height: 58px;
  border-bottom: 1px solid var(--pdf-line);
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 2px;
}
.pdf-sign__box img { max-height: 56px; max-width: 100%; object-fit: contain; }
.pdf-sign__placeholder { color: #bbb; font-size: 9pt; }
.pdf-sign__box--highlight { background: #fff7d6; outline: 2px dashed #e0a400; }
.pdf-sign__box--highlight .pdf-sign__placeholder { color: #b7791f; font-weight: 700; }
.pdf-sign__label { font-size: 9pt; color: var(--pdf-soft); text-align: center; }
.pdf-sign__meta { font-size: 8pt; color: var(--pdf-soft); text-align: center; }

/* signature ROW: cells (drawn signature + auto-filled signer fields + free
   text) the author orders freely; all sit on one line, each on its own line.
   The value/signature sits on a bottom border (the line to sign / write on);
   the caption goes underneath. */
.pdf-sigrow { display: flex; align-items: flex-end; gap: 10px; width: 100%; margin: 2px 0; }
.pdf-sigrow__cell { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.pdf-sigrow__box {
  width: 100%; min-height: 22px;
  border-bottom: 1px solid var(--pdf-line);
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 2px; text-align: center; font-size: 10pt;
}
.pdf-sigrow__box--sig { min-height: 52px; }
.pdf-sigrow__box img { max-height: 50px; max-width: 100%; object-fit: contain; }
.pdf-sigrow__box .pdf-fill { border-bottom: 0; min-width: 0; padding: 0; }
.pdf-sigrow__cell .pdf-sign__label { margin-top: 2px; }

/* ---- misc ---- */
.pdf-divider { border: 0; border-top: 1px solid #999; margin: 8px 0; }
.pdf-spacer { width: 100%; }

/* Variables in the header read as plain text, not as fill-in lines. */
.pdf-headerband .pdf-fill { border-bottom: 0; min-width: 0; padding: 0; }

/* ---- verdict chips ---- */
.pdf-chip { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 8.5pt; font-weight: 600; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pdf-chip--pass { background: #E4ECF8; color: #1B3F7A; }
.pdf-chip--fail { background: #FBE6E4; color: #A1231D; }
.pdf-chip--warn { background: #FDF3E6; color: #9A5B06; }
.pdf-chip--none, .pdf-chip--neutral { color: #8A93A8; }

/* ---- results table / a step's fields ---- */
.pdf-table th, .pdf-table td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pdf-table thead { display: table-header-group; }
.pdf-keep, .pdf-table tr { break-inside: avoid; }
.pdf-results td, .pdf-stepfields td { font-size: 9.5pt; }
.pdf-results__step { font-weight: 600; text-align: right !important; }
.pdf-results__note { text-align: right !important; color: var(--pdf-soft); }
.pdf-results__empty { color: #8A93A8; font-style: italic; }
.pdf-results__fieldsrow td { border-top: 0; background: #FAFBFD; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pdf-results__fields { display: flex; flex-wrap: wrap; gap: 2px 14px; text-align: right; font-size: 8.5pt; }
.pdf-results__flabel { color: var(--pdf-soft); }
.pdf-results__fnote { color: var(--pdf-soft); font-style: italic; }
.pdf-stepfields__label { text-align: right !important; font-weight: 600; }
.pdf-stephead { font-size: 10pt; margin: 6px 0 3px; }
.pdf-placeholder { color: #aab1c0; border: 1px dashed #c4c9d4; padding: 10px; text-align: center; font-size: 9pt; }

/* ---- photos ---- */
.pdf-photos { display: grid; gap: 3mm; margin: 4px 0; }
.pdf-photo { margin: 0; display: flex; flex-direction: column; align-items: center; }
.pdf-photo__frame { width: 100%; border: 1px solid var(--pdf-border); display: flex; align-items: center; justify-content: center; overflow: hidden; background: #fff; }
.pdf-photo__frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
.pdf-photo figcaption { font-size: 8pt; color: var(--pdf-soft); margin-top: 2px; text-align: center; }

/* ---- draft mark (a report not final yet) ---- */
.pdf-draftmark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 96pt; font-weight: 800; color: rgba(200, 48, 42, .10); transform: rotate(-24deg); pointer-events: none; z-index: 0; }

/* numbers/latin inside RTL flow keep their own direction */
bdi { unicode-bidi: isolate; }

/* ================================================================ official document */

/* letterhead */
.pdf-headerband { margin-bottom: 4mm; }
.pdf-header { margin-inline: 0; align-items: center; }
.pdf-header__side { width: 26mm; }
.pdf-header__logo { max-height: 22mm; max-width: 24mm; }
.pdf-org { white-space: pre-wrap; text-align: center; font-size: 12.5pt; line-height: 1.35; }
.pdf-rule { border-top: 2.2pt solid #000; border-bottom: .6pt solid #000; height: 3.2pt; margin: 2.5mm 0 3mm; }
.pdf-docmeta { white-space: pre-wrap; font-size: 11pt; line-height: 1.45; width: fit-content; margin-inline-start: auto; text-align: right; }
.pdf-title { font-size: 16pt; font-weight: 700; text-align: center; margin-top: 5mm; color: #000; }
.pdf-subtitle { font-size: 12pt; color: #000; text-align: center; margin-top: 1mm; }

/* numbered sections: "1. פרטי הפריט" */
.pdf-section { font-size: 13pt; margin: 6mm 0 2mm; }
.pdf-section--num { font-weight: 700; }
.pdf-section--num::before { counter-increment: pdfsec; content: counter(pdfsec) ".\\00a0"; }
.pdf-section--box { border: .75pt solid #000; background: var(--pdf-head); border-radius: 0; padding: 1mm 2.5mm; }

/* A heading never ends a page: it moves with the block after it. */
.pdf-block:has(> .pdf-section), .pdf-block:has(> .pdf-spacer) { break-after: avoid; page-break-after: avoid; }
.pdf-block:has(> .pdf-sigrow), .pdf-block:has(> .pdf-sign) { break-inside: avoid; }

/* ruled tables */
.pdf-table th, .pdf-table td { border: .75pt solid #000; padding: 1.2mm 2mm; font-size: 11pt; }
.pdf-table th { background: var(--pdf-head); font-weight: 700; }
.pdf-results td, .pdf-stepfields td { font-size: 10.5pt; }
.pdf-results__fieldsrow td { background: #fff; }
.pdf-results__fields { font-size: 9.5pt; }
.pdf-details th { text-align: right; vertical-align: top; }
.pdf-details td { text-align: right; }
.pdf-details .pdf-fill { border-bottom: 0; min-width: 0; padding: 0; }
.pdf-table .pdf-fill { border-bottom: 0; min-width: 0; padding: 0; }

/* verdicts are words, in black: ✓ תקין / ✕ לא תקין (underlined) */
.pdf-chip, .pdf-chip--pass, .pdf-chip--warn, .pdf-chip--fail, .pdf-chip--none, .pdf-chip--neutral { background: none; color: #000; padding: 0; border-radius: 0; font-size: inherit; }
.pdf-chip--fail { text-decoration: underline; }

/* fill-ins and signature lines */
.pdf-fill { border-bottom: .75pt dotted #000; }
.pdf-sign__box, .pdf-sigrow__box { border-bottom: .75pt solid #000; }
.pdf-sign__label { color: #000; font-size: 9.5pt; }
.pdf-photo__frame { border: .75pt solid #000; }
.pdf-photo figcaption { color: #000; }
.pdf-draftmark { color: rgba(0, 0, 0, .07); }
`;
