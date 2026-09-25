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
 *   // End the current session the same way, without starting a new one
 *   close();
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
 *
 * Active-play clock (#2684): the hook times each session's foreground play, so
 * a game that does not measure its own active time still reports a duration.
 * The clock starts at `markStarted()` (or `resume()`), pauses while the app is
 * `background` or `inactive`, and starts again from zero for every new
 * session (`start()` / `restart()` / `resume()`). `complete()` sends the
 * game's own `summary.durationMs` when it is > 0, otherwise the clock's
 * reading. The hook's own abandons (unmount, and `start()` / `restart()` over
 * a started session) send the snapshot's `durationMs` when > 0, otherwise the
 * old session's clock. A never-started session reads 0 and sends no duration.
 * A session resumed after a killed process counts from the `resume()`: time
 * before the kill is lost (an undercount, never an overcount). It is never
 * wall-clock start-to-end time (#2619, `resolveDurationMs`).
 */

import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
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
  /**
   * The game's own active play time, if it measures one. A value > 0 wins
   * over the hook's active-play clock (#2684); anything else uses the clock.
   */
  durationMs?: number | null;
}

/** A duration SyncWorker would send: finite and > 0 once rounded (#2619). */
function isKnownDuration(ms: number | null | undefined): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && Math.round(ms) > 0;
}

/** Only `background` and `inactive` pause the clock; anything else is foreground. */
function isForeground(state: unknown): boolean {
  return state !== "background" && state !== "inactive";
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
   *
   * `summary.durationMs` > 0 (the game's own active time) is sent as given;
   * otherwise the hook's active-play clock is sent in its place (#2684).
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
  /**
   * End the open session, if any, without starting another: abandoned (with
   * the registered progress snapshot) when the player started it, otherwise
   * discarded via `gameEventClient.discardGame()` — the same rule as the
   * unmount path and `restart()`. A no-op once the session is completed. Use
   * it when the player leaves a session that should record no result (e.g.
   * Blackjack's New Game before any hand was played, #2628).
   */
  close: () => void;
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

  // Active-play clock (#2684): time banked from finished foreground segments,
  // plus the running segment's start (null while paused or not running).
  const clockBankedRef = useRef(0);
  const clockSegmentStartRef = useRef<number | null>(null);
  const clockRunningRef = useRef(false);
  const foregroundRef = useRef<boolean | null>(null);
  if (foregroundRef.current === null) {
    let state: unknown = null;
    try {
      state = AppState.currentState;
    } catch {
      // Isolation: assume foreground.
    }
    foregroundRef.current = isForeground(state);
  }

  const readClock = useCallback((): number => {
    const segmentStart = clockSegmentStartRef.current;
    const running = segmentStart !== null ? Math.max(0, Date.now() - segmentStart) : 0;
    return clockBankedRef.current + running;
  }, []);

  const resetClock = useCallback(() => {
    clockBankedRef.current = 0;
    clockSegmentStartRef.current = null;
    clockRunningRef.current = false;
  }, []);

  const startClock = useCallback(() => {
    if (clockRunningRef.current) return;
    clockRunningRef.current = true;
    if (foregroundRef.current) clockSegmentStartRef.current = Date.now();
  }, []);

  // One subscription for the hook's lifetime: bank the running segment when
  // the app leaves the foreground, open a new one when it comes back.
  useEffect(() => {
    let sub: { remove?: () => void } | undefined;
    try {
      sub = AppState.addEventListener("change", (next: AppStateStatus) => {
        if (isForeground(next)) {
          foregroundRef.current = true;
          if (clockRunningRef.current && clockSegmentStartRef.current === null) {
            clockSegmentStartRef.current = Date.now();
          }
          return;
        }
        foregroundRef.current = false;
        const segmentStart = clockSegmentStartRef.current;
        if (segmentStart !== null) {
          clockBankedRef.current += Math.max(0, Date.now() - segmentStart);
          clockSegmentStartRef.current = null;
        }
      });
    } catch {
      // Isolation: without the subscription the clock never pauses.
    }
    return () => sub?.remove?.();
  }, []);

  // Abandon the open session, attaching the game's progress snapshot if it
  // registered one. A throwing getter degrades to a bare abandon. The
  // duration is the snapshot's own when > 0, otherwise the active-play clock.
  const abandon = useCallback(
    (gid: string) => {
      let snapshot: ProgressSnapshot = {};
      try {
        snapshot = snapshotRef.current() ?? {};
      } catch {
        // Isolation: a broken getter must not lose the abandon.
      }
      const summary: CompleteSummary = { outcome: "abandoned" };
      if (snapshot.result) summary.result = snapshot.result;
      const durationMs = isKnownDuration(snapshot.durationMs) ? snapshot.durationMs : readClock();
      if (isKnownDuration(durationMs)) summary.durationMs = durationMs;
      try {
        gameEventClient.completeGame(gid, summary, { ...snapshot.result, outcome: "abandoned" });
      } catch {
        // Isolation.
      }
    },
    [readClock]
  );

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
      // The old session's abandon reads its clock; only then is it reset.
      closeOpen();
      resetClock();
      gameIdRef.current = gameEventClient.startGame(
        gameTypeRef.current,
        metadata ?? {},
        eventData ?? {}
      );
      completedRef.current = false;
      startedRef.current = false;
    },
    [closeOpen, resetClock]
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
      // Play before the kill is unknown: count from now (undercount, never over).
      resetClock();
      startClock();
      return true;
    },
    [closeOpen, resetClock, startClock]
  );

  const markStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startClock();
    const gid = gameIdRef.current;
    if (!gid) return;
    try {
      gameEventClient.markStarted(gid);
    } catch {
      // Isolation.
    }
  }, [startClock]);

  const enqueue = useCallback((event: EnqueueEventInput) => {
    const gid = gameIdRef.current;
    if (!gid || completedRef.current) return;
    try {
      gameEventClient.enqueueEvent(gid, event);
    } catch {
      // Isolation.
    }
  }, []);

  const complete = useCallback(
    (summary: CompleteSummary, payload?: Record<string, unknown>) => {
      const gid = gameIdRef.current;
      if (!gid || completedRef.current) return;
      // The game's own durationMs > 0 wins; otherwise the active-play clock
      // (#2684), once it has counted anything.
      let sent = summary;
      if (!isKnownDuration(summary.durationMs)) {
        const clockMs = readClock();
        if (isKnownDuration(clockMs)) sent = { ...summary, durationMs: clockMs };
      }
      try {
        // The result block is summary.result only (#2619) — the event payload is
        // no longer copied into it.
        gameEventClient.completeGame(gid, sent, payload ?? {});
      } catch {
        // Isolation.
      }
      completedRef.current = true;
      gameIdRef.current = null;
      resetClock();
    },
    [readClock, resetClock]
  );

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
    close: closeOpen,
    reportBug,
    getGameId,
    setProgressSnapshot,
  };
}
