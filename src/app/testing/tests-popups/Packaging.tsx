"use client";
import * as React from "react";
import { Stack, Box, Typography, Chip } from "@/components/ui";
import { Check as CheckIcon } from "@/components/ui/icons";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import {
  type Photos, emptyPhotos, SkuScreen, SystemNote, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
  BLUE, OK, INK, MUTED, MUTED_LT, HAIR,
} from "./stationKit";

/** One line in the packing checklist — the scanned item plus everything connected to it. */
type PackRow = { itemId: number; label: string; serialNo: string | null; isParent: boolean };

/**
 * עמדת אריזה (test_station_type_id 6) — סריקת מק״ט יצרן → סימון כל פריט שנארז
 * מתוך סה״כ הפריטים במארז (פריט אב + הנלווים) → אישור תקינות.
 *
 * The package is the whole item group: the scanned item plus its `connected_items`
 * (which /api/testing/items resolves to the parent + siblings, or the children —
 * either way the group minus self, so total = connected + 1, the same arithmetic
 * the intake wizard's count step uses). No photos are captured here.
 */
export default function Packaging({
  open, onClose, item, workerId, workerName, onSubmit,
}: StationTestDialogProps) {
  const [phaseIdx, setPhaseIdx] = React.useState(0); // 0 = sku, 1 = pack
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [skuScan, setSkuScan] = React.useState("");
  const [packedIds, setPackedIds] = React.useState<number[]>([]);
  const [verdict, setVerdict] = React.useState<Photos>(emptyPhotos()); // reuse ok/note (photos unused)

  // `connected_items` carries only item_id + serial_no from the items query, so
  // accessories fall back to a generic label (same as the intake wizard).
  const rows: PackRow[] = React.useMemo(() => {
    const parentId = item.parent_item_id ?? item.item_id;
    const self: PackRow = {
      itemId: item.item_id,
      label: item.model?.trim() || item.item_type_desc?.trim() || "פריט",
      serialNo: item.serial_no,
      isParent: item.item_id === parentId,
    };
    const others = (item.connected_items ?? []).map((ci): PackRow => ({
      itemId: ci.item_id,
      label: ci.item_type_desc?.trim() || "פריט נלווה",
      serialNo: ci.serial_no,
      isParent: ci.item_id === parentId,
    }));
    return [self, ...others];
  }, [item]);

  const total = rows.length;
  const accessoryCount = total - 1;
  const packedCount = packedIds.length;
  const allPacked = packedCount === total;

  React.useEffect(() => {
    if (!open) return;
    setPhaseIdx(0); setError(null); setSkuScan(""); setPackedIds([]); setVerdict(emptyPhotos());
  }, [open, item]);

  const phases: ShellPhase[] = [
    { key: "sku", title: SKU_TITLE, desc: SKU_DESC },
    { key: "pack", title: "אריזת המארז", desc: "סמן כל פריט שנארז ואשר את תקינות האריזה." },
  ];

  const onNext = () => { setError(null); setPhaseIdx(1); };
  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };
  const onStep = (i: number) => { setError(null); setPhaseIdx(i); };

  const togglePacked = (id: number) =>
    setPackedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const pass = verdict.ok === "pass";
  // "תקין" requires the whole package to be packed; a missing item is still
  // reportable — mark "לא תקין" and explain in the notes.
  const canFinish =
    skuScan.trim().length > 0 && verdict.ok !== "" && (allPacked || verdict.ok === "fail");

  const onFinish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    if (verdict.ok === "") { setError("לא ניתן לסיים — יש לציין אם הבדיקה תקינה"); return; }
    if (!allPacked && verdict.ok === "pass") {
      setError(`לא ניתן לסמן תקין — נארזו ${packedCount} מתוך ${total} פריטים`);
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: verdict.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          station: "packaging",
          sku: skuScan,
          totalItems: total,
          accessoryCount,
          packedItemIds: packedIds,
          packedCount,
          allPacked,
          verdict: { ok: verdict.ok, note: verdict.note },
        },
      };
      await onSubmit(data);
      onClose();
    } catch { setError("שגיאה בשמירת הבדיקה"); } finally { setSubmitting(false); }
  };

  const message = accessoryCount > 0
    ? `נא לארוז ${total} פריטים — פריט אב + ${accessoryCount} ${accessoryCount === 1 ? "נלווה" : "נלווים"}.`
    : "נא לארוז את הפריט — לא רשומים פריטים נלווים במערכת.";

  return (
    <StationShell
      open={open} onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel="אריזה" phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={false} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel="סיום אריזה"
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} />
      ) : (
        <Stack spacing={3}>
          <SystemNote>{message}</SystemNote>

          {/* Packing checklist — progress bar + counter, then one row per item. */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.75 }}>
              <Box sx={{ flex: 1, display: "flex", gap: "6px" }}>
                {rows.map((r) => (
                  <Box key={r.itemId} sx={{ flex: 1, height: 4, borderRadius: "9999px", bgcolor: packedIds.includes(r.itemId) ? OK : HAIR }} />
                ))}
              </Box>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: allPacked ? OK : BLUE, whiteSpace: "nowrap", bgcolor: allPacked ? "rgba(31,138,91,0.10)" : "rgba(0,102,204,0.08)", borderRadius: "9999px", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
                {packedCount} / {total} נארזו
              </Typography>
            </Box>

            <Stack spacing={1}>
              {rows.map((row) => {
                const isPacked = packedIds.includes(row.itemId);
                return (
                  <Box key={row.itemId} onClick={() => togglePacked(row.itemId)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1.5, p: "12px 14px", borderRadius: "13px", cursor: "pointer",
                      border: `1.5px solid ${isPacked ? OK : HAIR}`,
                      bgcolor: isPacked ? "rgba(31,138,91,0.06)" : "#fff",
                      transition: "border-color 0.15s ease, background-color 0.15s ease",
                      "&:hover": { borderColor: isPacked ? OK : "#c7c7cf" },
                    }}>
                    <Box sx={{
                      width: 26, height: 26, flexShrink: 0, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center",
                      bgcolor: isPacked ? OK : "#fff", border: isPacked ? "none" : `1.5px solid ${HAIR}`, color: "#fff",
                    }}>
                      {isPacked && <CheckIcon sx={{ fontSize: 15 }} />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontSize: 15, fontWeight: 600, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.label}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: MUTED, mt: "2px" }}>
                        #{row.itemId}{row.serialNo ? ` · S/N ${row.serialNo}` : ""}
                      </Typography>
                    </Box>
                    {row.isParent && (
                      <Chip size="small" label="פריט אב"
                        sx={{ flexShrink: 0, bgcolor: "rgba(0,102,204,0.08)", color: BLUE, fontWeight: 600 }} />
                    )}
                  </Box>
                );
              })}
            </Stack>

            {!allPacked && (
              <Typography sx={{ fontSize: 12.5, color: MUTED_LT, mt: 1.25 }}>
                נותרו {total - packedCount} פריטים לסימון. ניתן לסיים עם &quot;לא תקין&quot; ולפרט בהערות אם פריט חסר.
              </Typography>
            )}
          </Box>

          <VerdictCard ok={verdict.ok} note={verdict.note}
            onOk={(v) => setVerdict((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setVerdict((pk) => ({ ...pk, note: v }))} />
        </Stack>
      )}
    </StationShell>
  );
}
