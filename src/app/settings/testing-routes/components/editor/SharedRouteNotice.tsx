"use client";
import * as React from "react";
import { Info } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import type { ForkResultJson } from "@/app/lib/station-fields/admin-types";
import { sharedNoticeText } from "../../lib/labels";
import { FORK_UNDRAWN_TEXT, FORK_TEXT, forkConfirmMessage, forkErrorText } from "../../lib/forkLabels";
import { useFork } from "../../lib/useFork";

/**
 * "משותף" (artboard 2, spec §5.5.2 א; decision 4): an item column's fields live on the ITEM's route,
 * so a route another kit also runs is edited for both — "השדות נשמרים במסלול {r} של {item} ומשמשים גם
 * ב: {kits}. שינוי כאן יחול בשניהם." role="note", tint / primary-border, radius 11, Info. Never on a
 * package-level step.
 *
 * With `fork`, the text ends with artboard 2's link "צור מסלול נפרד למארז הזה" (spec §3.2.1): a
 * ConfirmDialog (not drawn — its text is in forkLabels.ts), then POST …/[id]/fork after
 * every pending autosave is written (useFork). Success calls `onForked`, and the dialog stays busy
 * until the promise it returns (if any) settles; the host reloads the fields context, after which the
 * kit's line runs the new route and the notice is gone (the route is no longer shared). A refusal is
 * shown in the dialog. Pass `fork` only in a kit context (FieldsContextJson.kind "package"): an item
 * route's own map has no "this kit".
 *
 * Wiring (StationFieldEditor, where it renders the notice):
 *   fork={context.kind === "package" ? {
 *     routeId: cell.binding.route_id,               // the item route that holds the cell
 *     packageTypeId: context.subject.item_type_id,  // the kit on screen
 *     kitName: context.subject.desc,
 *     onForked: () => reloadContext(),              // useFieldsContext's reload, from the page
 *     onStale: () => reloadContext(),
 *   } : undefined}
 */

export type SharedRouteFork = {
  /** test_route_id of the item route that holds the cell (the route to fork). */
  routeId: number;
  /** The kit on screen, whose template line moves to the new route. */
  packageTypeId: number;
  /** Its name ("מארז עמדת עבודה"), for the dialog. */
  kitName: string;
  /** The fork succeeded: reload the fields context. A returned promise keeps the dialog busy. */
  onForked: (result: ForkResultJson) => void | Promise<unknown>;
  /** The server answered that the screen is behind it (the line runs another route by now, or the
   *  line / route / kit is gone): called when that dialog is closed — reload the fields context. */
  onStale?: () => void;
};

export type SharedRouteNoticeProps = {
  routeNumber: number;
  /** The item type whose route it is ("מחשב"). */
  item: string;
  /** The other kits that run the route ("מארז מחשב"). */
  kits: readonly string[];
  /** "צור מסלול נפרד למארז הזה" — kit context only; without it the notice has no link. */
  fork?: SharedRouteFork;
  /** The sentence before the link; default the fields' (sharedNoticeText). "שלבי המסלול" says it
   *  about steps. */
  text?: string;
};

export function SharedRouteNotice({ routeNumber, item, kits, fork, text }: SharedRouteNoticeProps) {
  return (
    <div role="note" className="sfe-notice">
      <Info size={18} strokeWidth={1.75} className="sfe-notice__icon" aria-hidden />
      <span className="sfe-notice__text">
        {text ?? sharedNoticeText(routeNumber, item, kits)}
        {fork && (
          <>
            {" "}
            <ForkLink fork={fork} routeNumber={routeNumber} item={item} kits={kits} />
          </>
        )}
      </span>
    </div>
  );
}

type ForkLinkProps = { fork: SharedRouteFork; routeNumber: number; item: string; kits: readonly string[] };

function ForkLink({ fork, routeNumber, item, kits }: ForkLinkProps) {
  const runner = useFork();
  const [open, setOpen] = React.useState(false);
  /** Waiting on the host's onForked (the context reload). */
  const [finishing, setFinishing] = React.useState(false);
  /** The route forked away from: until the host's new context replaces it, the notice still names
   *  it, and a second fork of it would only be refused (409 LINE_NOT_ON_ROUTE). */
  const [forkedFrom, setForkedFrom] = React.useState<number | null>(null);
  const busy = runner.running || finishing;

  const confirm = async () => {
    const result = await runner.run(fork.routeId, fork.packageTypeId);
    if (!result) return;
    setFinishing(true);
    try {
      await fork.onForked(result);
    } finally {
      setFinishing(false);
      setForkedFrom(fork.routeId);
      setOpen(false);
    }
  };

  const close = () => {
    const stale = runner.error?.kind === "stale";
    setOpen(false);
    runner.reset();
    if (stale) fork.onStale?.();
  };

  if (forkedFrom === fork.routeId && !open) return null;

  const message = (
    <>
      {forkConfirmMessage({ item, kit: fork.kitName, otherKits: kits, routeNumber })}
      {runner.error && (
        <span role="alert" className="sfe-notice__fork-error">{forkErrorText(runner.error)}</span>
      )}
    </>
  );

  return (
    <>
      <button
        type="button"
        className="sfe-notice__link"
        aria-haspopup="dialog"
        onClick={() => {
          runner.reset();
          setOpen(true);
        }}
      >
        {FORK_TEXT.link}
      </button>
      <ConfirmDialog
        open={open}
        title={FORK_UNDRAWN_TEXT.title}
        message={message}
        confirmText={FORK_TEXT.link}
        busy={busy}
        draggable={false}
        onCancel={close}
        onConfirm={() => {
          void confirm();
        }}
      />
    </>
  );
}

export default SharedRouteNotice;
