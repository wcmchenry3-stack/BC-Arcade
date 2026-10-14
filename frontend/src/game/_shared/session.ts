/**
 * Per-device session ID management.
 *
 * Every game sends its session ID as the `X-Session-ID` header so the
 * backend can isolate game state per client without requiring user
 * accounts. The ID is generated once per device and persisted in
 * AsyncStorage.
 *
 * The session ID is the player's only credential (the backend reads and
 * deletes a player's data by it), so it is minted only from a CSPRNG
 * (`generateUUIDWithSource`, #3303). With no CSPRNG, minting throws
 * `CsprngUnavailableError` and nothing is stored: no predictable id is ever
 * persisted or sent. An id already in storage is returned unchanged, unless
 * it came from the old predictable fallback (`isLegacyFallbackId`): that one
 * is re-keyed once (#3325), and the old player's queue and caches are dropped
 * (`sessionRekey.ts`).
 *
 * This used to live in the Yacht client (`frontend/src/api/client.ts`)
 * which all other clients reached into. Moved to _shared during the
 * unified game module refactor (#153).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";

import { purgeSessionScopedState } from "./sessionRekey";
import { CsprngUnavailableError, generateUUIDWithSource, isLegacyFallbackId } from "./uuid";

const SESSION_KEY = "game_session_id";

// One Sentry report per app launch: every API call retries the mint.
let reportedCsprngFailure = false;

function mintSessionId(): string {
  try {
    const { uuid, source } = generateUUIDWithSource();
    // Which CSPRNG minted it, for the on-device check (#3303): the next
    // Sentry event of this launch carries the breadcrumb. Never the id
    // itself: it is a credential (docs/DATA-INVENTORY.md).
    Sentry.addBreadcrumb({
      category: "session",
      level: "info",
      message: `session id minted from ${source}`,
      data: { source, platform: Platform.OS },
    });
    return uuid;
  } catch (e) {
    if (e instanceof CsprngUnavailableError && !reportedCsprngFailure) {
      reportedCsprngFailure = true;
      Sentry.captureException(e, {
        level: "fatal",
        tags: { subsystem: "session", op: "mint" },
        extra: { platform: Platform.OS },
      });
    }
    throw e;
  }
}

async function readOrCreateSessionId(): Promise<string> {
  const stored = await AsyncStorage.getItem(SESSION_KEY);
  if (stored && !isLegacyFallbackId(stored)) return stored;
  // None yet, or one from the removed predictable fallback (#3325): mint a
  // new one. Fails closed either way — a legacy id is never returned again.
  const sid = mintSessionId();
  if (stored) {
    // Before the new id is stored: a kill in between re-keys again on the
    // next launch rather than sending the old player's queue under the new id.
    // A failed queue clear rejects here: the new id is not stored, the legacy
    // one stays (never returned) and the next call retries the re-key.
    await purgeSessionScopedState();
    // Never the ids: they are credentials.
    Sentry.addBreadcrumb({
      category: "session",
      level: "info",
      message: "legacy session id re-keyed",
    });
  }
  // If this store keeps failing after a purge, every later call purges again
  // (dropping rows enqueued in between). Accepted: the storage failure that
  // causes it (e.g. a full disk) fails those enqueues too.
  await AsyncStorage.setItem(SESSION_KEY, sid);
  return sid;
}

// One read-or-create at a time, so concurrent first requests (or a re-key)
// can't each mint and store a different id.
let inFlight: Promise<string> | null = null;

export function getOrCreateSessionId(): Promise<string> {
  inFlight ??= readOrCreateSessionId().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The current session ID, or null when there is none yet (never creates one). */
export async function getSessionIdIfAny(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}
