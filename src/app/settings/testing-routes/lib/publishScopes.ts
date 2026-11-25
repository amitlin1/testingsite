import type { ApplyMode } from "@/app/lib/station-fields/admin-types";

/** The scopes the publish dialog offers, in order — each moves the rows of the one before it and
 *  more (admin-types APPLY_MODES). Artboard 10 draws two cards, "רק לפריטים חדשים" and "גם לפריטים
 *  שטרם הגיעו לעמדה ששונתה"; the first became "not_started" and "all" was added (2026-10-14). */
export const PUBLISH_SCOPES = ["not_started", "not_reached", "all"] as const satisfies readonly ApplyMode[];
export type PublishScope = (typeof PUBLISH_SCOPES)[number];

/** The scope the dialog opens with: items that have not started their route. */
export const APPLY_MODE_DEFAULT: PublishScope = "not_started";
