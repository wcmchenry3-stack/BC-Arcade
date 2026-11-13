/**
 * useLiveMotion (#3774): a move's motion plays at most once and then expires, so it never replays
 * later (Reduce Motion turned off after an error or a completed unit) and no overlay view stays
 * mounted once its effect is over. Returns `motion` until it has had `MOTION_TOTAL_MS`, or at
 * once when Reduce Motion is on (when it was made, or turned on since); then null.
 *
 * One timer per move, cleared on the next move and on unmount.
 */
import { useEffect, useState } from "react";

import { MOTION_TOTAL_MS, type SudokuMotion } from "../../game/sudoku/motion";

export function useLiveMotion(
  motion: SudokuMotion | null,
  reduceMotion: boolean
): SudokuMotion | null {
  // The id of the last motion that has played (or was skipped).
  const [spentId, setSpentId] = useState<number | null>(null);
  const id = motion?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    if (reduceMotion) {
      setSpentId(id);
      return;
    }
    const timer = setTimeout(() => setSpentId(id), MOTION_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [id, reduceMotion]);

  return motion !== null && motion.id !== spentId ? motion : null;
}
