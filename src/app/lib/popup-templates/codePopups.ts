/**
 * The popup the code gives each station type today — one list for the testing page's registry
 * (tests-popups/mainPopUp.ts) and the seed that turns them into templates
 * (scripts/seed-popup-templates.ts, docs/popup-templates/PLAN.md step 1.5). Ids only: the popups
 * take every title from the station type's name in the DB, so no station name lives here.
 *
 *   photo    the photo popup capturing the photo_types group `photoTypeId` (PhotoStation)
 *   verdict  the SKU + instruction + verdict popup (VerdictStation)
 *
 * Anything not listed opens the plain report dialog. Package-level types are never listed: the
 * testing page opens the package wizards for them by the flag, and their templates are made from
 * openingTemplate / closingTemplate by their place on the package routes (placement.ts).
 */
export type CodePopup = { kind: "photo"; photoTypeId: number } | { kind: "verdict" };

/** The photo groups (photo_types.code) today's opening wizard captures into: the box's photos and
 *  its items'. A template made from it keeps them, so the reference images stay where they are. */
export const OPENING_PHOTO_CODES = { box: "package", item: "product" } as const;

export const CODE_POPUPS: Readonly<Record<number, CodePopup>> = {
  2: { kind: "photo", photoTypeId: 3 },
  3: { kind: "verdict" },
  4: { kind: "verdict" },
  5: { kind: "photo", photoTypeId: 4 },
};
