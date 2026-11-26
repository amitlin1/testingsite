import { ApiError } from "@/lib/api/client";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";
import type { DraftShot, Drafts } from "@/app/lib/station-fields/evaluate";
import type { Field } from "@/app/lib/station-fields/schema";
import type { ResultAnswer, ResultBody } from "@/app/lib/testing/contract";
import { postResult } from "@/app/testing/api";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { nextStopOf, type NextStop } from "./nextStation";

/**
 * What the four box wizards share without markup — the opening and the closing, each as the code's
 * wizard and as its template twin (docs/features/popup-templates/PLAN.md §5): their common words, and the
 * finish's per-item results.
 */

export const PACKAGE_POPUP_TEXT = {
  notes: "הערות",
  optional: "אופציונלי",
  doneStep: "סיום",
  boxScanLabel: "מק״ט המארז",
  boxScanPlaceholder: "סרוק את מק״ט היצרן",
  boxScanSubtitle: "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה.",
  boxScanBand: "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה.",
  boxNoReference: "לא נמצא פריט ייחוס למק״ט המארז שנסרק — צלם לפי שיקול דעת והמשך.",
  photoFailed: "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום.",
  photoUploading: "יש צילום שעדיין עולה — המתן לסיום ההעלאה.",
  removeFailedShot: "הסר את הצילום שנכשל",
} as const;

/** A step blocked only while something answers (a lookup, the fields): the next button waits, and
 *  no error is shown. */
export const CHECKING = "checking";

/** The shots taken in the photo fields among `defs` (station fields). */
export const fieldShots = (defs: readonly Field[], drafts: Readonly<Drafts>): DraftShot[] =>
  defs.flatMap((d) => (d.type === "photo" ? drafts[d.id]?.photos ?? [] : []));

/** Who records a box wizard's results, and the submit id the box and all its items share. */
export type BoxResultCtx = { stationId: number; workerId: number | null; workerName: string; submitId: string };

/** One item's result body in a box wizard: the item at this station, by this worker, under the
 *  box's submit id. */
export function itemResultBody(
  ctx: BoxResultCtx,
  it: Pick<PackageItemView, "item_id">,
  result: Omit<ResultBody, "ItemID" | "StationID" | "WorkerID" | "WorkerName" | "SubmitID">,
): ResultBody {
  return {
    ItemID: Number(it.item_id), StationID: ctx.stationId, WorkerID: ctx.workerId ?? undefined, WorkerName: ctx.workerName || undefined, SubmitID: ctx.submitId,
    ...result,
  };
}

/** The items a finish already sent — kept across a retry of it — and where each goes next. */
export type SentItems = { committed: Set<string>; nextStops: Map<string, NextStop> };

/**
 * A box wizard's finish, item by item before the box's own result: one POST per item, in order. An
 * item already committed — by an earlier try of this finish, or an earlier opening — is skipped,
 * so a retry never moves an item twice. A refusal throws the line that names the item (and asks
 * the station fields again on a 409 FIELDS_SCHEMA_MISMATCH); a network failure is rethrown as it is.
 */
export async function postItemResults<T extends Pick<PackageItemView, "item_id" | "serial_no" | "package_seq">>(
  items: readonly T[],
  sent: SentItems,
  bodyOf: (it: T) => ResultBody,
  reloadFields: () => void,
  onAnswer?: (it: T, answer: ResultAnswer) => void,
): Promise<void> {
  for (const it of items) {
    if (sent.committed.has(it.item_id)) continue;
    let answer: ResultAnswer;
    try {
      answer = await postResult(bodyOf(it));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (shouldReloadFields(e)) reloadFields();
      throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${e.body.error ? ` — ${e.body.error}` : ` (${e.status})`}`);
    }
    sent.nextStops.set(it.item_id, nextStopOf(answer));
    onAnswer?.(it, answer);
    sent.committed.add(it.item_id);
  }
}
