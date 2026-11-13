/**
 * The Yacht screen's motion state (#3749), kept out of GameScreen: your roll's tumble and the input
 * lock it holds, the YACHT! / JOKER! celebration, the end beat that waits for it, the solo best
 * that decides the beat's outcome, and the computer's options that tie its last score to the beat.
 * Every time is in `game/yacht/motion.ts`.
 *
 * - Tumble: `startTumble(events)` in the same handler as the roll's `setState`; the dice rolled
 *   tumble and `isLocked()` is true until every one reports it has landed (`onTumbleEnd`, from its
 *   animation's end, so the lock covers the tumble as it really ran), or at the latest
 *   `inputLockMaxMs` after the press (audit bugs 8 and 9). Cleared on a new game, on unmount, and
 *   when Reduce Motion turns on (the dice snap and input unlocks). Under Reduce Motion there is none.
 * - Celebration: `celebrate(kind)` shows it; `celebrationEnded()` (its `onDismiss`) starts a beat
 *   that waits for it (audit bug 1).
 * - End beat (`useYachtEndBeat`): solo, `soloEnded(next)` with your last score; vs, the computer's
 *   `onScored` (in `cpuOptions`) with its last score. A game reopened on the computer's last turn
 *   has no beat, and its score lands still (`still`), under the card.
 * - Solo best (owner): read at mount; a new best is a win (and stored), anything else a tie. If it
 *   has not been read yet the beat waits for it, so its outcome (and #3750's sound) is right.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { inputLockMaxMs, type YachtEndOutcome } from "../../game/yacht/motion";
import type { GameEvent, GameState } from "../../game/yacht/types";
import { loadBestScore, saveBestScore, soloEndOutcome } from "../../game/yacht/bestScore";
import { useReduceMotion } from "../shared/useReduceMotion";
import { useYachtEndBeat, type YachtEndBeatOptions } from "./useYachtEndBeat";

export interface YachtMotionOptions extends YachtEndBeatOptions {
  /** Your scorecard now (the computer's last score is compared with it). */
  player: () => GameState;
  /** The game was reopened with you finished: the computer's last turn is scored at once. */
  reopenedFinished: boolean;
}

export function useYachtMotion({ player, reopenedFinished, onStart }: YachtMotionOptions) {
  const reduceMotion = useReduceMotion();
  const [rollingIndices, setRollingIndices] = useState<readonly number[]>([]);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref as well as the state, so a second tap in the same frame is refused.
  const locked = useRef(false);
  // The dice of this roll still in the air.
  const inAir = useRef(new Set<number>());
  const [celebration, setCelebration] = useState<"yacht" | "joker" | null>(null);
  const celebrating = useRef(false);
  // The computer's last turn was scored on reopening: its score lands still, under the card.
  const [still, setStill] = useState(false);
  const endBeat = useYachtEndBeat({ onStart });
  const { start: startEndBeat, celebrationDone, clear: clearEndBeat } = endBeat;

  /** The dice land: no tumble, no lock. */
  const clearTumble = useCallback(() => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = null;
    locked.current = false;
    inAir.current.clear();
    setRollingIndices([]);
  }, []);

  /** Your roll (its events): the dice rolled tumble, and input waits for them all to land. */
  const startTumble = useCallback(
    (events: readonly GameEvent[] | undefined) => {
      clearTumble();
      const roll = events?.find((e) => e.type === "diceRoll");
      const rolled = roll?.type === "diceRoll" ? roll.rolledIndices : [];
      // Reduce Motion: the faces change in place, and the dice are at rest at once.
      if (reduceMotion || rolled.length === 0) return;
      locked.current = true;
      inAir.current = new Set(rolled);
      setRollingIndices(rolled);
      // The safety net, should a die never report its landing.
      rollTimer.current = setTimeout(clearTumble, inputLockMaxMs(rolled.length));
    },
    [reduceMotion, clearTumble]
  );

  /** A die of your roll has landed: when the last one has, input unlocks. */
  const onTumbleEnd = useCallback(
    (index: number) => {
      if (!inAir.current.delete(index)) return;
      if (inAir.current.size === 0) clearTumble();
    },
    [clearTumble]
  );

  useEffect(() => clearTumble, [clearTumble]);
  useEffect(() => {
    if (reduceMotion) clearTumble();
  }, [reduceMotion, clearTumble]);

  const isLocked = useCallback(() => locked.current, []);

  /** Your yacht or joker: its celebration shows. */
  const celebrate = useCallback((kind: "yacht" | "joker") => {
    celebrating.current = true;
    setCelebration(kind);
  }, []);
  /** The celebration has finished (its `onDismiss`): an end beat waiting for it starts now. */
  const celebrationEnded = useCallback(() => {
    celebrating.current = false;
    setCelebration(null);
    celebrationDone();
  }, [celebrationDone]);

  /** The game's last score: its beat, after the celebration it sets off or one still showing. */
  const endGame = useCallback(
    (outcome: YachtEndOutcome | Promise<YachtEndOutcome>, celebrates = false) =>
      startEndBeat(outcome, { afterCelebration: celebrates || celebrating.current }),
    [startEndBeat]
  );

  // The best before this game, read at mount.
  const best = useRef<number | null>(null);
  const bestRead = useRef<Promise<number> | null>(null);
  useEffect(() => {
    bestRead.current = loadBestScore().then((b) => {
      if (best.current === null) best.current = b;
      return best.current;
    });
  }, []);

  /** A finished solo game's outcome: a new personal best is a win (stored), else a tie. */
  const soloOutcome = useCallback((total: number): YachtEndOutcome | Promise<YachtEndOutcome> => {
    const decide = (prior: number): YachtEndOutcome => {
      const { outcome, newBest } = soloEndOutcome(prior, total);
      if (newBest !== null) {
        best.current = newBest;
        void saveBestScore(newBest);
      }
      return outcome;
    };
    if (best.current !== null) return decide(best.current);
    // Not read yet (rare: it is read at mount): the beat waits for it.
    return (bestRead.current ?? loadBestScore()).then(decide);
  }, []);

  /** Your last score in solo: the beat, a win on a new best, after its celebration if any. */
  const soloEnded = useCallback(
    (scored: GameState) => endGame(soloOutcome(scored.total_score), celebrates(scored)),
    [endGame, soloOutcome]
  );

  // The computer's options: Reduce Motion, the reopened last turn, and its score.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  const onScored = useCallback(
    (cpu: GameState, { restored }: { restored: boolean }) => {
      // A game reopened on that turn has no beat (owner); its score lands still under the card.
      if (restored) {
        setStill(true);
        return;
      }
      const you = playerRef.current();
      // Its last score after yours ends a vs game: the beat starts in the same batch (no flash).
      if (!cpu.game_over || !you.game_over) return;
      endGame(vsEndOutcome(you.total_score, cpu.total_score));
    },
    [endGame]
  );
  const cpuOptions = { reduceMotion, onScored, resumeInstantly: reopenedFinished };

  /** A new game: no tumble, celebration, beat or wait carried into it. */
  const reset = useCallback(() => {
    clearTumble();
    clearEndBeat();
    setStill(false);
  }, [clearTumble, clearEndBeat]);

  return {
    reduceMotion,
    rollingIndices,
    startTumble,
    onTumbleEnd,
    isLocked,
    celebration,
    celebrate,
    celebrationEnded,
    soloEnded,
    cpuOptions,
    /** Scores land with no pop or count-up (a reopened computer last turn, under the card). */
    still,
    /** The card waits while this is true. */
    holding: endBeat.holding,
    /** The finished game's outcome, once its beat has started or waits (for #3750). */
    endOutcome: endBeat.outcome,
    reset,
  };
}

/**
 * The dice the tray shows: the dice in play, or once the game is over (the engine has cleared
 * them), the last dice that were on the table, so the end beat shows the final roll rather than a
 * fresh turn (owner, #3749).
 */
export function useTrayDice(dice: number[], gameOver: boolean): number[] {
  const [last, setLast] = useState(dice);
  const rolled = dice.some((d) => d > 0);
  useEffect(() => {
    if (rolled) setLast(dice);
  }, [dice, rolled]);
  return gameOver && !rolled ? last : dice;
}

/** A finished vs game's outcome, from your side. */
function vsEndOutcome(you: number, cpu: number): YachtEndOutcome {
  return you > cpu ? "win" : you < cpu ? "loss" : "tie";
}

/** A score that sets off the YACHT! or JOKER! celebration. */
function celebrates(state: GameState): boolean {
  return state.events?.some((e) => e.type === "yacht" || e.type === "joker") === true;
}
