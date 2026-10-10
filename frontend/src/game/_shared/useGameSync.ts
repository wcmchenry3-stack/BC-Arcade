/**
 * useGameSync — shared hook for game instrumentation lifecycle (#549).
 *
 * Wraps the gameEventClient session pattern every game screen needs: the
 * game id and completed bookkeeping, try/catch isolation on every client call,
 * and an abandon-on-unmount cleanup. Returns
 * `{ start, markStarted, resume, enqueue, complete, restart, close, reportBug, ... }`.
 *
 *   const { start, markStarted, enqueue, complete } = useGameSync("yacht");
 *   start({ initial_score: 0 });
 *   enqueue({ type: "roll", data: { dice: [1, 2, 3] } });
 *   complete({ finalScore: 250, outcome: "completed", result: { final_score: 250 } });
 *
 * Callers only call `complete()` on game-over paths; an unmount, `restart()` or
 * `start()` over an open session abandons it (or discards it if the player never
 * called `markStarted()`), and `setProgressSnapshot(getter)` lets those abandons
 * carry the per-game result block. The session lifecycle (deferred create, the
 * killed-process sweep and `resume()`), the active-play duration window
 * (`IDLE_GAP_CAP_MS`, pause on blur/background) and the abandon data rules are
 * specified in docs/GAME-CONTRACT.md §1.7 and §2.3, not repeated here.
 */

import { useCallback, useEffect, useRef } from "react";
import { foregroundNow } from "./foregroundClock";
import { assertOutcomeAllowed } from "./outcomeGuard";
import { gameEventClient, EnqueueEventInput } from "./gameEventClient";
import { CompleteSummary } from "./pendingGamesStore";
import type { GameType } from "./types";
import type { BugLevel } from "./eventQueueConfig";
import { useIsScreenFocused } from "../../hooks/useIsScreenFocused";

/**
 * What a game knows about its in-progress session when it is abandoned.
 *
 * Deliberately has no score: every backend leaderboard and /stats aggregate
 * keys on `final_score IS NOT NULL` and ignores `outcome`, so an abandon that
 * carried a score would rank a half-finished game.
 */
export interface ProgressSnapshot {
  /**
   * Per-game result block — must satisfy the backend `result_model`, if any.
   * While `outcome` is "win" it is also persisted with the override, and the
   * killed-process sweep's win carries it (#2745).
   */
  result?: Record<string, unknown>;
  /**
   * The game's own active play time, if it measures one. A value > 0 wins
   * over the hook's active-play window (#2684); anything else uses the window.
   */
  durationMs?: number | null;
  /**
   * Outcome override for the killed-process sweep (#2682): "win" once the
   * game has locked in a win that survives however the session ends (e.g.
   * Blackjack's run goal). The hook mirrors this to the device's persisted
   * session record on every player-activity ping, so a process kill before
   * the player reopens the game still closes it as a win, not `abandoned`.
   * Anything but "win" is ignored — an in-progress game reports nothing here.
   */
  outcome?: "win";
}

/**
 * The most one gap between player-activity pings adds to a session's duration
 * (#2684): a screen left awake and idle, or paused in-app, stops counting here.
 */
export const IDLE_GAP_CAP_MS = 10 * 60 * 1000;

/** A duration SyncWorker would send: finite and > 0 once rounded (#2619). */
function isKnownDuration(ms: number | null | undefined): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && Math.round(ms) > 0;
}

/** Foreground time since `from`, at most one idle gap's worth. */
function cappedGap(from: number): number {
  return Math.min(Math.max(0, foregroundNow() - from), IDLE_GAP_CAP_MS);
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
   * otherwise the hook's active-play window is sent in its place (#2684).
   *
   * Returns the id of the session it closed, or `null` if none was open (or
   * it was already completed) — so a caller that needs the id for a rank
   * lookup reads it here instead of via `getGameId()` beforehand, which
   * silently breaks if the read ever moves below this call (#2706).
   */
  complete: (summary: CompleteSummary, payload?: Record<string, unknown>) => string | null;
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
  /**
   * Restart the active-play window from zero, running (#2710): the next
   * session's duration counts from this call. For a screen that shows a new
   * puzzle before its session opens (at the first move) — the time on the menu
   * or the previous board before it is not play. Call it with no session open:
   * it drops whatever the window has counted, and does not touch the session.
   * Not needed after `start()`/`restart()`/`resume()`, which manage the window.
   */
  resetPlayWindow: () => void;
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

  // Active-play window (#2684): foreground time banked up to the last
  // player-activity ping (each gap capped), and foregroundNow() at that ping.
  // It runs from mount; a session ending pauses it at zero (#2710).
  const windowBankedRef = useRef(0);
  const fgAtLastPingRef = useRef<number | null>(null);
  const windowRunningRef = useRef(true);
  if (fgAtLastPingRef.current === null) fgAtLastPingRef.current = foregroundNow();

  // Screen focus (#2735): whether this screen is the one the player is
  // looking at, kept current for ping()/readWindow() below. A pushed screen
  // (Stats, Leaderboard, Scoreboard) blurs this one without unmounting it.
  const focused = useIsScreenFocused();
  const focusedRef = useRef(focused);
  useEffect(() => {
    if (focusedRef.current === focused) return;
    if (!focused && windowRunningRef.current) {
      // Bank whatever the window earned up to the blur, like a ping, then
      // hold: readWindow() below stops advancing until focus returns.
      windowBankedRef.current += cappedGap(fgAtLastPingRef.current ?? foregroundNow());
    }
    focusedRef.current = focused;
    // Regaining focus drops whatever elapsed while blurred: it counts from
    // now, not from the last ping before the screen was covered.
    if (focused) fgAtLastPingRef.current = foregroundNow();
  }, [focused]);

  const ping = useCallback(() => {
    // Mirror a "win" outcome override to the device (#2682), so a process
    // kill before the next ping still closes an unresumed session as a win.
    // A throwing getter, or anything but "win", is ignored; there is nothing
    // to persist for a game that never registered a snapshot.
    // The snapshot's result block goes with it (#2745), so the sweep's win
    // carries what this process's own abandon would have sent.
    const gid = gameIdRef.current;
    if (gid) {
      let snapshot: ProgressSnapshot = {};
      try {
        snapshot = snapshotRef.current() ?? {};
      } catch {
        // Isolation: a broken getter must not block the window update.
      }
      if (snapshot.outcome === "win") {
        // A game with no winner must never leave a "win" for the sweep (#2642).
        assertOutcomeAllowed(gameTypeRef.current, "win", "progressSnapshot");
        try {
          if (snapshot.result) gameEventClient.setProgressOutcome(gid, "win", snapshot.result);
          else gameEventClient.setProgressOutcome(gid, "win");
        } catch {
          // Isolation.
        }
      }
    }
    if (!windowRunningRef.current || !focusedRef.current) return;
    windowBankedRef.current += cappedGap(fgAtLastPingRef.current ?? foregroundNow());
    fgAtLastPingRef.current = foregroundNow();
  }, []);

  const readWindow = useCallback(
    (): number =>
      windowRunningRef.current && focusedRef.current
        ? windowBankedRef.current + cappedGap(fgAtLastPingRef.current ?? foregroundNow())
        : windowBankedRef.current,
    []
  );

  /** Restart the window from zero, running. */
  const restartWindow = useCallback(() => {
    windowBankedRef.current = 0;
    fgAtLastPingRef.current = foregroundNow();
    windowRunningRef.current = true;
  }, []);

  /** A session ended: zero the window and hold it until the next one. */
  const pauseWindow = useCallback(() => {
    windowBankedRef.current = 0;
    windowRunningRef.current = false;
  }, []);

  // Abandon the open session, attaching the game's progress snapshot if it
  // registered one. A throwing getter degrades to a bare abandon. The
  // duration is the snapshot's own when > 0, otherwise the active-play window.
  // A registered "win" (#2682) records a win instead — this same-process
  // unmount is otherwise the same loss the killed-process sweep guards
  // against (e.g. an ErrorBoundary elsewhere unmounting the game mid-session
  // after its run already reached its goal).
  const abandon = useCallback(
    (gid: string) => {
      let snapshot: ProgressSnapshot = {};
      try {
        snapshot = snapshotRef.current() ?? {};
      } catch {
        // Isolation: a broken getter must not lose the abandon.
      }
      const outcome = snapshot.outcome === "win" ? "win" : "abandoned";
      // Outside the isolation below, like complete()'s (#2642).
      assertOutcomeAllowed(gameTypeRef.current, outcome, "abandon");
      const summary: CompleteSummary = { outcome };
      if (snapshot.result) summary.result = snapshot.result;
      const durationMs = isKnownDuration(snapshot.durationMs) ? snapshot.durationMs : readWindow();
      if (isKnownDuration(durationMs)) summary.durationMs = durationMs;
      try {
        gameEventClient.completeGame(gid, summary, { ...snapshot.result, outcome });
      } catch {
        // Isolation.
      }
    },
    [readWindow]
  );

  // Close the open session, if any: abandoned when the player started it,
  // otherwise discarded — an untouched session is never left pending (#2619,
  // #2654). Either way the hook has no open session afterwards, and the
  // active-play window pauses at zero once the abandon has read it. With no
  // session open nothing changes, so a screen that opens its session at the
  // first move keeps the thinking time before it.
  const closeOpen = useCallback(() => {
    const gid = gameIdRef.current;
    gameIdRef.current = null;
    if (!gid || completedRef.current) return;
    if (startedRef.current) {
      abandon(gid);
    } else {
      try {
        gameEventClient.discardGame(gid);
      } catch {
        // Isolation.
      }
    }
    pauseWindow();
  }, [abandon, pauseWindow]);

  // Close any open session on unmount.
  useEffect(() => closeOpen, [closeOpen]);

  const start = useCallback(
    (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      closeOpen();
      // A paused window (a session ended) counts from here; a running one
      // keeps the time before the first move (#2710).
      if (!windowRunningRef.current) restartWindow();
      gameIdRef.current = gameEventClient.startGame(
        gameTypeRef.current,
        metadata ?? {},
        eventData ?? {}
      );
      completedRef.current = false;
      startedRef.current = false;
    },
    [closeOpen, restartWindow]
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
      // Play before the kill is unknown: the window counts from the resume
      // (an undercount, never an overcount).
      restartWindow();
      gameIdRef.current = gid;
      completedRef.current = false;
      startedRef.current = true;
      return true;
    },
    [closeOpen, restartWindow]
  );

  const markStarted = useCallback(() => {
    ping();
    if (startedRef.current) return;
    startedRef.current = true;
    const gid = gameIdRef.current;
    if (!gid) return;
    try {
      gameEventClient.markStarted(gid);
    } catch {
      // Isolation.
    }
  }, [ping]);

  const enqueue = useCallback(
    (event: EnqueueEventInput) => {
      ping();
      const gid = gameIdRef.current;
      if (!gid || completedRef.current) return;
      try {
        gameEventClient.enqueueEvent(gid, event);
      } catch {
        // Isolation.
      }
    },
    [ping]
  );

  const complete = useCallback(
    (summary: CompleteSummary, payload?: Record<string, unknown>): string | null => {
      // Outside the isolation below: in development a wrong outcome must fail loudly (#2642).
      assertOutcomeAllowed(gameTypeRef.current, summary.outcome, "complete");
      const gid = gameIdRef.current;
      if (!gid || completedRef.current) return null;
      // The game's own durationMs > 0 wins; otherwise the active-play window
      // (#2684), once it has counted anything.
      ping();
      let sent = summary;
      if (!isKnownDuration(summary.durationMs)) {
        const windowMs = readWindow();
        if (isKnownDuration(windowMs)) sent = { ...summary, durationMs: windowMs };
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
      pauseWindow();
      return gid;
    },
    [ping, readWindow, pauseWindow]
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
    resetPlayWindow: restartWindow,
    reportBug,
    getGameId,
    setProgressSnapshot,
  };
}
