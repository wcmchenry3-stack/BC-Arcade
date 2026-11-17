/**
 * Cascade's session, result block and best score (moved out of `CascadeScreen.tsx` in #3701, which
 * kept the screen under 800 lines; the behaviour is unchanged).
 *
 *   - Session: `useGameRecorder("cascade")` (`useGameSync` plus the shared recorder). The session completes at the end (outcome `win` for the
 *     capstone, `loss` at the lid, #3699) and abandons on a theme switch, restart or unmount
 *     (#2450, #2619). Completed and abandoned rows store the same result block (`resultFor`,
 *     `resultBlock.ts`, #3700: merge score plus a win's time bonus; the server recomputes it).
 *   - Clock (#2750, #3700): the screen's `useCascadeClock`, passed in. A new session resets it
 *     (not started: the first piece starts it); the screen stops it before the completion.
 *   - Best (#2515, #3757): the shared personal best, cached for the card's "New best" badge;
 *     `judgeEnd` gives the card the result block of the stopped clock.
 *   - Replay (#3858, `replay.ts`): `game_started` carries the game's seeds, tuning and
 *     `engine_version`; `rec` takes the screen's drops and the engine's merge and danger events
 *     into the log, which hands a unit to the recorder every 20 drops, at the end and when the app
 *     goes to the background; `game_ended` adds the end, capstone and lid steps. With the replay
 *     dial off for the session (`isRecording`), none of it runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { APP_VERSION } from "../../config/appVersion";
import { useFlushOnBackground } from "../_shared/useFlushOnBackground";
import { useGameRecorder } from "../_shared/useGameRecorder";
import { getBest, judgeResult, recordResult } from "../_shared/personalBest";
import type { CascadeEngine, EngineEvent } from "./engine";
import {
  createCascadeLog,
  logEngineEvents,
  quantizeX,
  startedData,
  type CascadeSeeds,
} from "./replay";
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
  /** The engine: a drop's fixed step and the end step (#3858). */
  readonly engineRef: MutableRefObject<CascadeEngine | null>;
  /** The game's seeds, for `game_started` (`useCascadeQueue`). */
  readonly seedsRef: MutableRefObject<CascadeSeeds>;
}

export function useCascadeSession(inputs: CascadeSessionInputs) {
  const { scoreRef, dropCountRef, maxTierRef, themeIdRef, clock, engineRef, seedsRef } = inputs;
  // The replay log (#3858): it writes to the recorder once one is attached (below).
  const [log] = useState(() => createCascadeLog());
  // Declared before useGameRecorder, so on unmount this runs first: the unit still waiting is
  // handed to the recorder before it saves the session and the session is abandoned.
  useEffect(() => () => log.close(), [log]);
  const sync = useGameRecorder("cascade");
  const { beginUnit, record, closeUnit } = sync;
  useEffect(
    () => log.attach({ beginUnit, record, closeUnit }),
    [log, beginUnit, record, closeUnit]
  );
  const { start, complete, setProgressSnapshot, isRecording, flush, resume } = sync;
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
      log.close(); // normally nothing: the last game's end handed its unit over
      start(startedData(themeId, seedsRef.current, APP_VERSION));
      log.start();
    },
    [start, clock, maxTierRef, log, seedsRef]
  );

  const endSession = useCallback(
    (outcome: CascadeOutcome) => {
      log.close(); // the game's last unit goes before its game_ended
      const end = log.endData(engineRef.current?.steps ?? 0);
      // Built once (`cascadeCompletion`): the summary, and the analytics payload.
      const { summary, payload } = cascadeCompletion(resultFor(outcome), outcome);
      return complete(summary, { ...payload, ...end });
    },
    [complete, resultFor, log, engineRef]
  );

  // The app goes to the background: the unit waiting is saved now (an idle save may never come
  // before the OS kills the app). The upload follows through SyncWorker's own background path.
  useFlushOnBackground(
    useCallback(() => {
      log.close();
      flush();
    }, [log, flush])
  );

  /** A drop of `tier` at `x`: returns the x to drop at (a tenth of a pixel), and logs it. */
  const drop = useCallback(
    (tier: number, x: number): number => {
      const xq = quantizeX(x);
      if (isRecording()) log.drop(engineRef.current?.steps ?? 0, xq, tier);
      return xq;
    },
    [log, isRecording, engineRef]
  );
  /** A step's engine events: its merges and danger moments are logged. */
  const events = useCallback(
    (evs: readonly EngineEvent[]) => {
      if (evs.length > 0 && isRecording()) logEngineEvents(log, evs);
    },
    [log, isRecording]
  );
  /**
   * A saved game was restored (#2654): continue the session a killed app left open, its units
   * after `savedUnit` (the save's), the first one marked as restored.
   */
  const resumeRestored = useCallback(
    (savedUnit?: number) => {
      const resumed = resume();
      if (resumed) log.start();
      if (isRecording()) log.restored(resumed ? (savedUnit ?? 0) : 0);
    },
    [resume, log, isRecording]
  );
  const rec = useMemo(
    () => ({ drop, events, resume: resumeRestored, unitForSave: log.unitForSave }),
    [drop, events, resumeRestored, log]
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

  return { sync, mergeCountRef, judgeEnd, startSession, endSession, rec };
}
