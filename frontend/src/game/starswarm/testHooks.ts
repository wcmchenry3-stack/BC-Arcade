/**
 * Star Swarm E2E hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only), installed through the
 * shared registry (#2975).
 *
 * #2491: `__starswarm_getRunStats()` -> counts + wave/difficulty/score, so a driver can read
 * the counters without the dev panel.
 * #2516: `__starswarm_endRun(score, wave)` ends the run through the real game-over path
 * (result card, leaderboard submit, game sync) with the canvas frozen behind the card —
 * reaching game over by real play isn't practical in an E2E run.
 */
import { registerTestHooks } from "../_shared/testHooksRegistry";
import type { FrameStatsSummary } from "./render/frameStats";
import type { DifficultyTier, RunStats, StarSwarmState } from "./types";

/** What the `__starswarm_getRunStats` test hook returns (#2491). */
export interface RunStatsHook {
  readonly runStats: RunStats;
  readonly tierStats: StarSwarmState["tierStats"];
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly score: number;
  /** #2567: the last second of frame times and canvas commits (null on web or before a frame). */
  readonly frame: FrameStatsSummary | null;
}

/** The slice of the canvas handle the hooks read. */
export interface StarSwarmHookCanvas {
  getState(): StarSwarmState | null | undefined;
  getFrameStats(): FrameStatsSummary | null | undefined;
}

export interface StarSwarmHookDeps {
  getCanvas: () => StarSwarmHookCanvas | null | undefined;
  /** Freeze the canvas behind the result card. */
  pause: () => void;
  /** The screen's real game-over handler. */
  endRun: (score: number, wave: number) => void;
}

export function registerStarSwarmTestHooks({
  getCanvas,
  pause,
  endRun,
}: StarSwarmHookDeps): () => void {
  return registerTestHooks("starswarm", {
    endRun: (score: number, wave: number) => {
      pause();
      endRun(score, wave);
    },
    getRunStats: (): RunStatsHook | null => {
      const canvas = getCanvas();
      const s = canvas?.getState();
      return s
        ? {
            runStats: s.runStats,
            tierStats: s.tierStats,
            wave: s.wave,
            difficulty: s.difficulty,
            score: s.score,
            frame: canvas?.getFrameStats() ?? null,
          }
        : null;
    },
  });
}
