/**
 * useGameSync — shared hook for game instrumentation lifecycle (#549).
 *
 * Encapsulates the gameEventClient session pattern that was previously
 * duplicated across GameScreen, Twenty48Screen, CascadeScreen, and
 * BlackjackGameContext:
 *   - gameIdRef / completedRef boilerplate
 *   - try/catch isolation on every client call
 *   - abandon-on-unmount cleanup
 *
 * Usage
 * -----
 *   const { start, enqueue, complete, restart, reportBug } = useGameSync("yacht");
 *
 *   // Begin a session (call once per game, e.g. after loading saved state)
 *   start({ initial_score: 0 });
 *
 *   // Record an event
 *   enqueue({ type: "roll", data: { dice: [1, 2, 3] } });
 *
 *   // Mark the session complete (prevents the unmount handler from firing)
 *   complete({ finalScore: 250, outcome: "completed" }, { final_score: 250 });
 *
 *   // End the current session as abandoned and immediately start a fresh one
 *   restart({ initial_score: 0 });
 *
 * The unmount cleanup automatically abandons any open session, so callers
 * only need to call complete() for game-over paths; abandoned paths are
 * handled for free.
 *
 * Abandon data (#2450): an abandoned session would otherwise carry nothing but
 * `{ outcome: "abandoned" }`. A game registers `setProgressSnapshot(getter)` so
 * the hook's own abandon paths (unmount, restart) can attach the score and the
 * per-game result block at that moment. Games that never register a getter keep
 * the old behaviour and send no result.
 */

import { useCallback, useEffect, useRef } from "react";
import { gameEventClient, EnqueueEventInput } from "./gameEventClient";
import { CompleteSummary } from "./pendingGamesStore";
import type { GameType } from "./types";
import type { BugLevel } from "./eventQueueConfig";

/** What a game knows about its in-progress session when it is abandoned. */
export interface ProgressSnapshot {
  finalScore?: number;
  /** Per-game result block — must satisfy the backend `result_model`, if any. */
  result?: Record<string, unknown>;
}

export interface UseGameSyncReturn {
  /** Start a new instrumented session. Call once after the game state is ready. */
  start: (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => void;
  /**
   * Signal that the player has taken their first meaningful action. Must be
   * called before the unmount cleanup will fire an abandoned event, preventing
   * false abandons on games the player never actually started.
   */
  markStarted: () => void;
  /** Enqueue a gameplay event. No-ops if no session is open. */
  enqueue: (event: EnqueueEventInput) => void;
  /**
   * Mark the session as complete. Prevents the unmount handler from firing
   * an abandoned event. Safe to call multiple times — only the first fires.
   */
  complete: (summary: CompleteSummary, payload?: Record<string, unknown>) => void;
  /**
   * End the current session (as abandoned if still open) and immediately
   * start a fresh one. Use this for New Game / theme-switch flows.
   */
  restart: (newEventData?: Record<string, unknown>, newMetadata?: Record<string, unknown>) => void;
  /** Delegate to gameEventClient.reportBug with try/catch isolation. */
  reportBug: (
    level: BugLevel,
    source: string,
    message: string,
    context?: Record<string, unknown>
  ) => void;
  /** Return the current game ID, or null if no session is open. */
  getGameId: () => string | null;
  /**
   * Register a getter the hook calls when it abandons the session itself
   * (unmount or `restart()`), so the abandon carries the score and result
   * block instead of only `{ outcome: "abandoned" }`. The getter must read
   * from refs (it runs during unmount, after state is gone) and must not throw.
   */
  setProgressSnapshot: (getSnapshot: () => ProgressSnapshot) => void;
}

export function useGameSync(gameType: GameType): UseGameSyncReturn {
  const gameIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const startedRef = useRef(false);
  const snapshotRef = useRef<() => ProgressSnapshot>(() => ({}));
  // Keep gameType in a ref so restart() always uses the current value even if
  // the consumer passes a runtime-derived type (shouldn't change, but safe).
  const gameTypeRef = useRef(gameType);
  useEffect(() => {
    gameTypeRef.current = gameType;
  }, [gameType]);

  // Abandon the open session, attaching the game's progress snapshot if it
  // registered one. A throwing getter degrades to a bare abandon.
  const abandon = useCallback((gid: string) => {
    let snapshot: ProgressSnapshot = {};
    try {
      snapshot = snapshotRef.current() ?? {};
    } catch {
      // Isolation: a broken getter must not lose the abandon.
    }
    const summary: CompleteSummary = { outcome: "abandoned" };
    if (snapshot.finalScore !== undefined) summary.finalScore = snapshot.finalScore;
    if (snapshot.result) summary.result = snapshot.result;
    try {
      gameEventClient.completeGame(gid, summary, { ...snapshot.result, outcome: "abandoned" });
    } catch {
      // Isolation.
    }
  }, []);

  // Abandon any open session on unmount, but only if the player actually started.
  useEffect(() => {
    return () => {
      const gid = gameIdRef.current;
      if (gid && startedRef.current && !completedRef.current) {
        abandon(gid);
        gameIdRef.current = null;
      }
    };
  }, [abandon]);

  const start = useCallback(
    (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      gameIdRef.current = gameEventClient.startGame(
        gameTypeRef.current,
        metadata ?? {},
        eventData ?? {}
      );
      completedRef.current = false;
      startedRef.current = false;
    },
    []
  );

  const markStarted = useCallback(() => {
    startedRef.current = true;
  }, []);

  const enqueue = useCallback((event: EnqueueEventInput) => {
    const gid = gameIdRef.current;
    if (!gid || completedRef.current) return;
    try {
      gameEventClient.enqueueEvent(gid, event);
    } catch {
      // Isolation.
    }
  }, []);

  const complete = useCallback((summary: CompleteSummary, payload?: Record<string, unknown>) => {
    const gid = gameIdRef.current;
    if (!gid || completedRef.current) return;
    // The per-game payload doubles as the PATCH `result` block (#2450) unless
    // the caller supplied an explicit summary.result.
    const withResult: CompleteSummary =
      summary.result === undefined && payload && Object.keys(payload).length > 0
        ? { ...summary, result: payload }
        : summary;
    try {
      gameEventClient.completeGame(gid, withResult, payload ?? {});
    } catch {
      // Isolation.
    }
    completedRef.current = true;
    gameIdRef.current = null;
  }, []);

  const restart = useCallback(
    (newEventData?: Record<string, unknown>, newMetadata?: Record<string, unknown>) => {
      // Close the current session if still open.
      const gid = gameIdRef.current;
      if (gid && !completedRef.current) {
        abandon(gid);
      }
      // Open a fresh session.
      gameIdRef.current = gameEventClient.startGame(
        gameTypeRef.current,
        newMetadata ?? {},
        newEventData ?? {}
      );
      completedRef.current = false;
      startedRef.current = false;
    },
    [abandon]
  );

  const reportBug = useCallback(
    (level: BugLevel, source: string, message: string, context?: Record<string, unknown>) => {
      try {
        gameEventClient.reportBug(level, source, message, context);
      } catch {
        // Isolation.
      }
    },
    []
  );

  const getGameId = useCallback(() => gameIdRef.current, []);

  const setProgressSnapshot = useCallback((getSnapshot: () => ProgressSnapshot) => {
    snapshotRef.current = getSnapshot;
  }, []);

  return {
    start,
    markStarted,
    enqueue,
    complete,
    restart,
    reportBug,
    getGameId,
    setProgressSnapshot,
  };
}
