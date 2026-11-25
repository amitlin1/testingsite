"use client";
import * as React from "react";
import type { Field } from "@/app/lib/station-fields/schema";
import type { UploadFieldPhoto } from "@/app/testing/fields/FieldRow";
import { failureText } from "@/app/components/failureText";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { useFieldsState } from "@/app/testing/fields/useFieldsState";
import { findKitItem, kitItemDefs, useStationFields } from "@/app/testing/fields/useStationFields";
import { useShotUpload } from "./shots";

/** The item popups' refusal to finish without a worker picked in the screen's header. */
export const NO_WORKER_TEXT = "יש לבחור עובד בכותרת מסך הבדיקות";

/**
 * The station fields of the step an item popup opens on (route-fields spec §4.2–§4.3): the answer
 * (`sf`), the worker's drafts (`fx`), and `cfg` — the item config while it has fields to draw
 * (null without a config: the popup is exactly today's). `waiting`: the answer is still coming, or
 * failed — finishing waits (spec §4.2). `blocking`: waiting, or the fields' own gate (evaluate.ts
 * fieldsBlocking).
 */
export function useStepFields({ itemId, stationId, stationTypeId, workerId, enabled = true }: {
  itemId: number; stationId: number; stationTypeId: number; workerId: number | null;
  /** False in the settings preview: no fields are loaded. */
  enabled?: boolean;
}) {
  const sf = useStationFields(itemId, stationId, enabled);
  const ready = sf.status === "ready" && sf.mode === "item" ? sf : null;
  const fx = useFieldsState(ready ? ready.fields : []);
  const cfg = ready != null && fx.defsCount > 0 ? ready : null;
  const waiting = sf.status === "loading" || sf.status === "error";
  const { upload } = useShotUpload(workerId, stationTypeId);
  /** A photo field's shot goes to storage like any station photo, tagged with the field's photo
   *  type; null = it never got there (the shot reads failed). */
  const uploadFieldPhoto = React.useCallback<UploadFieldPhoto>((file, photoType) => upload(itemId, file, photoType), [upload, itemId]);
  const { reload } = sf;
  /** After a failed save: the text to show (failureText) — and on a 409 FIELDS_SCHEMA_MISMATCH
   *  (the route's fields changed while the popup was open) the fields load again, whatever the last
   *  answer was; the drafts stay, by FieldId. */
  const saveErrorText = React.useCallback((e: unknown, fallback: string): string => {
    if (shouldReloadFields(e)) reload();
    return failureText(e, fallback);
  }, [reload]);
  return {
    sf, fx, cfg, waiting,
    blocking: waiting || (cfg != null && fx.blocking(cfg.gate)),
    uploadFieldPhoto, saveErrorText,
  };
}

/**
 * The station fields of a package wizard (route-fields spec §4.11.3–§4.11.5): asked on the box row,
 * so a config answers "package" — the box's fields (`boxFx`) and every kit item's groups. `cfg` is
 * that answer once it is in: null while it loads, after a failed load, and with no config.
 */
export function useKitFields(boxItemId: number, stationId: number) {
  const sf = useStationFields(boxItemId, stationId);
  const cfg = sf.status === "ready" && sf.mode === "package" ? sf : null;
  const boxFx = useFieldsState(cfg ? cfg.box : []);
  return {
    sf, cfg, boxFx,
    /** The answer is still coming, or failed: the steps that show fields wait (spec §4.2). */
    waiting: sf.status === "loading" || sf.status === "error",
    gate: cfg?.gate ?? false,
    /** Every field a kit item answers here ("לכל פריט", then its type's) — [] without a config. */
    defsOf: (itemId: string): Field[] => kitItemDefs(findKitItem(sf, itemId)),
  };
}
