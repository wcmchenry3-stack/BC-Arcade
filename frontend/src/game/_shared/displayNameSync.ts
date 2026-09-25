/**
 * Sends the player's display name to the server: `PUT /players/me` (#2624).
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
 * - **Triggers.** Every save (the hook `registerDisplayNameSync` installs in
 *   `displayName.ts`), app launch, and — alongside `scoreQueue` and
 *   `SyncWorker` — reconnect and return to the foreground (`NetworkContext`).
 * - **Launch.** A stored name the server was never sent for this player id
 *   (set before #2624 shipped, or kept after "Delete my data" started a new
 *   session) goes into the slot once. `SYNCED_KEY` records the
 *   `{session_id, name}` the server last confirmed, so later launches send
 *   nothing.
 * - **Replays are harmless.** The PUT is idempotent: sending the name the
 *   player already has writes nothing on the server.
 *
 * A 400/422 means the server will never accept that name, so it is dropped
 * rather than retried forever. Anything else (offline, 5xx, 429, a 404 from a
 * backend without the route yet) keeps it pending.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { playersApi } from "../../api/players";
import { loadDisplayName, setDisplayNameSaveHook } from "./displayName";
import { ApiError } from "./httpClient";
import { getOrCreateSessionId } from "./session";

const PENDING_KEY = "player_display_name_pending_sync";
const SYNCED_KEY = "player_display_name_synced";

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
  const name = await getItem(PENDING_KEY);
  if (name == null) return true;
  let sessionId: string;
  try {
    sessionId = await getOrCreateSessionId();
    await playersApi.putMe(name);
  } catch (e) {
    if (e instanceof ApiError && REJECTED_STATUSES.has(e.status)) {
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

/** Sends every saved name to the server. Called once, at module load, by NetworkContext. */
export function registerDisplayNameSync(): void {
  setDisplayNameSaveHook((name) => {
    queueDisplayNameSync(name).catch((e) => {
      Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "queue" } });
    });
  });
}

/** Test-only: forget in-flight state (AsyncStorage is cleared by the tests). */
export function resetDisplayNameSyncForTests(): void {
  running = null;
  queued = null;
  slotWrites = Promise.resolve();
}
