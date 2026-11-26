"use client";
import * as React from "react";
import SignatureCanvas from "react-signature-canvas";
import { FileText, PenLine, UserCheck } from "lucide-react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@/components/ui";
import SignaturePad from "@/components/SignaturePad";
import { ApiError, apiFetch, getJson, sendJson } from "@/lib/api/client";
import { failureText } from "@/app/components/failureText";
import { withBasePath } from "@/lib/base-path";
import { closingBlocksExternalApproval, closingMissingAfterExternal, closingMissingOnItemPage, externalApprovalOpen, type ReportState, type ReportStatusResponse } from "@/app/lib/item-report/contract";
import { formatMoment } from "@/app/lib/datetime";

/**
 * The item's PDF report on its history page (docs/features/ITEM_REPORTS.md):
 *   - "דוח PDF" opens the report — a draft while the item is on its route, the
 *     locked final copy once it finished (and was signed, when the template asks);
 *   - "חתימה סופית על הדוח" appears on a finished item whose template asks for
 *     the approver's final signature not given yet: the dialog shows the report
 *     as it will be locked, takes the signature, and locks it;
 *   - "אישור גורם חיצוני" appears beside it when that report came out "לא תקין": a manager shows it
 *     to someone outside the system who passes the item — name, role / body, reason, signature.
 *     The failed tests become "תקין" and the report locks with it (no final signature after it);
 *   - "חתימה בסגירה" appears beside it while the closing signature is missing
 *     (the box was closed before the template had it, or it was skipped): a
 *     tester or a manager gives it here after the fact; it does not lock. Signing
 *     the final one first warns that the closing spot then stays blank for good.
 * Nothing renders when the item's route has no report template.
 */

type SignKind = "final" | "closing";

const STATE_TEXT: Record<Exclude<ReportState, "no_template">, string> = {
  in_progress: "טיוטה — הפריט עדיין במסלול",
  awaiting_signature: "ממתין לחתימה הסופית",
  final: "דוח סופי, נעול",
};

/** "נחתם בסגירה ע״י … · נחתם סופית ע״י …" — the signatures the report carries. */
function signedLine(s: ReportStatusResponse): string {
  const parts: string[] = [];
  if (s.closingSignedBy) parts.push(`נחתם בסגירה ע״י ${s.closingSignedBy}${s.closingSignedAt ? ` ב-${formatMoment(s.closingSignedAt)}` : ""}`);
  if (s.signedBy) parts.push(`${s.needsClosingSignature ? "נחתם סופית" : "נחתם"} ע״י ${s.signedBy}${s.signedAt ? ` ב-${formatMoment(s.signedAt)}` : ""}`);
  if (s.externalApprovedBy) {
    parts.push(
      `אושר ע״י גורם חיצוני: ${s.externalApprovedBy}${s.externalApprovedRole ? ` (${s.externalApprovedRole})` : ""}` +
        `${s.externalApprovedAt ? ` ב-${formatMoment(s.externalApprovedAt)}` : ""}` +
        `${s.externalPresentedBy ? `, הוצג ע״י ${s.externalPresentedBy}` : ""}`,
    );
  }
  return parts.join(" · ");
}

export default function ItemReportControl({ itemId }: { itemId: string }) {
  const [status, setStatus] = React.useState<ReportStatusResponse | null>(null);
  const [signOpen, setSignOpen] = React.useState<SignKind | null>(null);
  const [externalOpen, setExternalOpen] = React.useState(false);

  // A failed read just leaves the button out.
  const fetchStatus = React.useCallback(
    () => getJson<ReportStatusResponse>(`/api/item-reports/${itemId}/status`).catch(() => null),
    [itemId],
  );
  const load = React.useCallback(async () => {
    const s = await fetchStatus();
    if (s) setStatus(s);
  }, [fetchStatus]);
  React.useEffect(() => {
    let alive = true;
    void fetchStatus().then((s) => {
      if (alive && s) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [fetchStatus]);

  if (!status || status.state === "no_template") return null;

  const pdfHref = withBasePath(`/api/item-reports/${itemId}`);
  const signed = signedLine(status);
  const missing = closingMissingOnItemPage(status);
  // An external approval locked it without the closing signature: it can still be added.
  const closingAfterExternal = closingMissingAfterExternal(status);
  const canApproveExternal = externalApprovalOpen(status) && status.canSign;
  // The closing signature comes first: the external approval locks the report.
  const externalWaitsForClosing = canApproveExternal && closingBlocksExternalApproval(status);
  // A column as narrow as its buttons, so the header keeps it beside the title: the state, who
  // signed (wrapping under it), then the buttons.
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
        {externalApprovalOpen(status) ? "הדוח יצא לא תקין · ממתין לאישור גורם חיצוני" : STATE_TEXT[status.state]}
      </span>
      {signed ? (
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", maxWidth: 340, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{signed}</span>
      ) : null}
      {missing || externalWaitsForClosing ? (
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-warning-ink)" }}>
          {externalWaitsForClosing ? "חסרה חתימה בסגירה · יש לחתום עליה לפני אישור הגורם החיצוני" : "חסרה חתימה בסגירה"}
        </span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap", justifyContent: "flex-end", marginTop: 4 }}>
        {missing && status.canSignClosing ? (
          <Button size="small" variant="outlined" startIcon={<PenLine size={14} />} onClick={() => setSignOpen("closing")}>
            חתימה בסגירה
          </Button>
        ) : null}
        {canApproveExternal ? (
          <Button size="small" variant="contained" startIcon={<UserCheck size={14} />} disabled={externalWaitsForClosing} onClick={() => setExternalOpen(true)}>
            אישור גורם חיצוני
          </Button>
        ) : null}
        {/* A report that came out "לא תקין" is locked by the external approval, in place of the final
            signature — only one of the two buttons shows. */}
        {status.state === "awaiting_signature" && status.canSign && !externalApprovalOpen(status) ? (
          <Button size="small" variant="contained" startIcon={<PenLine size={14} />} onClick={() => setSignOpen("final")}>
            חתימה סופית על הדוח
          </Button>
        ) : null}
        <Button size="small" variant="outlined" startIcon={<FileText size={14} />} onClick={() => window.open(pdfHref, "_blank", "noopener")}>
          {status.state === "final" ? "דוח PDF" : "טיוטת דוח PDF"}
        </Button>
      </div>
      {signOpen ? (
        <SignReportDialog
          itemId={itemId}
          kind={signOpen}
          closingMissing={missing}
          canSignClosing={status.canSignClosing}
          afterExternal={closingAfterExternal}
          onClose={() => setSignOpen(null)}
          onSigned={() => {
            const kind = signOpen;
            setSignOpen(null);
            void load();
            // The final signature locks the report: show the locked copy. The closing one does not —
            // unless it was added to a report the external approval had locked (frozen again with it).
            if (kind === "final" || closingAfterExternal) window.open(pdfHref, "_blank", "noopener");
          }}
        />
      ) : null}
      {externalOpen ? (
        <ExternalApprovalDialog
          itemId={itemId}
          onClose={() => setExternalOpen(false)}
          onApproved={() => {
            setExternalOpen(false);
            void load();
            // The approval locks the report: show the locked copy.
            window.open(pdfHref, "_blank", "noopener");
          }}
        />
      ) : null}
    </div>
  );
}

/** The report as it is now, in a frame (the signing dialogs). */
function useReportHtml(itemId: string): string | null {
  const [html, setHtml] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    apiFetch(`/api/item-reports/${itemId}?html=1`)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => alive && setHtml(t))
      .catch(() => alive && setHtml(null));
    return () => {
      alive = false;
    };
  }, [itemId]);
  return html;
}

function ReportFrame({ html }: { html: string | null }) {
  return (
    <div style={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-sm)", height: 360, overflow: "hidden", background: "var(--color-canvas-parchment)", marginBottom: "var(--space-md)" }}>
      {html ? (
        <iframe title="תצוגת הדוח" srcDoc={html} sandbox="" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />
      ) : (
        <div style={{ padding: "var(--space-md)", color: "var(--color-ink-muted-48)", fontSize: "var(--text-small)" }}>טוען את הדוח…</div>
      )}
    </div>
  );
}

function externalRefusalText(e: ApiError): string {
  switch (e.body.code) {
    case "ALREADY_APPROVED": return "הדוח כבר אושר ע״י גורם חיצוני.";
    case "ALREADY_SIGNED": return "הדוח כבר נחתם סופית.";
    case "ALREADY_FINAL": return "הדוח כבר סופי ונעול.";
    case "NOT_FINISHED": return "הפריט עוד לא סיים את המסלול.";
    case "NOT_FAILED": return "הדוח לא יצא לא תקין, אין מה לאשר.";
    case "CLOSING_MISSING": return "חסרה חתימה בסגירה. יש לחתום עליה לפני אישור הגורם החיצוני.";
  }
  if (e.status === 403) return "רק מנהל יכול להציג דוח לאישור גורם חיצוני.";
  if (e.status === 400) return "חסר שם או חתימה, או שהטקסט ארוך מדי.";
  return "האישור לא נשמר. נסה שוב.";
}

/**
 * "אישור גורם חיצוני": a manager shows a report that came out "לא תקין" to someone outside the
 * system, who examined the item and passes it — they write their name (required), their role / body
 * and reason (optional) and sign. The failed tests become "תקין" and the report locks, with no final
 * signature after it.
 */
function ExternalApprovalDialog({ itemId, onClose, onApproved }: { itemId: string; onClose: () => void; onApproved: () => void }) {
  const html = useReportHtml(itemId);
  const canvasRef = React.useRef<SignatureCanvas | null>(null);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [note, setNote] = React.useState("");
  const [signed, setSigned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = name.trim() !== "" && signed;

  const submit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/item-reports/${itemId}/approve-external`, "POST", {
        name: name.trim(),
        role: role.trim(),
        note: note.trim(),
        signature: canvas.getCanvas().toDataURL("image/png"),
      });
      onApproved();
    } catch (e) {
      setError(e instanceof ApiError ? externalRefusalText(e) : failureText(e, "האישור לא נשמר. נסה שוב."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} maxWidth="md" fullWidth>
      <DialogTitle>אישור גורם חיצוני לדוח פריט #{itemId}</DialogTitle>
      <DialogContent>
        <p style={{ margin: "0 0 var(--space-sm)", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
          הדוח יצא לא תקין. הגורם החיצוני בודק את הפריט, ואם הוא תקין רושם את שמו וחותם.
        </p>
        <ReportFrame html={html} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
          <TextField
            id="external-approval-name"
            label="שם מלא (חובה)"
            fullWidth
            size="small"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <TextField
            id="external-approval-role"
            label="תפקיד / גוף (לא חובה)"
            placeholder="לדוגמה: נציג היצרן"
            fullWidth
            size="small"
            value={role}
            maxLength={200}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
          />
        </div>
        <TextField
          id="external-approval-note"
          label="הערה / נימוק (לא חובה)"
          fullWidth
          multiline
          minRows={2}
          value={note}
          onChange={(e) => setNote((e.target as HTMLInputElement).value.slice(0, 2000))}
          disabled={busy}
          sx={{ mb: 2 }}
        />
        <SignaturePad canvasRef={canvasRef} signed={signed} onSignedChange={setSigned} hint="הגורם החיצוני חותם כאן" />
        <Alert severity="warning" sx={{ mt: 2 }}>
          באישור, כל הבדיקות שיצאו לא תקינות יסומנו כתקינות במערכת, והדוח יינעל עם האישור. לא תידרש חתימה סופית.
        </Alert>
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={busy}>ביטול</Button>
        <Button variant="contained" startIcon={<UserCheck size={16} />} disabled={!ready} loading={busy} onClick={submit}>
          אישור ונעילת הדוח
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const DIALOG_TEXT: Record<SignKind, { title: string; body: string; hint: string; submit: string; failed: string }> = {
  final: {
    title: "חתימה סופית על דוח פריט",
    body: "אחרי החתימה הדוח ננעל: הוא לא ישתנה, גם אם התבנית או פרטי העובדים ישתנו.",
    hint: "יש לחתום חתימה סופית לפני נעילת הדוח",
    submit: "חתימה סופית ונעילת הדוח",
    failed: "החתימה לא נשמרה. נסה שוב.",
  },
  closing: {
    title: "חתימה בסגירה על דוח פריט",
    body: "החתימה לא נועלת את הדוח. אחרי השמירה הוא ממתין לחתימה הסופית של מנהל. בדוח יופיעו השם שלך והתאריך של היום.",
    hint: "יש לחתום לפני השמירה",
    submit: "חתימה בסגירה",
    failed: "החתימה לא נשמרה. נסה שוב.",
  },
};

function refusalText(e: ApiError, kind: SignKind): string {
  switch (e.body.code) {
    case "ALREADY_SIGNED": return kind === "final" ? "הדוח כבר נחתם." : "הדוח כבר נחתם בסגירה.";
    case "ALREADY_FINAL": return "הדוח כבר סופי ונעול.";
    case "NOT_FINISHED": return "הפריט עוד לא סיים את המסלול.";
    case "NO_SIGNATURE_BLOCK": return kind === "final" ? "בתבנית של הדוח אין חתימה סופית." : "בתבנית של הדוח אין חתימה בסגירה.";
  }
  if (e.status === 403) return kind === "final" ? "רק מנהל חותם חתימה סופית." : "רק בודק או מנהל חותמים בסגירה.";
  return DIALOG_TEXT[kind].failed;
}

function SignReportDialog({ itemId, kind, closingMissing: missing, canSignClosing, afterExternal, onClose, onSigned }: {
  itemId: string;
  kind: SignKind;
  /** Final only: the closing spot is still blank — locking now leaves it blank for good. */
  closingMissing: boolean;
  canSignClosing: boolean;
  /** Closing only: the report is locked by an external approval; the signature is added to it. */
  afterExternal: boolean;
  onClose: () => void;
  onSigned: () => void;
}) {
  const T = kind === "closing" && afterExternal
    ? { ...DIALOG_TEXT.closing, body: "הדוח כבר אושר ע״י גורם חיצוני ונעול, בלי חתימה בסגירה. החתימה תתווסף לדוח, והוא יינעל מחדש עם שתי החתימות. בדוח יופיעו השם שלך והתאריך של היום." }
    : DIALOG_TEXT[kind];
  const warnBlank = kind === "final" && missing;
  const canvasRef = React.useRef<SignatureCanvas | null>(null);
  const [signed, setSigned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const html = useReportHtml(itemId);

  const submit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty()) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/item-reports/${itemId}/${kind === "final" ? "sign" : "sign-closing"}`, "POST", {
        signature: canvas.getCanvas().toDataURL("image/png"),
      });
      onSigned();
    } catch (e) {
      setError(e instanceof ApiError ? refusalText(e, kind) : failureText(e, T.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} maxWidth="md" fullWidth>
      <DialogTitle>{T.title} #{itemId}</DialogTitle>
      <DialogContent>
        <p style={{ margin: "0 0 var(--space-sm)", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
          {T.body}
        </p>
        {warnBlank ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            שורת הבודק ריקה: לדוח הזה לא ניתנה חתימה בסגירה. אחרי הנעילה אי אפשר להוסיף אותה.
            {canSignClosing ? " אפשר לחזור ולחתום קודם ב\"חתימה בסגירה\"." : " כדי למלא אותה, בקש מבודק לחתום ב\"חתימה בסגירה\" לפני החתימה הסופית."}
          </Alert>
        ) : null}
        <ReportFrame html={html} />
        <SignaturePad canvasRef={canvasRef} signed={signed} onSignedChange={setSigned} hint={T.hint} />
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={busy}>{warnBlank ? "חזרה" : "ביטול"}</Button>
        <Button variant="contained" startIcon={<PenLine size={16} />} disabled={!signed} loading={busy} onClick={submit}>
          {warnBlank ? "לנעול בלי חתימת בודק" : T.submit}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
