/**
 * Cascade's session, play clock and best score (moved out of `CascadeScreen.tsx` in #3701, which
 * kept the screen under 800 lines; the behaviour is unchanged).
 *
 *   - Session: `useGameSync("cascade")`. The session completes at the end (outcome `win` for the
 *     capstone, `loss` at the lid, #3699) and abandons on a theme switch, restart or unmount
 *     (#2450, #2619). Completed and abandoned rows store the same result block (`progressResult`).
 *   - Clock (#2750): the shared PlayClock model, from the session's start, stopped while the
 *     player is away (`usePauseWhileAway` in the screen). A ref: the loop reads it outside renders.
 *   - Best (#2515, #3757): the shared personal best, cached for the card's "New best" badge.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { clockElapsedMs, type PlayClock } from "../_shared/playClock";
import { useGameSync } from "../_shared/useGameSync";
import { getBest } from "../_shared/personalBest";

export type CascadeOutcome = "win" | "loss" | "completed" | "abandoned";

export interface CascadeSessionInputs {
  readonly scoreRef: MutableRefObject<number>;
  readonly dropCountRef: MutableRefObject<number>;
  /** The active piece set's id. */
  readonly themeIdRef: MutableRefObject<string>;
}

export function useCascadeSession({ scoreRef, dropCountRef, themeIdRef }: CascadeSessionInputs) {
  const sync = useGameSync("cascade");
  const { start, complete, setProgressSnapshot } = sync;
  const bestScoreRef = useRef(0);
  const mergeCountRef = useRef(0);
  const clockRef = useRef<PlayClock>({ startedAt: Date.now(), accumulatedMs: 0 });

  useEffect(() => {
    let active = true;
    getBest("cascade").then((best) => {
      if (active && best > bestScoreRef.current) bestScoreRef.current = best;
    });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Start the clock over with `accumulatedMs` banked, keeping it paused if the player is away: a
   * session can open, or a save load land, while the app is in the background or another screen
   * covers the board.
   */
  const restartClock = useCallback((accumulatedMs: number) => {
    clockRef.current =
      clockRef.current.paused === true
        ? { accumulatedMs, startedAt: null, paused: true }
        : { accumulatedMs, startedAt: Date.now() };
  }, []);
  /** Play time so far. */
  const playedMs = useCallback(() => clockElapsedMs(clockRef.current), []);

  // The result block. The hook's own abandon (unmount) and `endSession` build it here, so
  // completed and abandoned rows store the same metadata keys. `outcome` is its own column.
  const progressResult = useCallback(
    () => ({
      final_score: scoreRef.current,
      duration_ms: playedMs(),
      theme: themeIdRef.current,
      total_drops: dropCountRef.current,
      total_merges: mergeCountRef.current,
    }),
    [playedMs, scoreRef, themeIdRef, dropCountRef]
  );
  useEffect(() => {
    setProgressSnapshot(() => ({ result: progressResult() }));
  }, [setProgressSnapshot, progressResult]);

  const startSession = useCallback(
    (themeId: string) => {
      restartClock(0);
      mergeCountRef.current = 0;
      start({ fruit_set: themeId, theme: themeId, seed: null });
    },
    [start, restartClock]
  );

  const endSession = useCallback(
    (outcome: CascadeOutcome) => {
      // Built once: the analytics payload is the result plus its outcome. An abandon's result is
      // the same block as the unmount snapshot; a completion's keeps `outcome`, as it always has.
      const result = progressResult();
      const payload = { ...result, outcome };
      return complete(
        {
          finalScore: scoreRef.current,
          outcome,
          durationMs: result.duration_ms,
          result: outcome === "abandoned" ? result : payload,
        },
        payload
      );
    },
    [complete, progressResult, scoreRef]
  );

  return {
    sync,
    clockRef,
    restartClock,
    playedMs,
    mergeCountRef,
    bestScoreRef,
    startSession,
    endSession,
  };
}
