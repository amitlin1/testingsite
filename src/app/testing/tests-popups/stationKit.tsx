"use client";
import * as React from "react";
import {
  Dialog, DialogTitle, Box, Typography, Button, TextField, Stack, Alert,
  useMediaQuery,
} from "@/components/ui";
import { CheckCircle as CheckCircleIcon, Check as CheckIcon, Info as InfoIcon } from "@/components/ui/icons";
import type { QueueRow } from "@/app/lib/testing/contract";
import { NotesField, type NoteLook } from "../fields/NotesField";
import { PassFail, type PassFailValue } from "../fields/PassFail";
import { SkuPrefillNote } from "./referenceScan";
import { BLUE, GREEN, HAIR, INK, MUTED, PARCHMENT } from "@/components/ui/colors";
import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import "@/app/testing/station-popups.css";

/**
 * The item station popups' shared visual language (Shifthouse "3A" handoff): the dialog chrome
 * (rail + stepper + header + footer), the SKU screen, the verdict card and the photos section, so
 * every station popup reads as one system. Stateful styling (hover / focus / pressed) lives in
 * ../station-popups.css (`tst-*`).
 */

/** The system's instruction for this step — an info band (icon + message),
 *  no kicker label above it. */
export function SystemNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: "12px", bgcolor: "var(--color-primary-tint)", border: "1px solid var(--color-primary-border)", borderRadius: "var(--r-md)", p: "14px 16px" }}>
      <InfoIcon sx={{ fontSize: 20, color: BLUE, flexShrink: 0, mt: "1px" }} aria-hidden />
      <Typography sx={{ fontSize: "var(--text-body)", lineHeight: "var(--lh-body)", color: INK }}>{children}</Typography>
    </Box>
  );
}

/** Section header for the photos block: "תיעוד בתמונות" (or a template photo component's title)
 *  + soft divider line. */
export function PhotoSection({ children, title = TEMPLATE_DEFAULTS.photoTitle }: { children: React.ReactNode; title?: string }) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, pb: "12px", borderBottom: `1px solid ${HAIR}`, mb: 2 }}>
        <Typography component="h3" sx={{ m: 0, fontSize: "var(--text-lead)", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>{title}</Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Verdict + notes card — "בדיקה תקינה?" pass/fail + free-text notes.
 *  With station fields (route-fields spec §4.11.1–2, artboards 12/13): `suggestion`
 *  (the SuggestionLine) sits right under the pass/fail pair, 10px below it — and
 *  takes no room while it says nothing; `noteMax` turns the notes into a
 *  NotesField of that length, drawn as the popup's other notes (`noteLook`).
 *  Without them the card is exactly today's. */
export function VerdictCard({ ok, note, onOk, onNote, rows = 3, suggestion, noteMax, notePlaceholder = "הוסף הערה…", noteEditorTitle = "הערה · הערות", noteLook, question = TEMPLATE_DEFAULTS.verdictQuestion }: {
  ok: PassFailValue; note: string; onOk: (v: "pass" | "fail") => void; onNote: (v: string) => void; rows?: number;
  suggestion?: React.ReactNode; noteMax?: number; notePlaceholder?: string; noteEditorTitle?: string; noteLook?: NoteLook;
  /** The question over the pair — a template's verdict component may word it. */
  question?: string;
}) {
  const questionId = React.useId();
  const noteId = React.useId();
  return (
    <Box sx={{ border: `1px solid ${HAIR}`, borderRadius: "var(--r-card)", p: "20px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <Box>
        <Typography id={questionId} sx={{ fontSize: "var(--text-body)", fontWeight: 600, color: INK, mb: 1.5 }}>{question}</Typography>
        <PassFail value={ok} onChange={onOk} labelledBy={questionId} />
        {suggestion != null && suggestion !== false && <div className="tst-verdict-suggest">{suggestion}</div>}
      </Box>
      <Box>
        <label htmlFor={noteId} style={{ display: "block", fontSize: "var(--text-body)", fontWeight: 600, color: INK, marginBottom: 10 }}>הערות</label>
        {noteMax != null ? (
          <NotesField size="verdict" id={noteId} value={note} onChange={onNote} max={noteMax} look={noteLook}
            placeholder={notePlaceholder} editorTitle={noteEditorTitle} />
        ) : (
          <TextField id={noteId} value={note} onChange={(e) => onNote(e.target.value)} placeholder="הוסף הערה…" multiline rows={rows} fullWidth />
        )}
      </Box>
    </Box>
  );
}

/** The manufacturer-SKU scan screen body — shared by every station's first step.
 *  A code, so the field is LTR, kept at the reading edge. The station starts it
 *  from the item's last scanned SKU (`prev`, QueueRow.last_sku); the item's
 *  serial shows under it. */
export function SkuScreen({ value, onChange, prev, serial }: {
  value: string; onChange: (v: string) => void; prev?: string | null; serial?: string | null;
}) {
  return (
    <Stack spacing={1.5}>
      <SystemNote>יש לסרוק את מק״ט היצרן של המוצר. פרטי הסריקה נשמרים במערכת ובדו״ח.</SystemNote>
      <div>
        <TextField autoFocus label="מק״ט יצרן" value={value} onChange={(e) => onChange(e.target.value)} placeholder="סרוק או הזן מק״ט…" fullWidth
          dir="ltr" inputProps={{ style: { textAlign: "right" } }} />
        <SkuPrefillNote value={value} prev={prev} serial={serial} />
      </div>
    </Stack>
  );
}

export type ShellPhase = { key: string; title: string; desc: string };

/**
 * StationShell — the station wizards' dialog chrome, laid out like the package
 * wizard shell (PackageWizardShell / design/Package Stations.dc.html) so both
 * kinds of wizard on the station screen read as one: a 268px rail (station,
 * item card, numbered steps, worker) on desktop, step chips on tablet/phone,
 * the step title + counter at the top of the body, and a footer of
 * יציאה / הקודם / המשך — the green finish button on the last phase.
 * The per-station flow supplies the phases, nav callbacks and the current body.
 */
export function StationShell({
  onClose, item, workerId, workerName, contextLabel, stationName,
  phases, currentIndex, onStep, onBack,
  error, onClearError,
  busy, submitting, canNext, onNext, canFinish, onFinish, finishLabel,
  children,
}: {
  onClose: () => void;
  item: QueueRow; workerId: number | null; workerName: string;
  /** The station kind (the station type's name): the rail's title. */
  contextLabel: string;
  /** The concrete station, shown under the title. */
  stationName?: string;
  phases: ShellPhase[]; currentIndex: number;
  onStep: (i: number) => void; onBack: () => void;
  error: string | null; onClearError: () => void;
  busy: boolean; submitting: boolean;
  canNext: boolean; onNext: () => void;
  canFinish: boolean; onFinish: () => void; finishLabel: string;
  children: React.ReactNode;
}) {
  const isWide = useMediaQuery("(min-width: 900px)");   // ≥ 900px → rail
  const isMobile = useMediaQuery("(max-width: 599px)"); // < 600px → full-screen

  const itemName = item.model?.trim() || `פריט #${item.item_id}`;
  const phase = phases[currentIndex];
  const isLast = currentIndex === phases.length - 1;
  const counter = `שלב ${currentIndex + 1} מתוך ${phases.length}`;
  const workerLine = `עובד: ${workerId != null ? workerName || `#${workerId}` : "—"}`;

  return (
    <Dialog open onClose={onClose} maxWidth={false} fullScreen={isMobile}
      PaperProps={{
        sx: {
          width: isMobile ? "100vw" : isWide ? "min(1040px, 96vw)" : "94vw",
          height: isMobile ? "100dvh" : isWide ? "min(720px, 92vh)" : "94vh",
          maxWidth: "none", maxHeight: "none",
          boxShadow: isMobile ? "none" : "var(--shadow-modal)",
          display: "flex", flexDirection: isWide ? "row" : "column",
        },
      }}>
      {/* Rail (desktop) — station, item card, numbered steps, worker */}
      {isWide && (
        <Box sx={{ width: 268, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "20px 18px", minHeight: 0, overflowY: "auto" }}>
          <div data-drag-handle="">
            <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 700, color: INK, lineHeight: "var(--lh-snug)" }}>{contextLabel}</Typography>
            {stationName && <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "3px" }}>{stationName}</Typography>}
          </div>

          <Box sx={{ bgcolor: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: "var(--r-md)", p: "12px 14px", mt: "14px" }}>
            <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, color: INK }}>{itemName}</Typography>
            <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "4px" }}>#{item.item_id}{item.makat != null ? ` · מק״ט ${item.makat}` : ""}</Typography>
            {(item.customer_code || item.serial_no) && (
              <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "2px" }}>
                {item.customer_code ? `לקוח ${item.customer_code}` : ""}{item.customer_code && item.serial_no ? " · " : ""}{item.serial_no ? `S/N ${item.serial_no}` : ""}
              </Typography>
            )}
          </Box>

          <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {phases.map((ph, i) => {
              const done = i < currentIndex;
              const on = i === currentIndex;
              return (
                <li key={ph.key}>
                  <button type="button" className="tst-wiz-step" onClick={() => onStep(i)}
                    aria-current={on ? "step" : undefined} aria-label={`${i + 1}. ${ph.title}${done ? " — הושלם" : ""}`}>
                    <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-micro)", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                      background: on ? BLUE : done ? "var(--color-success-bg)" : "var(--color-canvas)", color: on ? "var(--color-on-primary)" : done ? GREEN : MUTED, border: `1px solid ${on ? BLUE : HAIR}` }}>
                      {done ? <CheckIcon sx={{ fontSize: 12 }} aria-hidden /> : i + 1}
                    </span>
                    <span style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: on ? BLUE : INK }}>{ph.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Typography sx={{ mt: "auto", pt: "14px", fontSize: "var(--text-fine)", color: MUTED }}>{workerLine}</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: isMobile ? "18px 18px 20px" : "24px 28px" }}>
          {/* Step title + counter (the title is the dialog's accessible name) */}
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <DialogTitle style={{ display: "block", padding: 0, fontSize: "var(--text-title)", fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {phase.title}
              </DialogTitle>
              <Typography sx={{ fontSize: "var(--text-body-sm)", color: MUTED, mt: "5px", lineHeight: 1.5 }}>
                {isWide ? phase.desc : `${contextLabel} · ${itemName}`}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: "var(--text-small)", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{counter}</Typography>
          </Box>

          {/* Step chips (tablet/phone) */}
          {!isWide && (
            <Box sx={{ display: "flex", gap: 1, overflowX: "auto", mt: "14px", pb: "2px" }}>
              {phases.map((ph, i) => {
                const on = i === currentIndex;
                const done = i < currentIndex;
                return (
                  <button key={ph.key} type="button" className="tst-wiz-chip" onClick={() => onStep(i)}
                    aria-current={on ? "step" : undefined} data-done={done ? "" : undefined}>
                    {i + 1}. {ph.title}
                  </button>
                );
              })}
            </Box>
          )}

          <Box sx={{ mt: "20px" }}>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={onClearError}>{error}</Alert>}
            {children}
          </Box>
        </Box>

        <Box sx={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, p: isMobile ? "12px 18px" : "14px 28px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {!isWide && <Typography sx={{ fontSize: "var(--text-small)", color: MUTED }}>{workerLine}</Typography>}
          <Box sx={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
            <Button variant="outlined" color="inherit" className="tst-wiz-btn" onClick={onClose}>יציאה</Button>
            <Button variant="outlined" color="inherit" className="tst-wiz-btn" onClick={onBack} disabled={submitting || currentIndex === 0}>הקודם</Button>
            {isLast ? (
              <Button color="success" className="tst-wiz-btn" onClick={onFinish} disabled={!canFinish} loading={submitting}
                startIcon={<CheckCircleIcon fontSize={18} aria-hidden />}>
                {submitting ? "שומר…" : finishLabel}
              </Button>
            ) : (
              <Button className="tst-wiz-btn" onClick={onNext} disabled={!canNext} loading={busy}>המשך</Button>
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
