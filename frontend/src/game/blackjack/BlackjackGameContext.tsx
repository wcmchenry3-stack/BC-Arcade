import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  newGame,
  newHand,
  EngineState,
  DEFAULT_RULES,
  handValue,
  isNaturalBlackjack,
  Card,
} from "./engine";
import { GameRules } from "./types";
import { saveGame, loadGame, clearGame, saveRun, loadRuns, RunRecord } from "./storage";
import {
  SessionStats,
  initialSessionStats,
  isWinningHand,
  reduceHandResolved,
} from "./sessionStats";
import { useGameSync } from "../_shared/useGameSync";
import type { GameOutcome } from "../../api/vocab";
import { TABLE_CONFIGS, TableConfig, tableForBetLimits } from "./tables";
import { saveLastDifficulty } from "../_shared/lastDifficulty";
import { isPremiumLevel } from "../../entitlements/premiumLevels";

/** Hint passed to apply() so the context can emit a typed player_action. */
export type PlayerActionHint = "hit" | "stand" | "double" | "split" | null;

interface BlackjackGameContextValue {
  engine: EngineState | null;
  loading: boolean;
  error: string | null;
  sessionStats: SessionStats;
  lowestChips: number;
  /**
   * Once the chips have run out: the result the run recorded (#2628) — `win`
   * if it reached its goal before Keep Playing, else `loss`. Null otherwise.
   * The game-over card shows it, so the card and the `games` row agree.
   */
  runResult: "win" | "loss" | null;
  apply: (fn: (s: EngineState) => EngineState, action?: PlayerActionHint) => void;
  clearEvents: () => void;
  handleRulesChange: (rules: GameRules) => void;
  handlePlayAgain: () => void;
  handleTableSelect: (config: TableConfig) => void;
  /** End the completed run and return to table-select state. */
  handleCashOut: () => Promise<void>;
  /** Continue playing at the same table without a run goal. */
  handleKeepPlaying: () => void;
}

function activeHand(s: EngineState, idx: number): Card[] {
  if (s.player_hands.length > 0 && s.player_hands[idx]) return s.player_hands[idx];
  return s.player_hand;
}

/**
 * True when this state shows the run has reached its goal (#2628): the victory
 * phase, or Keep Playing after it. Keep Playing sets `reachedRunGoal`; a save
 * from an older build has only `runGoal: null` at a table's bet limits, which
 * nothing else produces (a fresh `newGame()` has limits that match no table).
 */
function hasReachedGoal(s: EngineState): boolean {
  if (s.phase === "victory" || s.reachedRunGoal != null) return true;
  return s.runGoal === null && tableForBetLimits(s) !== undefined;
}

/** The table id a run is played at, "beginner" when its limits match none. */
function tableIdFor(s: EngineState): TableConfig["id"] {
  return (tableForBetLimits(s) ?? TABLE_CONFIGS[0]!).id;
}

/** What a run records on its `games` row (#2628, §8.8). */
type RunOutcome = NonNullable<RunRecord["outcome"]>;

const BlackjackGameContext = createContext<BlackjackGameContextValue | null>(null);

export function BlackjackGameProvider({ children }: { children: React.ReactNode }) {
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>(() => initialSessionStats(0));

  // Instrumentation session state (#370 / #549). Session = one blackjack game
  // from chip allocation until chips=0 OR the provider unmounts.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
    close: syncClose,
    setProgressSnapshot: syncSetProgressSnapshot,
    getGameId: syncGetGameId,
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("blackjack");
  // The outcome endSession recorded for the current session (#2628); null
  // until it ends. Drives runResult.
  const [recordedResult, setRecordedResult] = useState<RunOutcome | null>(null);
  const sessionStartedAtRef = useRef<number>(0);
  const totalHandsRef = useRef(0);
  // Hands won this session — counted with isWinningHand, the same rule the
  // on-screen stats use.
  const handsWonRef = useRef(0);
  // Chips when THIS session began. A resumed run starts a new session mid-run, so
  // engine.startingChips (the run's opening balance) would make a session with no
  // hands look profitable — the hand counters are per-session, so chips must be too.
  // A session continued after a relaunch (#2654) counts from the relaunch, like
  // the hand counters, which do not survive the process.
  const sessionStartChipsRef = useRef<number | null>(null);
  const lowestChipsRef = useRef(0);
  const biggestWinRef = useRef(0);
  // #2628 — set the first time this run reaches its goal and kept until the
  // session ends, so a player who chose Keep Playing and later ran out of chips
  // still records a win (§8.8).
  const goalReachedRef = useRef(false);
  // The session's chip low at the moment the goal was first reached — what a
  // comeback is judged on, since a bust after Keep Playing drives lowestChips
  // to 0. Null while the goal is not reached, or when the session began past
  // it (a resumed run), where the low before the goal is not known here.
  const lowestChipsBeforeGoalRef = useRef<number | null>(null);
  // True when this session continues the one a killed process left open
  // (#2654): its hands were played before the relaunch, so it records a result
  // even with no hand played since.
  const resumedRef = useRef(false);
  // True once endSession has closed this session. A bust-out ends the session
  // and the Play Again that follows calls endSession again: that second call
  // must not save the same run twice.
  const sessionEndedRef = useRef(false);
  const engineRef = useRef<EngineState | null>(null);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  // #2450 / #2619 — the session's result block (backend BlackjackResult). The
  // hook's own abandon (unmount) and endSession (win, loss or abandoned) both
  // build it here. `finalChips` overrides engineRef for the chips-exhausted path.
  const sessionResult = useCallback(
    (finalChips?: number) => ({
      hands_won: handsWonRef.current,
      hands_played: totalHandsRef.current,
      starting_chips: sessionStartChipsRef.current,
      final_chips: finalChips ?? engineRef.current?.chips ?? null,
    }),
    []
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: sessionResult() }));
  }, [syncSetProgressSnapshot, sessionResult]);

  const startSession = useCallback(
    async (startingChips: number, resuming = false, tableId?: string, goalReached = false) => {
      sessionStartedAtRef.current = Date.now();
      totalHandsRef.current = 0;
      handsWonRef.current = 0;
      sessionStartChipsRef.current = startingChips;
      lowestChipsRef.current = startingChips;
      biggestWinRef.current = 0;
      goalReachedRef.current = goalReached;
      lowestChipsBeforeGoalRef.current = null;
      resumedRef.current = false;
      sessionEndedRef.current = false;
      setRecordedResult(null);
      setSessionStats(initialSessionStats(startingChips));
      // A saved mid-game continues the session a killed app left open (#2654).
      if (resuming && syncResume()) {
        resumedRef.current = true;
        return;
      }
      // Load run history to compute aggregate metadata for the backend game row.
      // Runs saved in the *previous* endSession call are included because saveRun
      // is awaited before startSession is invoked from handleTableSelect, and because
      // the initial-load path never has a preceding saveRun. The minor race that
      // can occur if endSession fires saveRun fire-and-forget (chips=0 path) means
      // the newly-completed run may not yet appear — off by one, self-corrects next
      // session start.
      const runs = await loadRuns();
      const totalRuns = runs.length;
      const runsCompleted = runs.filter((r) => r.completed).length;
      const bestRunChips =
        runs.length > 0 ? runs.reduce((m, r) => Math.max(m, r.finalChips), 0) : null;
      syncStart(
        { starting_chips: startingChips },
        {
          best_run_chips: bestRunChips,
          total_runs: totalRuns,
          runs_completed: runsCompleted,
          current_table: (tableId ?? "beginner") as "beginner" | "intermediate" | "high_roller",
        }
      );
      // Mark the session as already started when resuming a mid-game save.
      // Must come after syncStart so the game ID exists.
      if (resuming) syncMarkStarted();
    },
    [syncStart, syncResume, syncMarkStarted]
  );

  const endSession = useCallback(
    // `finalState` is the run's resolved final state. The chips-exhausted path
    // must pass it: it runs inside emitTransitionEvents, before engineRef
    // catches up to `next` (#2469 item 4). The other paths default to engineRef.
    async (outOfChips: boolean, finalState?: EngineState) => {
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;
      // A session with no hand played records no result (#2628): New Game on
      // the betting screen, or a goal-reached save whose old session could not
      // be continued. close() discards it, or abandons it if it was marked
      // started. A resumed session played its hands before the relaunch.
      if (!resumedRef.current && totalHandsRef.current === 0) {
        syncClose();
        return;
      }
      const final = finalState ?? engineRef.current;
      const result = sessionResult(final?.chips);
      // #2628 / §8.8: a run that reached its goal is a win however it ends;
      // running out of chips before the goal is a loss; any other end before
      // the goal (New Game, a cash-out) is an abandon.
      const goalReached = goalReachedRef.current;
      const runOutcome: RunOutcome = goalReached ? "win" : outOfChips ? "loss" : "abandoned";
      // Every RunOutcome is a GameOutcome value as it stands.
      const outcome: GameOutcome = runOutcome;
      setRecordedResult(runOutcome);
      // No durationMs of its own (#2684): wall-clock time since the session
      // began would count backgrounded time, so useGameSync's active-play
      // window supplies it.
      syncComplete(
        { outcome, result },
        {
          total_hands: totalHandsRef.current,
          outcome,
          ...result,
        }
      );
      // Persist a run record when the player actually played hands. Awaited so
      // that the subsequent startSession call (in handlePlayAgain) sees the
      // newly saved run when it loads run history for aggregate metadata.
      if (final && totalHandsRef.current > 0) {
        await saveRun({
          table: tableIdFor(final),
          startingChips: final.startingChips,
          finalChips: final.chips,
          // Keep Playing clears runGoal; the run's goal is kept in reachedRunGoal.
          runGoal: final.runGoal ?? final.reachedRunGoal ?? null,
          completed: goalReached,
          outcome: runOutcome,
          handsPlayed: totalHandsRef.current,
          biggestWin: biggestWinRef.current,
          lowestChips: lowestChipsRef.current,
          // A session begun past its goal does not know the low before it; the
          // run's opening balance then stands in, so it is never a comeback
          // here (the Victory screen judged that at the goal).
          lowestChipsBeforeGoal: goalReached
            ? (lowestChipsBeforeGoalRef.current ?? final.startingChips)
            : undefined,
          startedAt: sessionStartedAtRef.current,
          endedAt: Date.now(),
        });
      }
    },
    [syncComplete, syncClose, sessionResult]
  );

  useEffect(() => {
    let active = true;
    loadGame()
      .then((saved) => {
        if (!active) return;
        const next = saved ?? newGame();
        setEngine(next);
        if (!saved) saveGame(next);
        // Fresh game with no table selected yet — session starts after table pick.
        const tableSelectPending =
          !saved && next.runGoal === null && next.chips === next.startingChips && next.bet === 0;
        // Start an instrumented session unless table selection is pending or the
        // loaded state is already a chips-exhausted game-over state. Pass
        // resuming=true for saved mid-game states so syncMarkStarted fires after syncStart.
        // A saved run that already reached its goal (victory, or Keep Playing)
        // stays a win when it ends (#2628).
        if (!tableSelectPending && !(next.chips === 0 && next.phase === "result")) {
          void startSession(next.chips, !!saved, tableIdFor(next), hasReachedGoal(next));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount cleanup is handled by useGameSync (abandons any open session).

  // Clear storage when player runs out of chips so relaunch starts fresh.
  useEffect(() => {
    if (engine && engine.chips === 0 && engine.phase === "result") {
      clearGame();
    }
  }, [engine]);

  const emitTransitionEvents = useCallback(
    (prev: EngineState, next: EngineState, action: PlayerActionHint) => {
      // #2628 — the run reached its goal. Kept for the rest of the session.
      // The chip low so far is the low before the goal; no later hand of this
      // run can change a comeback to the goal (fix for a bust after Keep Playing).
      if (!goalReachedRef.current && hasReachedGoal(next)) {
        goalReachedRef.current = true;
        lowestChipsBeforeGoalRef.current = lowestChipsRef.current;
      }

      // bet_placed + hand_dealt: betting → player/result with a fresh deal.
      // Read chips_remaining from prev.chips, not next.chips — placeBet can
      // settle immediately on a natural blackjack, and next.chips would then
      // reflect the post-settlement balance, not the chips the player has
      // after merely locking in the bet. (closes #503)
      if (prev.phase === "betting" && next.phase !== "betting") {
        syncMarkStarted();
        syncEnqueue({
          type: "bet_placed",
          data: {
            amount: next.bet,
            chips_remaining: Math.max(0, prev.chips - next.bet),
          },
        });
        syncEnqueue({
          type: "hand_dealt",
          data: {
            player_hand: next.player_hand,
            dealer_up_card: next.dealer_hand[0] ?? null,
            is_player_blackjack: isNaturalBlackjack(next.player_hand),
          },
        });
      }

      // player_action: hit / stand / double / split during player phase
      if (prev.phase === "player" && action) {
        const handIdx = prev.active_hand_index;
        // For stand, the hand value is taken from prev (no card added).
        // For hit/double/split, take it from next (the new card is there).
        const sourceState = action === "stand" ? prev : next;
        const hand = activeHand(sourceState, handIdx);
        syncEnqueue({
          type: "player_action",
          data: {
            action,
            hand_index: handIdx,
            hand_value_after: handValue(hand),
          },
        });
      }

      // hand_resolved (single-hand): outcome just got filled in
      const prevHadNoSplit = prev.player_hands.length === 0;
      const nextHasNoSplit = next.player_hands.length === 0;
      if (prevHadNoSplit && nextHasNoSplit && prev.outcome === null && next.outcome !== null) {
        totalHandsRef.current += 1;
        if (isWinningHand(next.outcome)) handsWonRef.current += 1;
        if (next.chips < lowestChipsRef.current) lowestChipsRef.current = next.chips;
        if (next.payout > biggestWinRef.current) biggestWinRef.current = next.payout;
        syncEnqueue({
          type: "hand_resolved",
          data: {
            hand_index: 0,
            outcome: next.outcome,
            payout_delta: next.payout,
            chips_after: next.chips,
          },
        });
        setSessionStats((s) =>
          reduceHandResolved(s, {
            outcome: next.outcome!,
            payoutDelta: next.payout,
            chipsAfter: next.chips,
            isBust: handValue(next.player_hand) > 21,
          })
        );
      }

      // hand_resolved (split): scan for newly-filled hand_outcomes slots
      const outLen = next.hand_outcomes.length;
      for (let i = 0; i < outLen; i++) {
        const pOut = prev.hand_outcomes[i] ?? null;
        const nOut = next.hand_outcomes[i] ?? null;
        if (pOut === null && nOut !== null) {
          totalHandsRef.current += 1;
          if (isWinningHand(nOut)) handsWonRef.current += 1;
          if (next.chips < lowestChipsRef.current) lowestChipsRef.current = next.chips;
          const splitPayout = next.hand_payouts[i] ?? 0;
          if (splitPayout > biggestWinRef.current) biggestWinRef.current = splitPayout;
          syncEnqueue({
            type: "hand_resolved",
            data: {
              hand_index: i,
              outcome: nOut,
              payout_delta: next.hand_payouts[i] ?? 0,
              chips_after: next.chips,
            },
          });
          const splitHand = next.player_hands[i] ?? [];
          // engine.hand_outcomes is typed (string | null)[] but only ever
          // populated with "win" | "lose" | "push" values via settleHand —
          // narrow at the call site for the reducer's HandOutcome union.
          setSessionStats((s) =>
            reduceHandResolved(s, {
              outcome: nOut as "win" | "lose" | "push",
              payoutDelta: next.hand_payouts[i] ?? 0,
              chipsAfter: next.chips,
              isBust: handValue(splitHand) > 21,
            })
          );
        }
      }

      // game_ended: chips exhausted in result phase — a loss, or a win when
      // the run reached its goal before Keep Playing (#2628). Fire-and-forget:
      // the next startSession (from handlePlayAgain) may see this run's saveRun
      // slightly late, off by one, self-corrects on the following session.
      if (next.chips === 0 && next.phase === "result") {
        void endSession(true, next);
      }
    },
    [endSession, syncEnqueue, syncMarkStarted]
  );

  const apply = useCallback(
    (fn: (s: EngineState) => EngineState, action: PlayerActionHint = null) => {
      if (!engine) return;
      setError(null);
      try {
        const prev = engine;
        const next = fn(prev);
        setEngine(next);
        saveGame({ ...next, events: undefined });
        emitTransitionEvents(prev, next, action);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [engine, emitTransitionEvents]
  );

  const handleRulesChange = useCallback(
    (rules: GameRules) => {
      if (!engine || engine.phase !== "betting") return;
      const updated: EngineState = {
        ...newGame(undefined, { rules }),
        chips: engine.chips,
        runGoal: engine.runGoal,
        startingChips: engine.startingChips,
        betMin: engine.betMin,
        betMax: engine.betMax,
        milestones: engine.milestones,
        milestones_reached: engine.milestones_reached,
        hitLowChips: engine.hitLowChips,
        comebackEmitted: engine.comebackEmitted,
        reachedRunGoal: engine.reachedRunGoal,
      };
      setEngine(updated);
      saveGame(updated);
    },
    [engine]
  );

  const clearEvents = useCallback(() => {
    setEngine((prev) => (prev ? { ...prev, events: undefined } : null));
  }, []);

  const handlePlayAgain = useCallback(async () => {
    // If a session is still open, close it out. When chips hit 0 mid-hand,
    // game_ended was already emitted by emitTransitionEvents, so endSession
    // does nothing. Otherwise we're mid-game and the user pressed New Game:
    // an abandon, or a win if the run already reached its goal (#2628).
    await endSession(false);
    // Create a fresh engine in table-select-pending state (runGoal=null).
    // startSession is deferred to handleTableSelect after the user picks a table.
    const fresh = newGame(undefined, { rules: engine?.rules ?? DEFAULT_RULES });
    setEngine(fresh);
    saveGame(fresh);
    setError(null);
  }, [engine, endSession]);

  const handleCashOut = useCallback(async () => {
    // Offered once the goal is reached, so this records a win (#2628).
    await endSession(false);
    const fresh = newGame(undefined, { rules: engine?.rules ?? DEFAULT_RULES });
    setEngine(fresh);
    saveGame(fresh);
    setError(null);
  }, [engine, endSession]);

  const handleKeepPlaying = useCallback(() => {
    if (!engine) return;
    // The goal is cleared so play goes on past it; reachedRunGoal keeps the
    // fact that this run was won, for saves and resumes (#2628).
    const next: EngineState = {
      ...newHand(engine),
      runGoal: null,
      reachedRunGoal: engine.reachedRunGoal ?? engine.runGoal ?? undefined,
    };
    setEngine(next);
    saveGame(next);
    setError(null);
  }, [engine]);

  // Every table start (table select, Next Table) comes through here (#1129).
  const handleTableSelect = useCallback(
    (config: TableConfig) => {
      // A premium table never starts; callers show the premium notice instead.
      if (isPremiumLevel("blackjack", config.id)) return;
      void saveLastDifficulty("blackjack", config.id);
      const fresh = newGame(undefined, {
        startingChips: config.startingChips,
        runGoal: config.runGoal,
        betMin: config.betMin,
        betMax: config.betMax,
        milestones: config.milestones,
        rules: engine?.rules ?? DEFAULT_RULES,
      });
      setEngine(fresh);
      saveGame(fresh);
      setError(null);
      // The run's play time starts at the table pick: time on the table picker
      // is not play (#2710). With a session open, startSession's syncStart()
      // closes it and starts the window over itself, so the window is only
      // reset when none is.
      if (!syncGetGameId()) syncResetPlayWindow();
      void startSession(fresh.chips, false, config.id);
    },
    [engine, startSession, syncGetGameId, syncResetPlayWindow]
  );

  // A bust-out ends the session as a win or a loss. A game-over state loaded
  // at launch ended in an earlier process: its result is read from the state.
  const outOfChips = engine !== null && engine.chips === 0 && engine.phase === "result";
  const runResult: "win" | "loss" | null = !outOfChips
    ? null
    : recordedResult === "win" || recordedResult === "loss"
      ? recordedResult
      : hasReachedGoal(engine)
        ? "win"
        : "loss";

  return (
    <BlackjackGameContext.Provider
      value={{
        engine,
        loading,
        error,
        sessionStats,
        lowestChips: lowestChipsRef.current,
        runResult,
        apply,
        clearEvents,
        handleRulesChange,
        handlePlayAgain,
        handleTableSelect,
        handleCashOut,
        handleKeepPlaying,
      }}
    >
      {children}
    </BlackjackGameContext.Provider>
  );
}

export function useBlackjackGame(): BlackjackGameContextValue {
  const ctx = useContext(BlackjackGameContext);
  if (!ctx) throw new Error("useBlackjackGame must be used within BlackjackGameProvider");
  return ctx;
}

export function useBlackjackSessionStats(): SessionStats {
  return useBlackjackGame().sessionStats;
}
