import { useCallback, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import type { GameType } from "./types";
import { scoreQueue } from "./scoreQueue";
import { useNetwork } from "./NetworkContext";
import { loadDisplayName, saveDisplayName } from "./displayName";

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

  const send = useCallback(async (name: string, payload: P) => {
    const { gameType, submit, queuePayload } = adapterRef.current;
    setPlayerName(name);

    const enqueue = async () => {
      try {
        await scoreQueue.enqueue(gameType, queuePayload(name, payload));
        setStatus("offline");
      } catch (e) {
        Sentry.captureException(e, { tags: { subsystem: "leaderboardSubmit", gameType } });
        setStatus("error");
      }
    };

    if (offlineRef.current) {
      await enqueue();
      return;
    }
    setStatus("submitting");
    try {
      const placed = await submit(name, payload);
      setRank(topTenRank(placed));
      setStatus("saved");
    } catch {
      // The request failed while nominally online — queue it for the next flush.
      await enqueue();
    }
  }, []);

  const submit = useCallback(
    async (payload: P) => {
      if (startedRef.current) return;
      startedRef.current = true;
      pendingRef.current = { payload };
      const name = await loadDisplayName();
      if (!name) {
        setStatus("needsName");
        return;
      }
      await send(name, payload);
    },
    [send]
  );

  const provideName = useCallback(
    async (raw: string) => {
      const name = await saveDisplayName(raw);
      if (!name) return false;
      const pending = pendingRef.current;
      if (pending) await send(name, pending.payload);
      return true;
    },
    [send]
  );

  const retry = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const name = await loadDisplayName();
    if (!name) {
      setStatus("needsName");
      return;
    }
    await send(name, pending.payload);
  }, [send]);

  const reset = useCallback(() => {
    startedRef.current = false;
    pendingRef.current = null;
    setStatus("idle");
    setRank(null);
    setPlayerName(null);
  }, []);

  return { status, rank, playerName, submit, provideName, retry, reset };
}
