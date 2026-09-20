import { syncWorker } from "./syncWorker";

let inFlight: Promise<void> | null = null;

/**
 * Uploads any locally queued games, then resolves — never rejects.
 *
 * For readers of server-derived progress (the Arcade level pill, the Daily
 * Challenge card): a game finished a moment ago is still in the local queue —
 * SyncWorker only uploads every 30 s — so the server would report the old level
 * or an undone goal. `syncWorker.flush()` returns immediately when a flush is
 * already running, which would let a second reader fetch before the first
 * one's upload landed; concurrent callers here share one flush instead.
 *
 * A failed flush must not cost the caller its own read, so errors are swallowed
 * (SyncWorker reports what is worth reporting).
 */
export function flushQueuedGames(): Promise<void> {
  if (!inFlight) {
    inFlight = syncWorker
      .flush()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
