import * as React from "react";
import type {
  NextStation, QueueRow, ResearchStation, ResultAnswer, TestResultData, TestStation, TestStationType,
} from "@/app/lib/testing/contract";
import { opensOnStart } from "@/app/lib/testing/popup-kind";
import { failureText } from "@/app/components/failureText";
import { newActionId } from "@/lib/action-id";
import { ItemStatus, isInTestStatus } from "@/lib/item-status";
import { postResult, releaseTest, startTest, type Actor } from "./api";
import { afterResultStepBack, type StepBackRequest } from "./queue/queueModel";

/** Start-test failed (someone else took the item / the box, or the server refused). */
const START_FAILED_ITEM = "לא ניתן להתחיל בדיקה — ייתכן שפריט זה כבר נתפס על ידי עובד אחר.";
const START_FAILED_PACKAGE = "לא ניתן להתחיל את המארז — ייתכן שהוא כבר נתפס על ידי עובד אחר.";

/** What the next-station dialog says after an item's result. */
export type NextStationInfo = {
  isLastStation: boolean;
  nextStation?: NextStation;
  /** The research station ended the route ("סיים מסלול"). */
  finishedFromResearch?: boolean;
  finishedAtStep?: number;
  /** "חזרה לבדיקה הקודמת" from the dialog (queueModel afterResultStepBack); null where not offered. */
  stepBack: StepBackRequest | null;
};

/**
 * The station popup's host: the queue card's start, which row's popup is open, the result it
 * submits, and the follow-up dialogs (next station, research).
 *
 * start-test locks the item into "in test" / "in research" before the popup opens. A popup closed
 * without a result is parked, not dropped: hidden, with everything filled in it, until the same
 * worker opens the same item at the same station again — it comes back where it was — and the item
 * is released back to waiting. A result, another station or another worker drops it; so does
 * leaving the page. `session` remounts the popup for every fresh start.
 */
export function useTestWindow({ station, stationType, actor, canStepBack, onRefresh, onStartError }: {
  station: TestStation | null;
  stationType: TestStationType | null;
  actor: Actor;
  canStepBack: boolean;
  onRefresh: () => void;
  /** Shows a start-test failure in the page's error toast. */
  onStartError: (message: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [item, setItem] = React.useState<QueueRow | null>(null);
  // Whether the popup on screen recorded a result: its onClose (right after) must not release it.
  const submittedRef = React.useRef(false);
  const [parked, setParked] = React.useState<{ stationId: number; workerId: number | null } | null>(null);
  const [session, setSession] = React.useState(0);
  const [starting, setStarting] = React.useState<number | null>(null);
  const [nextOpen, setNextOpen] = React.useState(false);
  const [nextInfo, setNextInfo] = React.useState<NextStationInfo | null>(null);
  const [resultSeq, setResultSeq] = React.useState(0);
  const [researchOpen, setResearchOpen] = React.useState(false);
  const [researchStation, setResearchStation] = React.useState<ResearchStation | null>(null);

  // Another station or another worker drops the parked popup (adjusted during render).
  if (parked && (parked.stationId !== station?.test_station_id || parked.workerId !== actor.workerId)) {
    setParked(null);
  }

  const openFor = (row: QueueRow) => {
    submittedRef.current = false;
    // The parked popup of this very item, still at the same step: back where it was (with the item
    // it was opened with, so it does not start over). Anything else starts fresh.
    const resume = parked != null && item != null
      && item.item_id === row.item_id
      && item.current_route_step === row.current_route_step;
    if (!resume) {
      setItem(row);
      setSession((n) => n + 1);
    }
    setParked(null);
    setOpen(true);
  };

  // A box opens its wizard. An item opens its popup when its station type has one of its own — the
  // plain report dialog is reached by "המשך בדיקה" only — and never at a package-level station.
  const opensAfterStart = (row: QueueRow) =>
    stationType != null && (stationType.packageLevel ? !!row.is_package : opensOnStart(stationType));

  /**
   * The queue card's button. A row in test continues its popup. A waiting row is started first:
   * start-test is the only call that flips it to "in test", and it must run before the popup opens,
   * or the row stays "waiting" while the popup is open and a second worker can start (and submit) it
   * independently. One start at a time.
   */
  const begin = async (row: QueueRow) => {
    if (isInTestStatus(row.current_status)) { openFor(row); return; }
    if (!station || starting != null) return;
    setStarting(row.item_id);
    try {
      await startTest(row.item_id, station.test_station_id, actor);
    } catch (e) {
      onRefresh();
      onStartError(failureText(e, stationType?.packageLevel && row.is_package ? START_FAILED_PACKAGE : START_FAILED_ITEM));
      return;
    } finally {
      setStarting(null);
    }
    if (opensAfterStart(row)) openFor(row);
    else onRefresh();
  };

  // Reverses start-test for a popup closed without a result. Fire-and-forget from the UI's side —
  // the periodic release-stale-tests cron is the backstop if this fails too (closed tab, lost
  // connection).
  const release = async (itemId: number, stationId: number) => {
    try {
      await releaseTest(itemId, stationId, actor);
    } catch (error) {
      console.error("Error releasing test:", error);
    } finally {
      onRefresh();
    }
  };

  const close = () => {
    setOpen(false);
    if (!submittedRef.current && item && station) {
      setParked({ stationId: station.test_station_id, workerId: actor.workerId });
      release(item.item_id, station.test_station_id);
    }
  };

  const submit = async (testData: TestResultData): Promise<ResultAnswer | void> => {
    if (!item || !station) return;
    const routeStepsLength = item.route_steps?.length || 0;
    if (routeStepsLength === 0) throw new Error("Route steps information is missing.");
    const result = await postResult({
      ItemID: item.item_id,
      StationID: station.test_station_id,
      CurrentRouteStep: item.current_route_step,
      RouteStepsLength: routeStepsLength,
      // Feed the item_route_history write; the metrics ledger never reads client timestamps — the
      // DB assigns occurred_at for every event (§4.2).
      QueueStartTime: item.created_at,
      ProcessingStartTime: item.processing_start_time,
      ItemTypeId: item.item_type_id,
      CreatedAt: item.created_at,
      // A popup with an error-retry path passes its own stable SubmitID (the spread wins), so a
      // retry replays instead of duplicating.
      SubmitID: newActionId(),
      WorkerName: actor.workerName || undefined,
      ...testData,
    });
    submittedRef.current = true;
    onRefresh();

    // A package wizard has its own done step, which names where the box and each of its items go
    // next; the next-station dialog would only say something misleading about the box.
    if (item.is_package) return result;

    if (testData.sendToResearch && result.recommendedResearchStation) {
      setResearchStation(result.recommendedResearchStation);
      setResearchOpen(true);
    } else {
      setNextInfo({
        isLastStation: result.isLastStation || false,
        nextStation: result.nextStation || undefined,
        finishedFromResearch: item.current_status === ItemStatus.InResearch && testData.finishRoute === true,
        finishedAtStep: item.current_route_step ?? undefined,
        stepBack: stationType ? afterResultStepBack(item, stationType, result, canStepBack) : null,
      });
      setResultSeq((n) => n + 1);
      setNextOpen(true);
    }
    return result;
  };

  return {
    open,
    parked: parked != null,
    item,
    session,
    begin,
    /** The row whose start-test is on its way. */
    starting,
    close,
    submit,
    /** The box's closing stopped from inside its wizard: closed as if it submitted — no release,
     *  nothing parked. */
    closingStopped: () => {
      submittedRef.current = true;
      setOpen(false);
      setParked(null);
    },
    /** `seq` changes per result: the dialog starts over (the page keys it). */
    next: { open: nextOpen, info: nextInfo, seq: resultSeq, close: () => setNextOpen(false) },
    research: { open: researchOpen, station: researchStation, close: () => setResearchOpen(false) },
  };
}
