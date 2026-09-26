/**
 * Sends the player's display name to the server: `PUT /players/me` (#2624),
 * or `DELETE /players/me` when the player removes it (#2637).
 *
 * The server keeps one name per player (this install's `X-Session-ID`) and
 * every leaderboard reads it, so the app only has to get the latest local name
 * there once. This is a one-slot queue, not a list of saves:
 *
 * - **Pending sync.** A save writes its name into one AsyncStorage slot
 *   (`PENDING_KEY`), replacing whatever was there, then tries to send it. Five
 *   saves while offline leave one pending sync holding the last name, and the
 *   next flush sends one PUT. The slot is cleared only once the server has
 *   exactly that name, so a failure or an app kill mid-request keeps it for the
 *   next trigger.
 * - **Removal.** "Remove my name from leaderboards" (`removeDisplayName`)
 *   puts `CLEAR` in the same slot, so the latest intent still wins: a removal
 *   after an unsent save sends only the DELETE, and a save after an unsent
 *   removal sends only the PUT. It retries on the same triggers as a name.
 * - **Triggers.** Every save (the hook `registerDisplayNameSync` installs in
 *   `displayName.ts`), app launch, and — alongside `scoreQueue` and
 *   `SyncWorker` — reconnect and return to the foreground (`NetworkContext`).
 * - **Launch.** A stored name the server was never sent for this player id
 *   (set before #2624 shipped, or kept after "Delete my data" started a new
 *   session) goes into the slot once. `SYNCED_KEY` records the
 *   `{session_id, name}` the server last confirmed, so later launches send
 *   nothing.
 * - **Replays are harmless.** The PUT is idempotent: sending the name the
 *   player already has writes nothing on the server. So is the DELETE.
 *
 * A 400/422 means the server will never accept that name, so it is dropped
 * and recorded as settled for this player id, so launch doesn't send it again
 * every time. Anything else (offline, 5xx, 429, a 404 from a backend without
 * the route yet) keeps it pending.
 *
 * "Delete my data" calls `clearDisplayNameSync` first: it waits for a sync
 * already in flight (which could otherwise recreate the erased name after the
 * server deleted it) and forgets the pending and settled state.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { playersApi } from "../../api/players";
import { clearDisplayName, loadDisplayName, setDisplayNameSaveHook } from "./displayName";
import { ApiError } from "./httpClient";
import { getOrCreateSessionId } from "./session";

const PENDING_KEY = "player_display_name_pending_sync";
const SYNCED_KEY = "player_display_name_synced";

/**
 * The slot value meaning "remove the name from the server". Longer than
 * `DISPLAY_NAME_MAX_LENGTH`, so no name the app accepts can equal it.
 */
const CLEAR = "__remove_display_name_from_every_leaderboard__";

/** Statuses that mean the server will never accept this name. */
const REJECTED_STATUSES = new Set([400, 422]);

interface SyncedMarker {
  session_id: string;
  name: string;
}

async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "read" } });
    return null;
  }
}

async function setItem(key: string, value: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "write" } });
    return false;
  }
}

/** Clears the slot unless a newer save replaced `name` meanwhile. */
async function clearPendingIf(name: string): Promise<void> {
  if ((await getItem(PENDING_KEY)) !== name) return;
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch (e) {
    // Left pending: the next flush replays an idempotent PUT.
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "clear" } });
  }
}

async function isSynced(name: string): Promise<boolean> {
  const raw = await getItem(SYNCED_KEY);
  if (!raw) return false;
  try {
    const marker = JSON.parse(raw) as Partial<SyncedMarker>;
    return marker.name === name && marker.session_id === (await getOrCreateSessionId());
  } catch {
    return false;
  }
}

// Slot writes, in call order. A flush waits for them, so it never reads a
// slot a save is still writing.
let slotWrites: Promise<unknown> = Promise.resolve();

function writeSlot(name: string): Promise<unknown> {
  slotWrites = slotWrites.then(() => setItem(PENDING_KEY, name));
  return slotWrites;
}

/** One attempt. Resolves true when nothing is left pending; never rejects. */
async function flushOnce(): Promise<boolean> {
  await slotWrites;
  // A name, or CLEAR. The settled marker records either one.
  const name = await getItem(PENDING_KEY);
  if (name == null) return true;
  let sessionId: string | null = null;
  try {
    sessionId = await getOrCreateSessionId();
    if (name === CLEAR) {
      await playersApi.deleteMe();
    } else {
      await playersApi.putMe(name);
    }
  } catch (e) {
    if (e instanceof ApiError && REJECTED_STATUSES.has(e.status)) {
      // Settled: the same name would be refused again, so launch mustn't resend it.
      if (sessionId != null) {
        const settled: SyncedMarker = { session_id: sessionId, name };
        await setItem(SYNCED_KEY, JSON.stringify(settled));
      }
      await clearPendingIf(name);
      // No name in the event: it is player-entered text.
      Sentry.captureMessage("displayNameSync: server rejected the display name", {
        level: "warning",
        tags: { subsystem: "displayNameSync", status: String(e.status) },
      });
      return (await getItem(PENDING_KEY)) == null;
    }
    Sentry.addBreadcrumb({
      category: "displayNameSync",
      message: `sync failed, kept pending: ${e instanceof Error ? e.message : String(e)}`,
      level: "warning",
    });
    return false;
  }
  const marker: SyncedMarker = { session_id: sessionId, name };
  await setItem(SYNCED_KEY, JSON.stringify(marker));
  await clearPendingIf(name);
  return (await getItem(PENDING_KEY)) == null;
}

let running: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;

function start(): Promise<boolean> {
  const run: Promise<boolean> = flushOnce().finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

/**
 * Sends the pending name, if any. Flushes never overlap: a call made during
 * one runs once after it (calls made meanwhile share that run), so the
 * latest name is always the last one sent, and the returned promise settles
 * only after every flush requested before it. Resolves true when nothing is
 * left pending.
 */
export function flushDisplayNameSync(): Promise<boolean> {
  if (!running) return start();
  if (!queued) {
    const next = (): Promise<boolean> => {
      queued = null;
      return start();
    };
    queued = running.then(next, next);
  }
  return queued;
}

/**
 * Makes `name` the one pending sync (the latest name wins) and flushes.
 * Synchronous up to the flush request, so once `saveDisplayName` returns, a
 * later `flushDisplayNameSync()` settles after this name's attempt.
 */
export function queueDisplayNameSync(name: string): Promise<boolean> {
  void writeSlot(name);
  return flushDisplayNameSync();
}

/**
 * On launch: put a stored name the server was never sent for this player id
 * into the slot (once), then flush whatever is pending.
 */
export async function syncDisplayNameOnLaunch(): Promise<boolean> {
  const name = await loadDisplayName();
  if (name != null && !(await isSynced(name))) {
    return queueDisplayNameSync(name);
  }
  return flushDisplayNameSync();
}

/**
 * "Remove my name from leaderboards" (#2637): forgets the local name, then
 * queues `DELETE /players/me` in the pending slot, which replaces any unsent
 * name. Offline, the removal stays pending and goes out on the next trigger
 * (reconnect, foreground, launch). Resolves false, having changed nothing,
 * when the local name couldn't be cleared; it doesn't wait for the server.
 */
export async function removeDisplayName(): Promise<boolean> {
  if (!(await clearDisplayName())) return false;
  void writeSlot(CLEAR);
  flushDisplayNameSync().catch((e) => {
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "remove" } });
  });
  return true;
}

/** Sends every saved name to the server. Called once, at module load, by NetworkContext. */
export function registerDisplayNameSync(): void {
  setDisplayNameSaveHook((name) => {
    queueDisplayNameSync(name).catch((e) => {
      Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "queue" } });
    });
  });
}

/**
 * "Delete my data": waits for any sync in flight, then forgets the pending
 * name and the settled marker. Call it before erasing the server's copy, so
 * no PUT can land after the delete. Never rejects.
 */
export async function clearDisplayNameSync(): Promise<void> {
  await slotWrites;
  await Promise.allSettled([running, queued].filter((p) => p != null));
  try {
    await Promise.all([AsyncStorage.removeItem(PENDING_KEY), AsyncStorage.removeItem(SYNCED_KEY)]);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "clearAll" } });
  }
}

/** Test-only: forget in-flight state (AsyncStorage is cleared by the tests). */
export function resetDisplayNameSyncForTests(): void {
  running = null;
  queued = null;
  slotWrites = Promise.resolve();
}
