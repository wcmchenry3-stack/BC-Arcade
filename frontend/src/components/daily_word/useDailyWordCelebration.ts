/**
 * useDailyWordCelebration (#3664): the motion between a game's last row turning over and its
 * result card, and the "no" shake of a refused guess.
 *
 * - A win: the solved row's tiles hop in a wave and sparks burst over the board; the card waits
 *   `winCelebrationMs`.
 * - A loss: the answer's tiles flip in under the board (`AnswerRow`); the card waits
 *   `lossRevealMs`.
 * - Reduce Motion: the card shows as soon as the row has turned.
 *
 * `finishReveal` is handed to `useDailyWordSubmit`, which calls it when the last row's flip ends,
 * in place of releasing the card itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import type { DailyWordState } from "../../game/daily_word/types";
import { lossRevealMs, winCelebrationMs } from "../../game/daily_word/motion";
import { useReduceMotion } from "../shared/useReduceMotion";

export type Celebration = { kind: "win"; row: number } | { kind: "loss" } | null;

export function useDailyWordCelebration(
  stateRef: MutableRefObject<DailyWordState | null>,
  setRevealPending: (pending: boolean) => void
) {
  const reduceMotion = useReduceMotion();
  const [celebration, setCelebration] = useState<Celebration>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read live: the flip timer holds the finishReveal from when the row was submitted.
  const reduceMotionRef = useRef(reduceMotion);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const finishReveal = useCallback(
    /** `hold`: false when there is nothing to show (a loss whose answer didn't load). */
    (won: boolean, hold = true) => {
      const s = stateRef.current;
      clearTimer();
      if (reduceMotionRef.current || !s || !hold) {
        setRevealPending(false);
        return;
      }
      setCelebration(won ? { kind: "win", row: s.current_row - 1 } : { kind: "loss" });
      timer.current = setTimeout(
        () => {
          timer.current = null;
          setRevealPending(false);
        },
        won ? winCelebrationMs(s.word_length) : lossRevealMs(s.word_length)
      );
    },
    [stateRef, setRevealPending]
  );

  // Reduce Motion turned on mid-celebration (docs/ACCESSIBILITY.md §3): stop the dance, sparks
  // and answer flip, and show the card now. Cleared, not just hidden (below, for the render
  // before this runs), so turning it off again doesn't replay the dance under the card.
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (!reduceMotion) return;
    if (timer.current) {
      clearTimer();
      setRevealPending(false);
    }
    setCelebration(null);
  }, [reduceMotion, setRevealPending]);

  /** A new board (Play Again, a new day): no dance or sparks left over. */
  const clearCelebration = useCallback(() => {
    clearTimer();
    setCelebration(null);
  }, []);

  const onRefused = useCallback(() => setShakeKey((k) => k + 1), []);

  return {
    celebration: reduceMotion ? null : celebration,
    finishReveal,
    clearCelebration,
    shakeKey,
    onRefused,
    reduceMotion,
  };
}
