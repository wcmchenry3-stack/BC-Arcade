/**
 * The computer opponent of a Yacht VS game (#2981): its scorecard, whose turn
 * it is, and the paced turn loop that plays the computer's turn on screen.
 *
 * `startTurn()` hands the computer its turn. The loop rolls, shows each hold
 * decision, re-rolls up to twice and scores, with pauses the player can
 * follow; then it hands control back (`isTurn` goes false; the scorecard is
 * `state`). Ending the turn (`endTurn`, a new game) or unmounting
 * cancels a running loop at its next step.
 *
 * A turn that throws is reported and finished with `finishTurnFallback`, so
 * the computer never falls a round behind and the VS result still shows
 * (#2203). A saved game killed mid-turn resumes it (`resumeTurn`), keeping
 * the dice already rolled.
 *
 * The hook adds no AppState listener: the screen keeps one combined listener
 * and calls `onAppBackground()` from it (#1850).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { roll as engineRoll, score as engineScore } from "./engine";
import { holdStrategy, scoreStrategy } from "./ai";
import { preloadOracleTable } from "./oracle/oracle";
import { finishTurnFallback } from "./vsTurn";
import type { AiDifficulty, GameState } from "./types";

/** Pacing of the computer's turn, in ms. */
const ROLL_MS = 1000;
const SETTLE_MS = 800;
const HOLD_MS = 800;
const SCORE_BEAT_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface YachtCpuOpponentOptions {
  /** The computer's difficulty; null in a solo game (no opponent). */
  difficulty: AiDifficulty | null;
  /** The computer's scorecard of a restored game. */
  initialState?: GameState | null;
  /** True when a restored game was killed mid-way through the computer's turn. */
  resumeTurn?: boolean;
}

export interface YachtCpuOpponent {
  /** The computer's scorecard; null in a solo game. */
  state: GameState | null;
  setState: (state: GameState | null) => void;
  /** Latest values, for handlers and async work that outlive a render. */
  stateRef: { readonly current: GameState | null };
  difficultyRef: { readonly current: AiDifficulty | null };
  /** True while the computer plays its turn; the player's board is locked. */
  isTurn: boolean;
  /** The computer's dice rolling right now, for the roll animation. */
  rollingIndices: readonly number[];
  startTurn: () => void;
  /** Ends (and cancels) the computer's turn, e.g. for a new game. */
  endTurn: () => void;
  /** Call when the app leaves the foreground: drops the roll animation. */
  onAppBackground: () => void;
}

export function useYachtCpuOpponent({
  difficulty,
  initialState = null,
  resumeTurn = false,
}: YachtCpuOpponentOptions): YachtCpuOpponent {
  const [state, setState] = useState<GameState | null>(initialState);
  const [isTurn, setIsTurn] = useState(resumeTurn);
  const [rollingIndices, setRollingIndices] = useState<readonly number[]>([]);
  const cancelledRef = useRef(false);

  // Mirrors for the async turn loop and the screen's callbacks.
  const difficultyRef = useRef(difficulty);
  useEffect(() => {
    difficultyRef.current = difficulty;
    // Decode the AI's optimal-play table before its first turn (#2246). If
    // this fails, the AI decodes it on demand instead, so just record it.
    if (difficulty) preloadOracleTable().catch((e) => Sentry.captureException(e));
  }, [difficulty]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isTurnRef = useRef(isTurn);
  useEffect(() => {
    isTurnRef.current = isTurn;
  }, [isTurn]);

  // The turn loop: runs whenever the computer's turn starts.
  useEffect(() => {
    if (!isTurn || !difficultyRef.current || !stateRef.current) return;

    cancelledRef.current = false;

    // The AI's state as of its last completed step, so a failure part-way
    // through can finish the turn from there.
    let s = stateRef.current;

    async function runAiTurn() {
      const diff = difficultyRef.current!;

      if (s.rolls_used === 0) {
        // Initial roll (all dice free) — compute result first so animation plays over final values.
        s = engineRoll(s, [false, false, false, false, false]);
        setState(s);
        setRollingIndices([0, 1, 2, 3, 4]);
        await delay(ROLL_MS);
        if (cancelledRef.current) return;
        setRollingIndices([]);
      }
      // Resuming a turn interrupted after it had rolled (app killed, or the
      // effect re-ran) keeps the dice it already has rather than re-rolling
      // them — and with all three rolls used, re-rolling would throw (#2203).
      // Settle pause: let the player read the dice values
      await delay(SETTLE_MS);
      if (cancelledRef.current) return;

      // Up to two re-rolls using hold strategy
      while (s.rolls_used < 3) {
        const holds = holdStrategy(s, diff);
        if (holds.every((h) => h)) break; // all dice held — go straight to scoring
        // Show hold decision on current values so the player sees the AI's choice
        setState({ ...s, held: holds });
        await delay(HOLD_MS);
        if (cancelledRef.current) return;
        const rolledIdxs = holds.reduce<number[]>((acc, h, i) => {
          if (!h) acc.push(i);
          return acc;
        }, []);
        // Compute result before starting animation
        s = engineRoll(s, holds);
        setState(s);
        setRollingIndices(rolledIdxs);
        await delay(ROLL_MS);
        if (cancelledRef.current) return;
        setRollingIndices([]);
        await delay(SETTLE_MS);
        if (cancelledRef.current) return;
      }

      // Beat before the AI locks in its category
      await delay(SCORE_BEAT_MS);
      if (cancelledRef.current) return;
      const cat = scoreStrategy(s, diff);
      s = engineScore(s, cat);
      setState(s);
      setIsTurn(false);
    }

    // If the turn fails, report it and finish the computer's turn with a
    // plain fallback before handing back control. Just unlocking would leave
    // the computer a round behind for good, so its game could never end and
    // the VS result screen would never show (#2203).
    runAiTurn().catch((e: unknown) => {
      Sentry.captureException(e, { tags: { subsystem: "yacht.ai", op: "runAiTurn" } });
      if (cancelledRef.current) return;
      setRollingIndices([]);
      try {
        s = finishTurnFallback(s);
        setState(s);
      } catch (fallbackError: unknown) {
        // Last resort: unlock the board rather than freeze it.
        Sentry.captureException(fallbackError, {
          tags: { subsystem: "yacht.ai", op: "finishTurnFallback" },
        });
      }
      setIsTurn(false);
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [isTurn]);

  const startTurn = useCallback(() => setIsTurn(true), []);
  const endTurn = useCallback(() => setIsTurn(false), []);
  const onAppBackground = useCallback(() => {
    if (isTurnRef.current) setRollingIndices([]);
  }, []);

  return {
    state,
    setState,
    stateRef,
    difficultyRef,
    isTurn,
    rollingIndices,
    startTurn,
    endTurn,
    onAppBackground,
  };
}
