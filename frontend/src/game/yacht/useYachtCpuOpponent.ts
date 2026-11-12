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
 *
 * Pacing (#3749) is in `motion.ts`: a roll is its tumble plus a short settle,
 * then a hold, a re-roll, and a beat before it scores. Its last turn after
 * your last score (`startTurn({ lastTurn: true })`) plays at 2x; under Reduce
 * Motion (read live, per step) its pauses are halved and its dice don't
 * tumble, but it still plays step by step. A game reopened on that last turn
 * (`resumeInstantly`) has it scored at once, silently, with no steps.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import {
  roll as engineRoll,
  score as engineScore,
  possibleScores as enginePossibleScores,
  CATEGORIES,
  type Category,
} from "./engine";
import { holdStrategy, scoreEvs, scoreStrategy } from "./ai";
import { createTurnLog, reportRecordingError, type TurnData } from "./replay";
import { preloadOracleTable } from "./oracle/oracle";
import { finishTurnFallback } from "./vsTurn";
import type { AiDifficulty, GameState } from "./types";
import {
  CPU_HOLD_MS,
  CPU_SCORE_BEAT_MS,
  CPU_SETTLE_MS,
  cpuTurnSpeed,
  tumbleTotalMs,
} from "./motion";

const ALL_FREE = [false, false, false, false, false];

/** The dice a roll with `held` re-rolls, left to right. */
function freeIndices(held: readonly boolean[]): number[] {
  return held.reduce<number[]>((acc, h, i) => {
    if (!h) acc.push(i);
    return acc;
  }, []);
}

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
  /**
   * Called once per finished turn, right after the computer scores, with the
   * turn for the replay (#3282). Nothing is collected, and the oracle is not
   * asked for the turn's EVs, when it is not given. It must not throw: a
   * failure is reported and the turn carries on.
   */
  onTurn?: (turn: TurnData) => void;
  /**
   * Whether the recorder is recording (asked at the start of each turn). When
   * false nothing is built for the replay. Default: true.
   */
  recording?: () => boolean;
  /**
   * A restored game reopened on the computer's last turn (you have finished): that turn is
   * scored at once, with no steps, no tumble and no sounds (its score has no events), and
   * `onScored` is told it was restored (#3749, owner).
   */
  resumeInstantly?: boolean;
  /** Reduce Motion, read live at each step: half the pauses, no tumbles. */
  reduceMotion?: boolean;
  /**
   * Called right after the computer's score is set, in the same batch, so the screen can start
   * its end beat with no render in between. `restored` is true for an instant restored turn.
   */
  onScored?: (state: GameState, info: { restored: boolean }) => void;
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
  /** How fast its current tumble plays (2 on its fast last turn). */
  tumbleSpeed: number;
  /** Hands the computer its turn; `lastTurn` (after your last score) plays it at 2x. */
  startTurn: (options?: { lastTurn?: boolean }) => void;
  /** Ends (and cancels) the computer's turn, e.g. for a new game. */
  endTurn: () => void;
  /** Call when the app leaves the foreground: drops the roll animation. */
  onAppBackground: () => void;
}

export function useYachtCpuOpponent({
  difficulty,
  initialState = null,
  resumeTurn = false,
  resumeInstantly = false,
  reduceMotion = false,
  onTurn,
  onScored,
  recording,
}: YachtCpuOpponentOptions): YachtCpuOpponent {
  const [state, setState] = useState<GameState | null>(initialState);
  const [isTurn, setIsTurn] = useState(resumeTurn);
  const [rollingIndices, setRollingIndices] = useState<readonly number[]>([]);
  const [tumbleSpeed, setTumbleSpeed] = useState(1);
  // Each turn run gets a token: a loop from an older run (ended, or a new game) sees it changed
  // after its next await and stops, even once a new turn has started.
  const runIdRef = useRef(0);
  // How the next turn is played: its last turn at 2x, or a restored last turn at once.
  const lastTurnRef = useRef(false);
  const instantRef = useRef(resumeTurn && resumeInstantly);

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

  // Reduce Motion, read live by each step of a running turn.
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  // The replay callback and the turn collected for it (memory only; the
  // recorder is called once, when the turn is scored).
  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);
  const onScoredRef = useRef(onScored);
  useEffect(() => {
    onScoredRef.current = onScored;
  }, [onScored]);
  const recordingRef = useRef(recording);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);
  const turnLogRef = useRef(createTurnLog());

  const isTurnRef = useRef(isTurn);
  useEffect(() => {
    isTurnRef.current = isTurn;
  }, [isTurn]);

  // The turn loop: runs whenever the computer's turn starts.
  useEffect(() => {
    if (!isTurn || !difficultyRef.current || !stateRef.current) return;

    const run = ++runIdRef.current;
    const cancelled = () => runIdRef.current !== run;
    const log = turnLogRef.current;
    log.reset();
    const logging = onTurnRef.current !== undefined && (recordingRef.current?.() ?? true);
    const lastTurn = lastTurnRef.current;
    const instant = instantRef.current;
    instantRef.current = false;

    // The AI's state as of its last completed step, so a failure part-way
    // through can finish the turn from there.
    let s = stateRef.current;

    // The finished turn goes to the replay. A failure here must never reach
    // the turn's catch below, which would score the turn a second time.
    function recordTurn(from: GameState, to: GameState, cat: Category) {
      try {
        const turn = log.finish({
          prev: from,
          next: to,
          category: cat,
          alternatives: enginePossibleScores(from),
          ev: scoreEvs(from, cat),
        });
        onTurnRef.current?.(turn);
      } catch (e: unknown) {
        log.reset();
        reportRecordingError(e, "cpuTurn");
      }
    }

    function recordFallbackTurn(from: GameState, to: GameState) {
      try {
        const cat = CATEGORIES.find((c) => from.scores[c] == null && to.scores[c] != null);
        if (!cat) return;
        onTurnRef.current?.(
          log.finish({
            prev: from,
            next: to,
            category: cat,
            alternatives: enginePossibleScores(from),
          })
        );
      } catch (e: unknown) {
        log.reset();
        reportRecordingError(e, "cpuFallbackTurn");
      }
    }

    /**
     * The score lands and the turn ends, in one batch with the screen's `onScored` (its end beat
     * starts in the same render as the computer's last score: the card never flashes). React 18
     * batches every update made in the same tick, timers and promises included (the app runs on
     * the concurrent root, native and web).
     */
    function finish(scored: GameState, restored: boolean) {
      setRollingIndices([]);
      setState(scored);
      try {
        onScoredRef.current?.(scored, { restored });
      } catch (e: unknown) {
        Sentry.captureException(e, { tags: { subsystem: "yacht.ai", op: "onScored" } });
      }
      setIsTurn(false);
    }

    /** How much faster than normal this step plays: read per step, so Reduce Motion is live. */
    const speed = () => cpuTurnSpeed(lastTurn, reduceMotionRef.current);

    /** One roll: the dice tumble (the roll sound plays as they start), then settle. */
    async function rollStep(holds: readonly boolean[]): Promise<boolean> {
      const rolled = freeIndices(holds);
      s = engineRoll(s, [...holds]);
      if (logging) log.roll(s);
      const sp = speed();
      // Compute the result first so the tumble plays over the final values.
      setState(s);
      setTumbleSpeed(sp);
      setRollingIndices(rolled);
      await delay(tumbleTotalMs(rolled.length) / sp);
      if (cancelled()) return false;
      setRollingIndices([]);
      await delay(CPU_SETTLE_MS / speed());
      return !cancelled();
    }

    /**
     * A restored last turn (owner, #3749): played to its score at once, with no pauses, so the
     * card shows with the reopened game. Its score carries no events, so it plays no sound.
     */
    function playInstantly() {
      const diff = difficultyRef.current!;
      if (s.rolls_used === 0) {
        s = engineRoll(s, ALL_FREE);
        if (logging) log.roll(s);
      }
      while (s.rolls_used < 3) {
        const holds = holdStrategy(s, diff);
        if (holds.every((h) => h)) break;
        s = engineRoll(s, holds);
        if (logging) log.roll(s);
      }
      const cat = scoreStrategy(s, diff);
      const scoredFrom = s;
      s = engineScore(s, cat);
      if (logging) recordTurn(scoredFrom, s, cat);
      finish({ ...s, events: undefined }, true);
    }

    async function runAiTurn() {
      const diff = difficultyRef.current!;

      if (s.rolls_used === 0) {
        // Initial roll (all dice free).
        if (!(await rollStep(ALL_FREE))) return;
      } else {
        // Resuming a turn interrupted after it had rolled (app killed, or the
        // effect re-ran) keeps the dice it already has rather than re-rolling
        // them — and with all three rolls used, re-rolling would throw (#2203).
        // Settle pause: let the player read the dice values.
        await delay(CPU_SETTLE_MS / speed());
        if (cancelled()) return;
      }

      // Up to two re-rolls using hold strategy
      while (s.rolls_used < 3) {
        const holds = holdStrategy(s, diff);
        if (holds.every((h) => h)) break; // all dice held — go straight to scoring
        // Show hold decision on current values so the player sees the AI's choice
        setState({ ...s, held: holds });
        await delay(CPU_HOLD_MS / speed());
        if (cancelled()) return;
        if (!(await rollStep(holds))) return;
      }

      // Beat before the AI locks in its category
      await delay(CPU_SCORE_BEAT_MS / speed());
      if (cancelled()) return;
      const cat = scoreStrategy(s, diff);
      const scoredFrom = s;
      s = engineScore(s, cat);
      if (logging) recordTurn(scoredFrom, s, cat);
      finish(s, false);
    }

    // If the turn fails, report it and finish the computer's turn with a
    // plain fallback before handing back control. Just unlocking would leave
    // the computer a round behind for good, so its game could never end and
    // the VS result screen would never show (#2203).
    function fallback(e: unknown) {
      Sentry.captureException(e, { tags: { subsystem: "yacht.ai", op: "runAiTurn" } });
      if (cancelled()) return;
      setRollingIndices([]);
      try {
        let rolledFrom = s;
        s = finishTurnFallback(s, (rolled) => {
          rolledFrom = rolled;
          if (logging) log.roll(rolled);
        });
        // The fallback's turn is recorded too, without EVs (the oracle did not
        // choose it), so the computer's card has no hole.
        if (logging) recordFallbackTurn(rolledFrom, s);
        finish(instant ? { ...s, events: undefined } : s, instant);
        return;
      } catch (fallbackError: unknown) {
        // Last resort: unlock the board rather than freeze it.
        Sentry.captureException(fallbackError, {
          tags: { subsystem: "yacht.ai", op: "finishTurnFallback" },
        });
      }
      setIsTurn(false);
    }

    if (instant) {
      try {
        playInstantly();
      } catch (e: unknown) {
        fallback(e);
      }
    } else {
      runAiTurn().catch(fallback);
    }
    return () => {
      runIdRef.current += 1;
    };
  }, [isTurn]);

  const startTurn = useCallback((options?: { lastTurn?: boolean }) => {
    lastTurnRef.current = options?.lastTurn === true;
    setIsTurn(true);
  }, []);
  const endTurn = useCallback(() => {
    instantRef.current = false;
    lastTurnRef.current = false;
    setRollingIndices([]);
    setIsTurn(false);
  }, []);
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
    tumbleSpeed,
    startTurn,
    endTurn,
    onAppBackground,
  };
}
