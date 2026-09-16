"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import type { StationTestDialogProps } from "@/types";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { newActionId } from "@/app/lib/metrics/action-id";
import PackageWizardShell, { type WizardStep } from "./PackageWizardShell";
import PackageDecisionDialog, { type PackDecision } from "./PackageDecisionDialog";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, FOCUS, GREEN, GREEN_BG, GREY, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG, fieldInput, seq2,
} from "@/app/components/packages/packageUi";

/**
 * אשף סגירת מארז — design/Package Stations.dc.html (close). Runs on a
 * package-level closing station for a PACKAGE row. Four steps: scan → items
 * and packing (arrived → "נארז"; not arrived → an explicit decision with a
 * note) → packing checks → done. "סגור מארז" records one result per arrived
 * item and then the box's, whose details carry the decisions
 * (docs/packages/PLAN.md §4, decision 5; DESIGN_REVIEW.md).
 */

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת הקופסה" },
  { key: "arrival", label: "פריטים ואריזה", note: "מצב הגעה + נארז" },
  { key: "packOk", label: "תקינות האריזה", note: "אישור סופי" },
  { key: "done", label: "סיום", note: "" },
];

const CHECKS = ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת הקופסה קריאה"];

type Decision = { decision: PackDecision; note: string };

export default function PackageCloseWizard({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const pkg = item.package as PackageView | null;
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState("");
  const [packed, setPacked] = React.useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [decideFor, setDecideFor] = React.useState<PackageItemView | null>(null);
  const [checks, setChecks] = React.useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  const committedRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    setStep(0); setScan(""); setPacked({}); setDecisions({}); setDecideFor(null); setChecks(CHECKS.map(() => false)); setNote("");
    setSubmitting(false); setError(null); submitIdRef.current = null; committedRef.current = new Set();
  }, [open, pkg]);

  if (!open || !pkg) return null;

  const items = pkg.items;
  const arrived = (it: PackageItemView) => it.arrived_at_closing;
  const resolved = (it: PackageItemView) => (arrived(it) ? packed[it.item_id] === true : decisions[it.item_id] != null);
  const allResolved = items.length > 0 && items.every(resolved);
  const checksAll = checks.every(Boolean);
  const stepKey = STEPS[step].key;
  const anyMissing = items.some((it) => decisions[it.item_id]?.decision === "missing");
  const scanMatches = scan.trim() !== "" && (scan.trim() === (item.makat ?? "").trim() || scan.trim().split("-")[0] === String(item.item_id));

  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת הקופסה כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "arrival") stepSubtitle = "סמן כל פריט שנארז. פריט שלא הגיע דורש החלטה מפורשת.";
  else if (stepKey === "packOk") stepSubtitle = "אישור סופי לפני סגירת המארז.";

  let nextLabel = "המשך";
  let nextEnabled = true;
  if (stepKey === "scan") nextEnabled = scan.trim() !== "";
  else if (stepKey === "arrival") { nextEnabled = allResolved; nextLabel = allResolved ? "המשך" : "נדרשת החלטה לכל פריט"; }
  else if (stepKey === "packOk") { nextEnabled = checksAll; nextLabel = "סגור מארז"; }
  else if (stepKey === "done") nextLabel = "סיום וחזרה לתור";

  const finish = async () => {
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    try {
      for (const it of items) {
        if (!arrived(it) || committedRef.current.has(it.item_id)) continue;
        const res = await apiFetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: Number(it.item_id), StationID: station.test_station_id, WorkerID: workerId ?? undefined, WorkerName: workerName || undefined, SubmitID: submitId,
            Result: 1, Passed: true, Details: { closing: true, packed: true, package_id: String(item.item_id) },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${d?.error ? ` — ${d.error}` : ` (${res.status})`}`);
        }
        committedRef.current.add(it.item_id);
      }
      await onSubmit({
        Result: anyMissing ? 0 : 1, Passed: !anyMissing, Comments: note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          sku: scan.trim(), closing: true, checks: CHECKS.map((label, i) => ({ label, ok: checks[i] })), note,
          packed: items.filter((it) => arrived(it) && packed[it.item_id]).map((it) => it.item_id),
          decisions: items.filter((it) => decisions[it.item_id]).map((it) => ({ item_id: it.item_id, decision: decisions[it.item_id].decision, note: decisions[it.item_id].note })),
        },
      });
      setStep(STEPS.length - 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "שגיאה בשמירת סגירת המארז");
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (stepKey === "packOk") { finish(); return; }
    if (stepKey === "done") { onClose(); return; }
    setStep((s) => s + 1);
  };
  const doneStep = stepKey === "done";

  return (
    <>
      <PackageWizardShell
        open={open} onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title="סגירת מארז" pkg={pkg} workerName={workerName}
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1) setStep(i); }}
        stepTitle={STEPS[step].label} stepSubtitle={stepSubtitle} stepCounter={`שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg} footNote="הכל נשמר בזמן אמת"
        backDisabled={step === 0 || doneStep} onBack={() => { setError(null); if (step > 0 && !doneStep) setStep((s) => s - 1); }}
        nextLabel={nextLabel} nextEnabled={nextEnabled} onNext={onNext} busy={submitting}
      >
        {error && (
          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid rgba(191,53,53,0.25)", borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} /></span>
            <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error}</div>
          </div>
        )}

        {stepKey === "scan" && (
          <div style={{ maxWidth: 420, marginTop: 20 }}>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>מק״ט המארז</div>
            <input value={scan} onChange={(e) => setScan(e.target.value)} autoFocus placeholder="סרוק את מדבקת הקופסה"
              onKeyDown={(e) => { if (e.key === "Enter") onNext(); }}
              style={{ ...fieldInput, height: 52, borderRadius: 11, fontSize: 17, fontVariantNumeric: "tabular-nums", letterSpacing: 1, borderColor: scan.trim() === "" ? HAIR : FOCUS }} />
            {scan.trim() !== "" && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, background: scanMatches ? GREEN_BG : AMBER_BG, border: `1px solid ${scanMatches ? "rgba(31,138,91,0.22)" : AMBER_BORDER}`, borderRadius: 11, padding: "12px 14px", marginTop: 12 }}>
                <span style={{ color: scanMatches ? GREEN : AMBER_INK, display: "inline-flex" }}>{scanMatches ? <Check size={18} strokeWidth={2} /> : <CircleAlert size={18} strokeWidth={2} />}</span>
                <div style={{ fontSize: 14, fontWeight: 600, color: scanMatches ? GREEN : AMBER_INK }}>
                  {scanMatches ? `זוהה ${pkg.item_type_desc} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}` : "הסריקה לא תואמת למק״ט או למזהה של המארז — בדוק שזו הקופסה הנכונה"}
                </div>
              </div>
            )}
          </div>
        )}

        {stepKey === "arrival" && (
          <div style={{ marginTop: 20 }}>
            <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden" }}>
              {items.map((it) => {
                const isArr = arrived(it);
                const d = decisions[it.item_id];
                const isPacked = packed[it.item_id] === true;
                return (
                  <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderBottom: `1px solid ${HAIR_2}`, background: isArr ? "#fff" : AMBER_BG, flexWrap: "wrap" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: isArr ? "#f5f5f7" : "rgba(168,106,26,0.1)", color: isArr ? MUTED : AMBER_INK, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                      <div style={{ fontSize: 12.5, color: isArr ? MUTED : AMBER_INK, marginTop: 2 }}>
                        {isArr ? `הגיע לסגירה · ${it.serial_no ?? "ללא סריאלי"}` : `לא הגיע · סיים את המסלול ${it.station_name ? `בעמדת ${it.station_name}` : "במקום אחר"}`}
                      </div>
                    </div>
                    {isArr ? (
                      <div onClick={() => setPacked((p) => ({ ...p, [it.item_id]: !isPacked }))} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 44, padding: "8px 14px", border: `1px solid ${isPacked ? BLUE : HAIR}`, background: isPacked ? "#e6efff" : "#fff", borderRadius: 11, cursor: "pointer" }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${isPacked ? BLUE : GREY}`, background: isPacked ? BLUE : "#fff", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{isPacked && <Check size={12} strokeWidth={2.5} />}</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: isPacked ? BLUE : INK }}>נארז</span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setDecideFor(it)} style={{ minHeight: 44, background: d == null ? "#fff" : d.decision === "packed_anyway" ? "#e6efff" : RED_BG, color: d == null ? AMBER_INK : d.decision === "packed_anyway" ? BLUE : RED, border: `1px solid ${d == null ? AMBER_BORDER : d.decision === "packed_anyway" ? BLUE : "rgba(191,53,53,0.25)"}`, borderRadius: 9999, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
                        {d == null ? "נדרשת החלטה" : d.decision === "packed_anyway" ? "נארז בכל זאת" : "חסר במארז"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {!allResolved && (
              <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "11px 14px", marginTop: 14 }}>אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת.</div>
            )}
          </div>
        )}

        {stepKey === "packOk" && (
          <div style={{ maxWidth: 620, marginTop: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {CHECKS.map((label, i) => {
                const on = checks[i];
                return (
                  <div key={label} onClick={() => setChecks((c) => c.map((v, j) => (j === i ? !v : v)))} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, border: `1px solid ${on ? BLUE : HAIR}`, background: on ? "#f7fbff" : "#fff", borderRadius: 12, padding: "13px 15px", cursor: "pointer" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 7, border: `1px solid ${on ? BLUE : GREY}`, background: on ? BLUE : "#fff", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={13} strokeWidth={2.5} />}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: on ? BLUE : INK }}>{label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, margin: "18px 0 7px" }}>הערות אריזה</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="אופציונלי" style={{ width: "100%", minHeight: 76, border: `1px solid ${HAIR}`, borderRadius: 11, padding: "11px 13px", fontSize: 14, resize: "vertical", outline: "none", fontFamily: "inherit" }} />
          </div>
        )}

        {stepKey === "done" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(31,138,91,0.09)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} /></span>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>המארז נסגר</div>
            <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>המארז והפריטים שבו סומנו כנארזו. המארז עובר לסטטוס הושלם ומופיע במשלוח כמארז שסיים.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
              {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: decisions[it.item_id]?.decision === "missing" ? RED : GREEN }} />)}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.filter((it) => decisions[it.item_id]?.decision !== "missing").length} פריטים נארזו · {pkg.item_type_desc}</div>
          </div>
        )}
      </PackageWizardShell>

      <PackageDecisionDialog
        open={decideFor != null}
        item={decideFor ? { package_seq: decideFor.package_seq, item_type_desc: decideFor.item_type_desc, station_name: decideFor.station_name } : null}
        onClose={() => setDecideFor(null)}
        onSave={(decision, n) => { if (decideFor) setDecisions((d) => ({ ...d, [decideFor.item_id]: { decision, note: n } })); setDecideFor(null); }}
      />
    </>
  );
}
