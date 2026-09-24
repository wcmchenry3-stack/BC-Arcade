import { useCallback, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import type { GameType } from "./types";
import { scoreQueue } from "./scoreQueue";
import { useNetwork } from "./NetworkContext";
import { loadDisplayName, saveDisplayName } from "./displayName";
import { ApiError } from "./httpClient";
import { flushQueuedGames } from "./flushQueuedGames";

/**
 * Automatic leaderboard submission under the player's display name (#2503).
 *
 * Replaces the per-game name TextInput + Submit button: a game calls
 * `submit(payload)` once when it ends, and the result card renders `status`.
 *
 *   saved      — the server accepted it; `rank` is set when it placed top 10
 *   offline    — queued in `scoreQueue` (device offline, or the request
 *                failed); the queue retries on reconnect
 *   needsName  — no display name yet; call `provideName()` (the card's
 *                one-time prompt) and the pending score goes out
 *   error      — could neither submit nor queue; `retry()` tries again
 */
export type LeaderboardSubmitStatus =
  "idle" | "submitting" | "saved" | "offline" | "needsName" | "error";

/**
 * Per-game glue between the shared flow and that game's API. The per-game
 * scoring endpoints disagree on identity (name vs player_id vs game_id) and
 * queue payload shape; unifying them is tracked in #2519.
 */
export interface LeaderboardAdapter<P> {
  /** The `scoreQueue` game type; its handler must accept `queuePayload`'s shape. */
  gameType: GameType;
  /** Submit online. Resolve to the leaderboard rank, or null if unranked. */
  submit: (playerName: string, payload: P) => Promise<number | null>;
  /** The payload to enqueue when offline — the shape the game's queue handler reads. */
  queuePayload: (playerName: string, payload: P) => Record<string, unknown>;
}

/**
 * For endpoints that attach a name to an already-synced game
 * (`PATCH …/score/{game_id}`): the game-sync request is fire-and-forget, so
 * the name can arrive first and the server answers 404 (no game row yet) or
 * 400 (no final score yet). Retry those briefly before the caller falls back
 * to the offline queue. Other errors are thrown at once.
 */
export async function retryUntilGameSynced<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 750 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const notSyncedYet = e instanceof ApiError && (e.status === 404 || e.status === 400);
      if (!notSyncedYet || attempt >= attempts) throw e;
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}

/** Leaderboard APIs report rank 11 for "not in the top 10"; treat that as unranked. */
export function topTenRank(rank: number | null | undefined): number | null {
  return rank != null && rank >= 1 && rank <= 10 ? rank : null;
}

export interface LeaderboardSubmitState<P> {
  status: LeaderboardSubmitStatus;
  rank: number | null;
  /** The name the score went out (or was queued) under. */
  playerName: string | null;
  /** Submit this game's score. Later calls are ignored until `reset()`. */
  submit: (payload: P) => Promise<void>;
  /** Save a display name and send the score waiting on it. Resolves false if the name is invalid. */
  provideName: (name: string) => Promise<boolean>;
  /** Try the last submission again after an `error`. */
  retry: () => Promise<void>;
  /** Forget this game's submission (call on new game). */
  reset: () => void;
}

export function useLeaderboardSubmit<P>(adapter: LeaderboardAdapter<P>): LeaderboardSubmitState<P> {
  const { isOnline, isInitialized } = useNetwork();
  const [status, setStatus] = useState<LeaderboardSubmitStatus>("idle");
  const [rank, setRank] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);

  // Refs so the callbacks stay stable and see the latest values.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const offlineRef = useRef(false);
  offlineRef.current = isInitialized && !isOnline;
  const pendingRef = useRef<{ payload: P } | null>(null);
  const startedRef = useRef(false);
  // Bumped by reset(): a request still in flight from the previous game must
  // not write its status/rank over the new game's (it still gets sent or
  // queued — only its state updates are dropped).
  const generationRef = useRef(0);

  const send = useCallback(async (name: string, payload: P) => {
    const { gameType, submit, queuePayload } = adapterRef.current;
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setPlayerName(name);

    const enqueue = async () => {
      try {
        await scoreQueue.enqueue(gameType, queuePayload(name, payload));
        if (isCurrent()) setStatus("offline");
        // scoreQueue otherwise only flushes on an offline→online edge, so a
        // player who stays online would never send a queued score. Upload the
        // game itself first so a name-attach handler doesn't race it.
        if (!offlineRef.current) {
          flushQueuedGames()
            .then(() => scoreQueue.flush())
            .catch(() => undefined);
        }
      } catch (e) {
        Sentry.captureException(e, { tags: { subsystem: "leaderboardSubmit", gameType } });
        if (isCurrent()) setStatus("error");
      }
    };

    if (offlineRef.current) {
      await enqueue();
      return;
    }
    setStatus("submitting");
    try {
      const placed = await submit(name, payload);
      if (!isCurrent()) return;
      setRank(topTenRank(placed));
      setStatus("saved");
    } catch {
      // The request failed while nominally online — queue it for the next flush.
      await enqueue();
    }
  }, []);

  /** Sends the pending score under the stored name, or asks for one. */
  const sendPending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const generation = generationRef.current;
    const name = await loadDisplayName();
    if (generationRef.current !== generation) return;
    if (!name) {
      setStatus("needsName");
      return;
    }
    await send(name, pending.payload);
  }, [send]);

  const submit = useCallback(
    async (payload: P) => {
      if (startedRef.current) return;
      startedRef.current = true;
      pendingRef.current = { payload };
      await sendPending();
    },
    [sendPending]
  );

  const provideName = useCallback(
    async (raw: string) => {
      const generation = generationRef.current;
      const name = await saveDisplayName(raw);
      if (!name) return false;
      const pending = pendingRef.current;
      if (pending && generationRef.current === generation) await send(name, pending.payload);
      return true;
    },
    [send]
  );

  const retry = sendPending;

  const reset = useCallback(() => {
    generationRef.current += 1;
    startedRef.current = false;
    pendingRef.current = null;
    setStatus("idle");
    setRank(null);
    setPlayerName(null);
  }, []);

  return { status, rank, playerName, submit, provideName, retry, reset };
}
