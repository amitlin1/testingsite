import * as React from "react";
import { useWorkerLock } from "@/app/components/useWorkerLock";
import { useWorkersDirectory } from "@/app/components/lookups";

// The testing screen's "who's working" choice, kept in localStorage. Read once per visit to the
// page (dropped when it unmounts), so a choice made in another tab never changes this one's
// worker until it is opened again. The cache is the useSyncExternalStore snapshot: it must be the
// same value on every read of one visit.
const WORKER_STORAGE_KEY = "testing-page:active-worker-id";
let storedWorkerIdRead: { id: number | null } | null = null;
const readStoredWorkerId = (): number | null => {
  if (!storedWorkerIdRead) {
    let id: number | null = null;
    try {
      const raw = window.localStorage.getItem(WORKER_STORAGE_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (!Number.isNaN(parsed)) id = parsed;
    } catch {
      /* storage unavailable: no stored choice */
    }
    storedWorkerIdRead = { id };
  }
  return storedWorkerIdRead.id;
};
const forgetStoredWorkerId = () => { storedWorkerIdRead = null; };
const noStoredWorkerId = (): number | null => null;
const noSubscribe = () => () => {};

function storeWorkerId(id: number | null) {
  try {
    if (id == null) window.localStorage.removeItem(WORKER_STORAGE_KEY);
    else window.localStorage.setItem(WORKER_STORAGE_KEY, String(id));
  } catch {
    /* storage unavailable: the choice holds for this visit */
  }
}

/**
 * The worker every action on the testing screen is taken for (finish test, file upload, replace,
 * edit). When the login carries a worker id (Keycloak employeeNumber) THAT is the active worker on
 * load — it overrides any manual / stored choice; only a manager (ACCESS.actAsOtherWorker) may then
 * switch. A login without one picks by hand. Smart-card auth will replace the picker.
 */
export function useActiveWorker() {
  // Until the token or the picker sets one, the stored choice (read after hydration, so the server
  // render never guesses it).
  const storedWorkerId = React.useSyncExternalStore(noSubscribe, readStoredWorkerId, noStoredWorkerId);
  React.useEffect(() => forgetStoredWorkerId, []);
  const [pickedWorker, setPickedWorker] = React.useState<{ id: number | null } | null>(null);
  const { tokenWorkerId, locked: workerLocked } = useWorkerLock();
  // Taken during render; stored below.
  const [seenTokenWorkerId, setSeenTokenWorkerId] = React.useState<number | null>(null);
  if (seenTokenWorkerId !== tokenWorkerId) {
    setSeenTokenWorkerId(tokenWorkerId);
    if (tokenWorkerId != null) setPickedWorker({ id: tokenWorkerId });
  }
  React.useEffect(() => {
    if (tokenWorkerId != null) storeWorkerId(tokenWorkerId);
  }, [tokenWorkerId]);

  const workerId = pickedWorker ? pickedWorker.id : storedWorkerId;
  // The name snapshotted onto the ledger events (the directory lives in Keycloak).
  const workers = useWorkersDirectory().data;
  const workerName = React.useMemo(
    () => (workerId == null || !workers ? "" : workers.find((w) => w.worker_id === workerId)?.worker_name ?? ""),
    [workerId, workers],
  );
  const pickWorker = React.useCallback((id: number | null) => {
    setPickedWorker({ id });
    storeWorkerId(id);
  }, []);

  return { workerId, workerName, workerLocked, pickWorker };
}
