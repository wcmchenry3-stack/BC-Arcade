import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { newGame, EngineState, DEFAULT_RULES, handValue, isNaturalBlackjack, Card } from "./engine";
import { GameRules } from "./types";
import { saveGame, loadGame, clearGame } from "./storage";
import { SessionStats, initialSessionStats, reduceHandResolved } from "./sessionStats";
import { useGameSync } from "../_shared/useGameSync";

/** Hint passed to apply() so the context can emit a typed player_action. */
export type PlayerActionHint = "hit" | "stand" | "double" | "split" | null;

interface BlackjackGameContextValue {
  engine: EngineState | null;
  loading: boolean;
  error: string | null;
  sessionStats: SessionStats;
  apply: (fn: (s: EngineState) => EngineState, action?: PlayerActionHint) => void;
  clearEvents: () => void;
  handleRulesChange: (rules: GameRules) => void;
  handlePlayAgain: () => void;
}

function activeHand(s: EngineState, idx: number): Card[] {
  if (s.player_hands.length > 0 && s.player_hands[idx]) return s.player_hands[idx];
  return s.player_hand;
}

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
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
  } = useGameSync("blackjack");
  const sessionStartedAtRef = useRef<number>(0);
  const totalHandsRef = useRef(0);
  const engineRef = useRef<EngineState | null>(null);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  const startSession = useCallback(
    (startingChips: number) => {
      sessionStartedAtRef.current = Date.now();
      totalHandsRef.current = 0;
      setSessionStats(initialSessionStats(startingChips));
      syncStart({ starting_chips: startingChips });
    },
    [syncStart]
  );

  const endSession = useCallback(
    (outcome: "completed" | "abandoned") => {
      const durationMs = Date.now() - sessionStartedAtRef.current;
      syncComplete(
        { outcome, durationMs },
        {
          total_hands: totalHandsRef.current,
          duration_ms: durationMs,
          outcome,
        }
      );
    },
    [syncComplete]
  );

  useEffect(() => {
    let active = true;
    loadGame()
      .then((saved) => {
        if (!active) return;
        const next = saved ?? newGame();
        setEngine(next);
        if (!saved) saveGame(next);
        // Start an instrumented session unless the loaded state is already
        // a chips-exhausted game-over state.
        if (!(next.chips === 0 && next.phase === "result")) {
          startSession(next.chips);
          // Resuming a saved mid-game means the player already started — mark it.
          if (saved) syncMarkStarted();
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

      // game_ended: chips exhausted in result phase
      if (next.chips === 0 && next.phase === "result") {
        endSession("completed");
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
      };
      setEngine(updated);
      saveGame(updated);
    },
    [engine]
  );

  const clearEvents = useCallback(() => {
    setEngine((prev) => (prev ? { ...prev, events: undefined } : null));
  }, []);

  const handlePlayAgain = useCallback(() => {
    // If a session is still open, close it out. When chips hit 0 mid-hand,
    // game_ended was already emitted by emitTransitionEvents — syncComplete
    // is idempotent and the guard in useGameSync makes this a no-op.
    // Otherwise we're mid-game and the user pressed New Game (abandon).
    endSession("abandoned");
    const fresh = newGame(undefined, { rules: engine?.rules ?? DEFAULT_RULES });
    setEngine(fresh);
    saveGame(fresh);
    setError(null);
    startSession(fresh.chips);
  }, [engine, endSession, startSession]);

  return (
    <BlackjackGameContext.Provider
      value={{
        engine,
        loading,
        error,
        sessionStats,
        apply,
        clearEvents,
        handleRulesChange,
        handlePlayAgain,
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
