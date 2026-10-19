"use client";
import * as React from "react";
import SignatureCanvas from "react-signature-canvas";
import { FileText, PenLine } from "lucide-react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@/components/ui";
import ShipmentSignatureField from "@/app/components/shipments/ShipmentSignatureField";
import { apiFetch } from "@/lib/api/client";
import { withBasePath } from "@/lib/base-path";
import { formatMoment } from "../../format";

/**
 * The item's PDF report on its history page (docs/ITEM_REPORTS.md):
 *   - "דוח PDF" opens the report — a draft while the item is on its route, the
 *     locked final copy once it finished (and was signed, when the template asks);
 *   - "חתימה על הדוח" appears on a finished item whose template has a
 *     hand-drawn signature not given yet: the dialog shows the report as it
 *     will be locked, takes the signature, and locks it.
 * Nothing renders when the item's route has no report template.
 */

type ReportStatus = {
  state: "no_template" | "in_progress" | "awaiting_signature" | "final";
  finished: boolean;
  needsSignature: boolean;
  signedBy: string | null;
  signedAt: string | null;
  version: number;
  canSign: boolean;
};

const STATE_TEXT: Record<Exclude<ReportStatus["state"], "no_template">, string> = {
  in_progress: "טיוטה — הפריט עדיין במסלול",
  awaiting_signature: "ממתין לחתימה",
  final: "דוח סופי, נעול",
};

export default function ItemReportControl({ itemId }: { itemId: string }) {
  const [status, setStatus] = React.useState<ReportStatus | null>(null);
  const [signOpen, setSignOpen] = React.useState(false);

  // A failed read just leaves the button out.
  const fetchStatus = React.useCallback(
    () =>
      apiFetch(`/api/item-reports/${itemId}/status`)
        .then((res) => (res.ok ? (res.json() as Promise<ReportStatus>) : null))
        .catch(() => null),
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
        {STATE_TEXT[status.state]}
        {status.state === "final" && status.signedBy ? ` · נחתם ע״י ${status.signedBy}${status.signedAt ? ` ב-${formatMoment(status.signedAt)}` : ""}` : ""}
      </span>
      {status.state === "awaiting_signature" && status.canSign ? (
        <Button size="small" variant="contained" startIcon={<PenLine size={14} />} onClick={() => setSignOpen(true)}>
          חתימה על הדוח
        </Button>
      ) : null}
      <Button size="small" variant="outlined" startIcon={<FileText size={14} />} onClick={() => window.open(pdfHref, "_blank", "noopener")}>
        {status.state === "final" ? "דוח PDF" : "טיוטת דוח PDF"}
      </Button>
      {signOpen ? (
        <SignReportDialog
          itemId={itemId}
          onClose={() => setSignOpen(false)}
          onSigned={() => {
            setSignOpen(false);
            void load();
            window.open(pdfHref, "_blank", "noopener");
          }}
        />
      ) : null}
    </div>
  );
}

function SignReportDialog({ itemId, onClose, onSigned }: { itemId: string; onClose: () => void; onSigned: () => void }) {
  const canvasRef = React.useRef<SignatureCanvas | null>(null);
  const [signed, setSigned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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

  const submit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/item-reports/${itemId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: canvas.getCanvas().toDataURL("image/png") }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        throw new Error(
          body?.code === "ALREADY_SIGNED"
            ? "הדוח כבר נחתם."
            : body?.code === "ALREADY_FINAL"
              ? "הדוח כבר סופי ונעול."
              : body?.code === "NOT_FINISHED"
                ? "הפריט עוד לא סיים את המסלול."
                : "החתימה לא נשמרה. נסה שוב.",
        );
      }
      onSigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "החתימה לא נשמרה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} maxWidth="md" fullWidth>
      <DialogTitle>חתימה על דוח פריט #{itemId}</DialogTitle>
      <DialogContent>
        <p style={{ margin: "0 0 var(--space-sm)", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
          אחרי החתימה הדוח ננעל: הוא לא ישתנה, גם אם התבנית או פרטי העובדים ישתנו.
        </p>
        <div style={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-sm)", height: 360, overflow: "hidden", background: "var(--color-canvas-parchment)", marginBottom: "var(--space-md)" }}>
          {html ? (
            <iframe title="תצוגת הדוח" srcDoc={html} sandbox="" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />
          ) : (
            <div style={{ padding: "var(--space-md)", color: "var(--color-ink-muted-48)", fontSize: "var(--text-small)" }}>טוען את הדוח…</div>
          )}
        </div>
        <ShipmentSignatureField canvasRef={canvasRef} signed={signed} onSignedChange={setSigned} hint="יש לחתום לפני נעילת הדוח" />
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={busy}>ביטול</Button>
        <Button variant="contained" startIcon={<PenLine size={16} />} disabled={!signed} loading={busy} onClick={submit}>
          חתימה ונעילת הדוח
        </Button>
      </DialogActions>
    </Dialog>
  );
}
