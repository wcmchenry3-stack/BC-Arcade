/**
 * Cascade's session, result block and best score (moved out of `CascadeScreen.tsx` in #3701, which
 * kept the screen under 800 lines; the behaviour is unchanged).
 *
 *   - Session: `useGameSync("cascade")`. The session completes at the end (outcome `win` for the
 *     capstone, `loss` at the lid, #3699) and abandons on a theme switch, restart or unmount
 *     (#2450, #2619). Completed and abandoned rows store the same result block (`resultFor`,
 *     `resultBlock.ts`, #3700: merge score plus a win's time bonus; the server recomputes it).
 *   - Clock (#2750, #3700): the screen's `useCascadeClock`, passed in. A new session resets it
 *     (not started: the first piece starts it); the screen stops it before the completion.
 *   - Best (#2515, #3757): the shared personal best, cached for the card's "New best" badge;
 *     `judgeEnd` gives the card the result block of the stopped clock.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useGameSync } from "../_shared/useGameSync";
import { getBest, judgeResult, recordResult } from "../_shared/personalBest";
import { cascadeCompletion, cascadeResultBlock } from "./resultBlock";
import type { useCascadeClock } from "./useCascadeClock";

export type CascadeOutcome = "win" | "loss" | "completed" | "abandoned";

export interface CascadeSessionInputs {
  readonly scoreRef: MutableRefObject<number>;
  readonly dropCountRef: MutableRefObject<number>;
  /** The highest tier on the board this game (the result's `max_tier`, #3700). */
  readonly maxTierRef: MutableRefObject<number>;
  /** The active piece set's id. */
  readonly themeIdRef: MutableRefObject<string>;
  readonly clock: ReturnType<typeof useCascadeClock>;
}

export function useCascadeSession(inputs: CascadeSessionInputs) {
  const { scoreRef, dropCountRef, maxTierRef, themeIdRef, clock } = inputs;
  const sync = useGameSync("cascade");
  const { start, complete, setProgressSnapshot } = sync;
  const bestScoreRef = useRef(0);
  const mergeCountRef = useRef(0);

  useEffect(() => {
    let active = true;
    getBest("cascade").then((best) => {
      if (active && best > bestScoreRef.current) bestScoreRef.current = best;
    });
    return () => {
      active = false;
    };
  }, []);

  // The result block. The hook's own abandon (unmount) and `endSession` build it here, so
  // completed and abandoned rows store the same metadata keys.
  const resultFor = useCallback(
    (end: CascadeOutcome | null) =>
      cascadeResultBlock(
        {
          mergeScore: scoreRef.current,
          durationMs: clock.elapsed(),
          theme: themeIdRef.current,
          drops: dropCountRef.current,
          merges: mergeCountRef.current,
          maxTier: maxTierRef.current,
        },
        end
      ),
    [clock, scoreRef, themeIdRef, dropCountRef, maxTierRef]
  );
  useEffect(() => {
    setProgressSnapshot(() => ({ result: resultFor(null) }));
  }, [setProgressSnapshot, resultFor]);

  const startSession = useCallback(
    (themeId: string) => {
      clock.reset(); // not started: the first piece starts it (#3700)
      mergeCountRef.current = 0;
      maxTierRef.current = 0;
      start({ fruit_set: themeId, theme: themeId, seed: null });
    },
    [start, clock, maxTierRef]
  );

  const endSession = useCallback(
    (outcome: CascadeOutcome) => {
      // Built once (`cascadeCompletion`): the summary, and the analytics payload.
      const { summary, payload } = cascadeCompletion(resultFor(outcome), outcome);
      return complete(summary, payload);
    },
    [complete, resultFor]
  );

  /**
   * The end's result block (#3700: the score the server stores, merge score plus a win's time
   * bonus) and the best, recorded when this beats it (#2515): what the result card shows.
   */
  const judgeEnd = useCallback(
    (end: "win" | "loss") => {
      const block = resultFor(end);
      const finalScore = block.final_score;
      // A 0 score never sets a best (the game's rule in `personalBestGames.ts`).
      const { improved, isNewBest } = judgeResult("cascade", bestScoreRef.current, finalScore);
      if (improved) {
        bestScoreRef.current = finalScore;
        void recordResult("cascade", finalScore);
      }
      return { block, best: { bestScore: bestScoreRef.current, isNewBest } };
    },
    [resultFor]
  );

  return { sync, mergeCountRef, judgeEnd, startSession, endSession };
}
