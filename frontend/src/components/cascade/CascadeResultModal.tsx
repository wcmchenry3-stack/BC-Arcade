/**
 * Cascade's result card (#2515, #2632): the shared `GameResultModal`.
 *
 * - A loss (the lid) keeps the "Game Over" card (outcome `ended`): score, Best and Merges.
 * - A win (#3699, making the capstone) plays the celebration first (`CascadeCelebration`; the
 *   board draws it), then shows outcome `win`, "You Win!", as Blackjack's goal-reached result
 *   does: score, New best, Best, Merges and the play Time.
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
import CascadeCelebration from "./CascadeCelebration";

/** What the card shows, captured when the game ends. */
export interface CascadeResult {
  readonly score: number;
  readonly bestScore: number;
  readonly isNewBest: boolean;
  readonly merges: number;
  /** Play time (the screen's play clock) when the game ended. */
  readonly timeMs: number;
  /** False when the game had no sync id, so nothing could be submitted. */
  readonly submittable: boolean;
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
  reduceMotion,
  onViewLeaderboard,
  onPlayAgain,
  onHome,
}: CascadeResultModalProps) {
  const { t } = useTranslation("cascade");
  const { t: tResult } = useTranslation("result");
  const celebrate = useCallback(
    (done: () => void) => (
      <CascadeCelebration clock={celebrationClock} reduceMotion={reduceMotion} onDone={done} />
    ),
    [celebrationClock, reduceMotion]
  );
  const stats = result
    ? [
        { label: tResult("stat.best"), value: result.bestScore },
        { label: tResult("stat.merges"), value: result.merges },
        ...(won ? [{ label: tResult("stat.time"), value: formatMs(result.timeMs) }] : []),
      ]
    : [];
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
