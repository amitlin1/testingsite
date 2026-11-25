"use client";
import * as React from "react";
import { deleteItemFile, uploadItemFiles } from "@/lib/api/direct-upload";
import type { DraftShot } from "@/app/lib/station-fields/evaluate";
import type { PassFailValue } from "@/app/testing/fields/PassFail";

/** The worker's verdict: pass / fail ("" until chosen) and a note. */
export type Verdict = { ok: PassFailValue; note: string };
export const emptyVerdict = (): Verdict => ({ ok: "", note: "" });

/** A photo group and its verdict. */
export type Photos = Verdict & { photos: DraftShot[] };
export const emptyPhotos = (): Photos => ({ photos: [], ok: "", note: "" });

/** The object keys of the shots that reached storage. */
export const shotKeys = (ph: Photos) => ph.photos.map((s) => s.objectKey).filter(Boolean);

/** A shot list's update: a function of the shots as they are when it runs. */
export type SetShots = (fn: (shots: DraftShot[]) => DraftShot[]) => void;

/**
 * A station's shots on their way to storage (browser → MinIO, uploadItemFiles), tagged by photo
 * type, stored on a target item (the item, or a box and its items in the package wizards).
 *
 * - upload: one file → its object key, or null when it did not get there (the shot then reads
 *   failed and blocks finishing: a failed upload leaves nothing in storage).
 * - pick: the shot shows at once, uploading, and settles by its previewUrl (its key, or failed).
 * - remove: a shot removed on screen is taken back from storage too (deleteItemFile) — a landed
 *   shot at once, one still uploading as soon as it lands. Otherwise the removed photo stays among
 *   the item's attachments, and at the opening an item with one can no longer be marked "did not
 *   come".
 */
export function useShotUpload(workerId: number | null | undefined, stationTypeId: number) {
  const dropped = React.useRef<Set<string>>(new Set());

  const upload = React.useCallback(async (targetId: string | number, file: File, photoType: string | null): Promise<string | null> => {
    if (photoType === null) return null;
    try {
      const [result] = await uploadItemFiles(targetId, [file], { workerId, stationTypeId, photoType });
      if (!result?.objectKey) console.error("station photo upload failed", result?.error);
      return result?.objectKey ?? null;
    } catch (e) {
      console.error("station photo upload failed", e);
      return null;
    }
  }, [workerId, stationTypeId]);

  const pick = React.useCallback((targetId: string | number, file: File, photoType: string | null, setShots: SetShots) => {
    const previewUrl = URL.createObjectURL(file);
    setShots((shots) => [...shots, { previewUrl, uploading: true }]);
    void upload(targetId, file, photoType).then((key) => {
      if (dropped.current.delete(previewUrl)) {
        if (key) void deleteItemFile(targetId, key, workerId);
        return;
      }
      setShots((shots) => shots.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false, failed: key == null } : s)));
    });
  }, [upload, workerId]);

  const remove = React.useCallback((targetId: string | number, shot: DraftShot | undefined) => {
    if (!shot) return;
    if (shot.objectKey) void deleteItemFile(targetId, shot.objectKey, workerId);
    else if (shot.uploading) dropped.current.add(shot.previewUrl);
  }, [workerId]);

  return { upload, pick, remove };
}
