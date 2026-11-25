import { ApiError } from "@/lib/api/client";

/**
 * 409 FIELDS_SCHEMA_MISMATCH from POST /api/testing/results (route-fields D5, spec §4.12): the
 * config changed while the popup was open. The host calls sf.reload(); the drafts stay, keyed by
 * FieldId (useFieldsState). What the popup shows for the refusal is failureText's rule.
 */
export function shouldReloadFields(e: unknown): boolean {
  return e instanceof ApiError && e.body.code === "FIELDS_SCHEMA_MISMATCH";
}
