/**
 * The Yacht screen's motion state (#3749), kept out of GameScreen: your roll's tumble and the input
 * lock it holds, the end beat and the celebration it waits for, and the solo best that decides the
 * beat's outcome. Every time is in `game/yacht/motion.ts`.
 *
 * - Tumble: `startTumble(rolled)` in the same handler as the roll's `setState`; the dice rolled
 *   tumble and `isLocked()` is true until the last one lands (`tumbleTotalMs`, audit bugs 8 and 9).
 *   Its timer is cleared on a new tumble, on `clearTumble` (a new game), on unmount, and when
 *   Reduce Motion turns on (the dice snap and input unlocks). Under Reduce Motion there is none.
 * - End beat (`useYachtEndBeat`): `endGame(outcome, celebrates)` with the game's last score; it
 *   waits for a YACHT! / JOKER! celebration that is showing or about to (audit bug 1).
 * - Solo best (owner): read at mount, so `soloOutcome(total)` is known at once; a new best is a
 *   win (and stored), anything else a tie.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { tumbleTotalMs, type YachtEndOutcome } from "../../game/yacht/motion";
import type { GameEvent, GameState } from "../../game/yacht/types";
import { loadBestScore, saveBestScore, soloEndOutcome } from "../../game/yacht/bestScore";
import { useReduceMotion } from "../shared/useReduceMotion";
import { useYachtEndBeat, type YachtEndBeatOptions } from "./useYachtEndBeat";

export function useYachtMotion(options: YachtEndBeatOptions = {}) {
  const reduceMotion = useReduceMotion();
  const [rollingIndices, setRollingIndices] = useState<readonly number[]>([]);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref as well as the state, so a second tap in the same frame is refused.
  const locked = useRef(false);
  // A YACHT! or JOKER! celebration is showing.
  const celebrating = useRef(false);
  const endBeat = useYachtEndBeat(options);
  const { start: startEndBeat, celebrationDone } = endBeat;

  /** The dice land: no tumble, no lock. */
  const clearTumble = useCallback(() => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = null;
    locked.current = false;
    setRollingIndices([]);
  }, []);

  /** Your roll (its events): the dice rolled tumble, and input waits for the last to land. */
  const startTumble = useCallback(
    (events: readonly GameEvent[] | undefined) => {
      clearTumble();
      const roll = events?.find((e) => e.type === "diceRoll");
      const rolled = roll?.type === "diceRoll" ? roll.rolledIndices : [];
      // Reduce Motion: the faces change in place, and the dice are at rest at once.
      if (reduceMotion || rolled.length === 0) return;
      locked.current = true;
      setRollingIndices(rolled);
      rollTimer.current = setTimeout(clearTumble, tumbleTotalMs(rolled.length));
    },
    [reduceMotion, clearTumble]
  );

  useEffect(() => clearTumble, [clearTumble]);
  useEffect(() => {
    if (reduceMotion) clearTumble();
  }, [reduceMotion, clearTumble]);

  const isLocked = useCallback(() => locked.current, []);

  /** A celebration starts (your yacht or joker). */
  const celebrationStarted = useCallback(() => {
    celebrating.current = true;
  }, []);
  /** A celebration has finished: an end beat waiting for it starts now. */
  const celebrationEnded = useCallback(() => {
    celebrating.current = false;
    celebrationDone();
  }, [celebrationDone]);

  /**
   * The game's last score has landed: start its beat, after the celebration this score sets off
   * (`celebrates`) or one still showing.
   */
  const endGame = useCallback(
    (outcome: YachtEndOutcome, celebrates = false) =>
      startEndBeat(outcome, { afterCelebration: celebrates || celebrating.current }),
    [startEndBeat]
  );

  // The best before this game, read at mount.
  const best = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBestScore().then((b) => {
      if (alive && best.current === null) best.current = b;
    });
    return () => {
      alive = false;
    };
  }, []);

  /** A finished solo game's outcome: a new personal best is a win (stored), else a tie. */
  const soloOutcome = useCallback((total: number): YachtEndOutcome => {
    const prior = best.current;
    if (prior === null) {
      // Not read yet (it is read at mount, so this is rare): compare once it has been.
      void loadBestScore().then((b) => {
        const { newBest } = soloEndOutcome(b, total);
        best.current = newBest ?? b;
        if (newBest !== null) void saveBestScore(newBest);
      });
      return "tie";
    }
    const { outcome, newBest } = soloEndOutcome(prior, total);
    if (newBest !== null) {
      best.current = newBest;
      void saveBestScore(newBest);
    }
    return outcome;
  }, []);

  /** Your last score in solo: the beat, a win on a new best, after its celebration if any. */
  const soloEnded = useCallback(
    (scored: GameState) => endGame(soloOutcome(scored.total_score), celebrates(scored)),
    [endGame, soloOutcome]
  );

  /**
   * The computer's score: its last one after yours ends a vs game, and starts the beat in the same
   * batch (no flash of the card). A game reopened on that turn (`restored`) has no beat (owner).
   */
  const cpuScored = useCallback(
    (player: GameState, cpu: GameState, restored: boolean) => {
      if (restored || !cpu.game_over || !player.game_over) return;
      endGame(vsEndOutcome(player.total_score, cpu.total_score));
    },
    [endGame]
  );

  /** A new game: no tumble, beat or wait carried into it. */
  const { clear: clearEndBeat } = endBeat;
  const reset = useCallback(() => {
    clearTumble();
    clearEndBeat();
  }, [clearTumble, clearEndBeat]);

  return {
    reduceMotion,
    rollingIndices,
    startTumble,
    isLocked,
    celebrationStarted,
    celebrationEnded,
    soloEnded,
    cpuScored,
    /** The card waits while this is true. */
    holding: endBeat.holding,
    /** The finished game's outcome, once its beat has started or waits (for #3750). */
    endOutcome: endBeat.outcome,
    reset,
  };
}

/** A finished vs game's outcome, from your side. */
function vsEndOutcome(you: number, cpu: number): YachtEndOutcome {
  return you > cpu ? "win" : you < cpu ? "loss" : "tie";
}

/** A score that sets off the YACHT! or JOKER! celebration. */
function celebrates(state: GameState): boolean {
  return state.events?.some((e) => e.type === "yacht" || e.type === "joker") === true;
}
