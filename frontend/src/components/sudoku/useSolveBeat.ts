/**
 * useSolveBeat (#3774): the beat between the move that solves the puzzle and its result card, as
 * Yacht's `useYachtEndBeat` (#3749) and 2048's `useTwenty48Beat` (#3689).
 *
 * - The beat: a teal wave along the board's diagonals, and the card waits `SOLVED_BEAT_MS` (1.0 s)
 *   after the solving move.
 * - Reduce Motion: no beat; the card shows as soon as the puzzle is solved. Read live: turning it
 *   on mid-beat cancels the timer and shows the card, and turning it off again never replays it.
 *
 * `holding` is the gate: the screen shows the card when `solved && !holding` and the wave while
 * `holding`. It is derived from `solved` in the render itself, not set by a handler. Sudoku's
 * moves run inside `setState` updaters (they are pure, and may run twice or later), so a handler
 * can't know the move solved the puzzle; but the render that commits the solved state also reads
 * `holding === true`, so the board, the wave and the held card land in one render and the card
 * never flashes before the beat. The timer starts in the effect of that commit.
 *
 * A game restored already solved calls `skip()` in the restore handler, so its card shows at once
 * with no beat. This relies on `skip()` landing in the same batch as the loaded state: the load's
 * `.then` sets the state and runs the restore handler together (`usePersistedGameState.ts`, the
 * load's `setState` then `restoredRef`), so the first render with `solved` already has `over` set. A new game (solved turns false) clears the beat,
 * its timer and the skip; unmounting clears the timer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SOLVED_BEAT_MS } from "../../game/sudoku/motion";
import { useReduceMotion } from "../shared/useReduceMotion";

export interface SolveBeat {
  /** The card waits (and the wave runs): the puzzle is solved and the beat is not over. */
  holding: boolean;
  /** Reduce Motion, read live. */
  reduceMotion: boolean;
  /** The game was restored already solved: no beat, the card shows at once. */
  skip: () => void;
}

export function useSolveBeat(solved: boolean): SolveBeat {
  const reduceMotion = useReduceMotion();
  // The beat is over (its timer ran out, Reduce Motion cut it, or a restore skipped it).
  const [over, setOver] = useState(false);
  const overRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    overRef.current = over;
    reduceMotionRef.current = reduceMotion;
  }, [over, reduceMotion]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  // Each game's end: solved turning true starts the beat; turning false (a new game) clears it.
  useEffect(() => {
    clearTimer();
    if (!solved) {
      setOver(false);
      return;
    }
    // Over already (skipped), or Reduce Motion (no beat, below): no timer.
    if (overRef.current || reduceMotionRef.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setOver(true);
    }, SOLVED_BEAT_MS);
  }, [solved]);

  // Reduce Motion on, mid-beat (docs/ACCESSIBILITY.md section 3): no timer, the card now. `over`
  // stays set, so turning it off again does not replay the beat under the card.
  useEffect(() => {
    if (!reduceMotion || !solved) return;
    clearTimer();
    setOver(true);
  }, [reduceMotion, solved]);

  const skip = useCallback(() => setOver(true), []);

  return { holding: solved && !over && !reduceMotion, reduceMotion, skip };
}
