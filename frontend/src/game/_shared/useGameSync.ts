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
 *   // Mark the session complete (prevents the unmount handler from firing).
 *   // `result` is the PATCH result block; the second argument is only the
 *   // analytics `game_ended` event payload.
 *   complete(
 *     { finalScore: 250, outcome: "completed", result: { final_score: 250 } },
 *     { final_score: 250 }
 *   );
 *
 *   // End the current session (abandoned if the player started it, else
 *   // discarded) and immediately start a fresh one
 *   restart({ initial_score: 0 });
 *
 * The unmount cleanup automatically abandons any open session, so callers
 * only need to call complete() for game-over paths; abandoned paths are
 * handled for free.
 *
 * Abandon data (#2450): an abandoned session would otherwise carry nothing but
 * `{ outcome: "abandoned" }`. A game registers `setProgressSnapshot(getter)` so
 * the hook's own abandon paths (unmount, restart) can attach the per-game
 * result block at that moment. Games that never register a getter keep
 * the old behaviour and send no result. A screen that also abandons explicitly
 * (a "New game" button, `beforeRemove`) builds that abandon's result with the
 * same helper its getter uses, so the two paths cannot drift apart (#2619).
 *
 * Only abandons the player caused count: the unmount, `start()` and
 * `restart()` paths all close an open session the same way — abandoned if
 * `markStarted()` was called for it, otherwise discarded
 * (`gameEventClient.discardGame`), so an untouched session is never left
 * pending on the device.
 *
 * Deferred create (#2654): `markStarted()` also tells gameEventClient, which
 * holds the session on the device until then — a session the player never
 * started never reaches the server.
 *
 * Killed process (#2654): a session left open when the process is killed (no
 * unmount runs) is picked up on the next launch. A screen that restores the
 * game's saved progress calls `resume()` to continue that same session, so
 * one real game stays one row. If the player starts a fresh game of the type
 * instead, or never reopens it within 24 h, gameEventClient abandons it; an
 * unstarted one is discarded at startup.
 */

import { useCallback, useEffect, useRef } from "react";
import { gameEventClient, EnqueueEventInput } from "./gameEventClient";
import { CompleteSummary } from "./pendingGamesStore";
import type { GameType } from "./types";
import type { BugLevel } from "./eventQueueConfig";

/**
 * What a game knows about its in-progress session when it is abandoned.
 *
 * Deliberately has no score: every backend leaderboard and /stats aggregate
 * keys on `final_score IS NOT NULL` and ignores `outcome`, so an abandon that
 * carried a score would rank a half-finished game.
 */
export interface ProgressSnapshot {
  /** Per-game result block — must satisfy the backend `result_model`, if any. */
  result?: Record<string, unknown>;
}

export interface UseGameSyncReturn {
  /**
   * Start a new instrumented session. Call once after the game state is ready.
   * An open session it replaces is closed like `restart()` closes it.
   */
  start: (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => void;
  /**
   * Continue the session a killed app process left open for this game (#2654).
   * Call it when the screen restores saved progress, before `start()`. If that
   * session exists (started, unfinished, under 24 h old) the hook adopts it —
   * already started, no new create, no `game_started` — closes any session it
   * had open, and returns true. Otherwise it changes nothing and returns false,
   * and the screen starts its session as it normally would. `match` limits it
   * to a session whose metadata has those values (e.g. the puzzle id).
   */
  resume: (match?: Record<string, unknown>) => boolean;
  /**
   * Signal that the player has taken their first meaningful action. Must be
   * called before the unmount cleanup will fire an abandoned event, preventing
   * false abandons on games the player never actually started. Until it is
   * called (or the session completes) the session is not sent to the server
   * (#2654). Safe to call on every action — only the first one per session
   * reaches gameEventClient.
   */
  markStarted: () => void;
  /** Enqueue a gameplay event. No-ops if no session is open. */
  enqueue: (event: EnqueueEventInput) => void;
  /**
   * Mark the session as complete. Prevents the unmount handler from firing
   * an abandoned event. Safe to call multiple times — only the first fires.
   *
   * `summary.result` is the PATCH `result` block and must be passed
   * explicitly (#2619). `payload` is only the analytics `game_ended` event
   * data — it is never copied into the result.
   */
  complete: (summary: CompleteSummary, payload?: Record<string, unknown>) => void;
  /**
   * End the current session and immediately start a fresh one. If the old
   * session is still open, it is abandoned when the player started it
   * (`markStarted()`, the same rule as the unmount path) and otherwise
   * discarded via `gameEventClient.discardGame()`. Use this for
   * New Game / theme-switch flows.
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
   * (unmount or `restart()`), so the abandon carries the result block instead
   * of only `{ outcome: "abandoned" }`. The getter must read from refs (it runs
   * during unmount, after state is gone), must not throw, and — because
   * `restart()` calls it — must be called before the game resets its own refs.
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
    if (snapshot.result) summary.result = snapshot.result;
    try {
      gameEventClient.completeGame(gid, summary, { ...snapshot.result, outcome: "abandoned" });
    } catch {
      // Isolation.
    }
  }, []);

  // Close the open session, if any: abandoned when the player started it,
  // otherwise discarded — an untouched session is never left pending (#2619,
  // #2654). Either way the hook has no open session afterwards.
  const closeOpen = useCallback(() => {
    const gid = gameIdRef.current;
    gameIdRef.current = null;
    if (!gid || completedRef.current) return;
    if (startedRef.current) {
      abandon(gid);
      return;
    }
    try {
      gameEventClient.discardGame(gid);
    } catch {
      // Isolation.
    }
  }, [abandon]);

  // Close any open session on unmount.
  useEffect(() => closeOpen, [closeOpen]);

  const start = useCallback(
    (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      closeOpen();
      gameIdRef.current = gameEventClient.startGame(
        gameTypeRef.current,
        metadata ?? {},
        eventData ?? {}
      );
      completedRef.current = false;
      startedRef.current = false;
    },
    [closeOpen]
  );

  const resume = useCallback(
    (match?: Record<string, unknown>): boolean => {
      let gid: string | null = null;
      try {
        gid = gameEventClient.resumeGame(gameTypeRef.current, match);
      } catch {
        // Isolation: the caller starts a new session instead.
      }
      if (!gid) return false;
      closeOpen();
      gameIdRef.current = gid;
      completedRef.current = false;
      startedRef.current = true;
      return true;
    },
    [closeOpen]
  );

  const markStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const gid = gameIdRef.current;
    if (!gid) return;
    try {
      gameEventClient.markStarted(gid);
    } catch {
      // Isolation.
    }
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
    try {
      // The result block is summary.result only (#2619) — the event payload is
      // no longer copied into it.
      gameEventClient.completeGame(gid, summary, payload ?? {});
    } catch {
      // Isolation.
    }
    completedRef.current = true;
    gameIdRef.current = null;
  }, []);

  // Same as start(): it closes the open session before opening the new one.
  // Kept as its own name for the New Game / theme-switch call sites.
  const restart = start;

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
    resume,
    markStarted,
    enqueue,
    complete,
    restart,
    reportBug,
    getGameId,
    setProgressSnapshot,
  };
}
