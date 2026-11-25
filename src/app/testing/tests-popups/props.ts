import type { PackageView } from "@/app/lib/packages/contract";
import type { NextStationResult, QueueRow, TestResultData, TestStation } from "@/app/lib/testing/contract";

/**
 * What the testing page hands a station popup. The page mounts a popup per opening and unmounts it
 * after (a parked one stays mounted, hidden by DialogParked), so a popup has no `open`: its first
 * state is the fresh one.
 */
export interface StationPopupProps {
  onClose: () => void;
  item: QueueRow;
  station: TestStation;
  /** The station type's name from the DB (test_stations_type) — the wizard's titles. */
  stationTypeName?: string;
  workerId: number | null;
  workerName: string;
  /** Called with the test result — the page persists it and drives the follow-up dialogs. It
   *  resolves with the server's answer, so a wizard with its own done step (a package's) can say
   *  where the row goes next. */
  onSubmit: (data: TestResultData) => Promise<NextStationResult | void>;
}

/** A box wizard's: the box itself (the row's `package`, there for every box row). */
export type BoxPopupProps = StationPopupProps & { pkg: PackageView };
