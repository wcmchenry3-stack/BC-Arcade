/**
 * useTwenty48Beat (#3689): the beat between the move that ends a game and its result card.
 *
 * - A win: the 2048 tile forms (a bigger pop and a glow) and the card waits `WIN_BEAT_MS`.
 * - A game over: the stuck board dims and shakes and the card waits `GAME_OVER_BEAT_MS`.
 * - Reduce Motion: no beat; the card shows as soon as the move lands.
 *
 * `beat` is the pending flag: the screen calls `start` in the same handler as the `setState` that
 * ends the game, so both land in one render and the card never flashes before the beat. A game
 * restored already finished never calls `start`, so its card shows at once.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { GAME_OVER_BEAT_MS, WIN_BEAT_MS } from "../../game/twenty48/motion";
import { useReduceMotion } from "../shared/useReduceMotion";

export type Beat = "win" | "gameOver" | null;

export function useTwenty48Beat() {
  const reduceMotion = useReduceMotion();
  const [beat, setBeat] = useState<Beat>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read live: `start` is called from a move handler that closed over an older render.
  const reduceMotionRef = useRef(reduceMotion);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  /** Begin a beat; the card waits for it. No beat (and no hold) under Reduce Motion. */
  const start = useCallback((kind: "win" | "gameOver") => {
    clearTimer();
    if (reduceMotionRef.current) return;
    setBeat(kind);
    timer.current = setTimeout(
      () => {
        timer.current = null;
        setBeat(null);
      },
      kind === "win" ? WIN_BEAT_MS : GAME_OVER_BEAT_MS
    );
  }, []);

  /** A new game: no beat left over. */
  const clear = useCallback(() => {
    clearTimer();
    setBeat(null);
  }, []);

  // Reduce Motion turned on mid-beat (docs/ACCESSIBILITY.md section 3): stop the beat and show the
  // card now. Cleared, not just hidden (below, for the render before this runs), so turning it
  // off again doesn't replay the beat under the card.
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (!reduceMotion) return;
    clearTimer();
    setBeat(null);
  }, [reduceMotion]);

  return { beat: reduceMotion ? null : beat, start, clear };
}
