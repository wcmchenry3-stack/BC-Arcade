/**
 * Cascade's result card (#2515, #2632): the shared `GameResultModal`.
 *
 * - A loss (the lid) keeps the "Game Over" card (outcome `ended`): the score (the merge score),
 *   Best, Merges and the play Time. No bonus line: a loss earns none.
 * - A win (#3699, making the capstone) plays the celebration first (`CascadeCelebration`; the
 *   board draws it), then shows outcome `win`, "You Win!", as Blackjack's goal-reached result
 *   does: the score (merge score + time bonus, #3700), New best, then the Merge score, the Time
 *   bonus, the play Time and Best. The card holds four stats, so a win leaves out Merges.
 *
 * The card mounts only once the celebration has called `done` (or `GameResultModal`'s safety
 * timeout), so it never covers the animation (#2201).
 */
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";
import GameResultModal from "../shared/GameResultModal";
import { toSubmission } from "../shared/toSubmission";
import type { useGameRank } from "../../game/_shared/useGameRank";
import { formatMs } from "../../game/_shared/formatMs";
import type { CascadeResultBlock } from "../../game/cascade/resultBlock";
import CascadeCelebration from "./CascadeCelebration";

/** What the card shows, captured when the game ends. */
export interface CascadeResult {
  /** The score stored: `mergeScore + timeBonus` (#3700). */
  readonly score: number;
  /** The merge points. */
  readonly mergeScore: number;
  /** A win's time bonus (`game/cascade/timeBonus.ts`); 0 for a loss. */
  readonly timeBonus: number;
  readonly bestScore: number;
  readonly isNewBest: boolean;
  readonly merges: number;
  /** Play time (the screen's play clock) when the game ended. */
  readonly timeMs: number;
  /** False when the game had no sync id, so nothing could be submitted. */
  readonly submittable: boolean;
}

/** What the card shows for a game that ended with this result block (#3700). */
export function cardResult(
  block: CascadeResultBlock,
  best: { readonly bestScore: number; readonly isNewBest: boolean },
  submittable: boolean
): CascadeResult {
  return {
    score: block.final_score,
    mergeScore: block.merge_score,
    timeBonus: block.time_bonus,
    merges: block.total_merges,
    timeMs: block.duration_ms,
    ...best,
    submittable,
  };
}

export interface CascadeResultModalProps {
  readonly visible: boolean;
  /** The game ended in the win (#3699): celebrate, then the win card. */
  readonly won: boolean;
  readonly result: CascadeResult | null;
  /** The score shown before `result` is captured. */
  readonly liveScore: number;
  readonly leaderboard: ReturnType<typeof useGameRank>;
  /** The celebration's clock, drawn by the board. */
  readonly celebrationClock: SharedValue<number>;
  /** The board can draw the celebration: its clock may start. */
  readonly celebrationReady: boolean;
  readonly reduceMotion: boolean;
  readonly onViewLeaderboard?: (options?: { pendingSync?: boolean }) => void;
  readonly onPlayAgain: () => void;
  readonly onHome: () => void;
}

export default function CascadeResultModal({
  visible,
  won,
  result,
  liveScore,
  leaderboard,
  celebrationClock,
  celebrationReady,
  reduceMotion,
  onViewLeaderboard,
  onPlayAgain,
  onHome,
}: CascadeResultModalProps) {
  const { t } = useTranslation("cascade");
  const { t: tResult } = useTranslation("result");
  const celebrate = useCallback(
    (done: () => void) => (
      <CascadeCelebration
        clock={celebrationClock}
        reduceMotion={reduceMotion}
        ready={celebrationReady}
        onDone={done}
      />
    ),
    [celebrationClock, celebrationReady, reduceMotion]
  );
  let stats: { label: string; value: number | string }[] = [];
  if (result) {
    const time = { label: tResult("stat.time"), value: formatMs(result.timeMs) };
    const best = { label: tResult("stat.best"), value: result.bestScore };
    stats = won
      ? [
          { label: t("result.mergeScore"), value: result.mergeScore },
          { label: t("result.timeBonus"), value: result.timeBonus },
          time,
          best,
        ]
      : [best, { label: tResult("stat.merges"), value: result.merges }, time];
  }
  return (
    <GameResultModal
      visible={visible}
      outcome={won ? "win" : "ended"}
      eyebrow={t("game.title")}
      hero={{ kind: "score", label: tResult("stat.score"), value: result?.score ?? liveScore }}
      isNewBest={result?.isNewBest ?? false}
      stats={stats}
      submission={
        result && !result.submittable
          ? // No game id: nothing can reach the leaderboard, and there is
            // nothing to retry — say so instead of showing no line.
            { status: "error" }
          : toSubmission(leaderboard)
      }
      onViewLeaderboard={onViewLeaderboard}
      onPlayAgain={onPlayAgain}
      onHome={onHome}
      celebration={won ? celebrate : undefined}
      testID="cascade-result"
    />
  );
}
