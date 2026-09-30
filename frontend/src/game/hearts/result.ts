/**
 * Pure helpers for the Hearts result card (#2506). Lowest score wins.
 */

export interface HeartsResult {
  /** From the human seat's point of view; a shared lowest score is a draw. */
  readonly outcome: "win" | "loss" | "draw";
  /** The seat named as the winner on a loss (lowest score, first seat on a tie). */
  readonly winnerIndex: number;
  /** The seat whose score ended the game (the highest; first seat on a tie). */
  readonly limitIndex: number;
}

export function heartsResult(scores: readonly number[], human = 0): HeartsResult {
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const leaders = scores.flatMap((s, i) => (s === low ? [i] : []));
  const outcome = !leaders.includes(human) ? "loss" : leaders.length > 1 ? "draw" : "win";
  return { outcome, winnerIndex: leaders[0] ?? 0, limitIndex: scores.indexOf(high) };
}

/**
 * The `final_score` a finished game records: 100 − the human's points, so
 * higher is better on the leaderboard (fewer points is better in play).
 */
export function heartsLeaderboardScore(humanPoints: number): number {
  return Math.max(0, 100 - humanPoints);
}

/**
 * The `result` block a finished game sends on completion (#2838): the
 * leaderboard value and outcome, plus the round-by-round path to it. Rows come
 * from the engine's `scoreHistory` (post moon adjustment: 0 for the shooter,
 * 26 for each opponent), in seat order; `human` is the human's seat.
 */
export type HeartsCompletedResult = {
  readonly final_score: number;
  readonly vs_result: HeartsResult["outcome"];
  readonly hand_scores: number[][];
  readonly final_scores: number[];
  readonly human_seat: number;
};

export function buildHeartsCompletedResult(
  cumulativeScores: readonly number[],
  scoreHistory: readonly (readonly number[])[],
  human = 0
): HeartsCompletedResult {
  return {
    final_score: heartsLeaderboardScore(cumulativeScores[human] ?? 0),
    vs_result: heartsResult(cumulativeScores, human).outcome,
    hand_scores: scoreHistory.map((row) => [...row]),
    final_scores: [...cumulativeScores],
    human_seat: human,
  };
}

export interface Standing {
  readonly seat: number;
  readonly score: number;
  /** 1-based; tied scores share a rank (1, 1, 3, 4). */
  readonly rank: number;
}

/** Seats ordered best (lowest) first; ties keep seat order. */
export function heartsStandings(scores: readonly number[]): Standing[] {
  const order = scores.map((score, seat) => ({ seat, score })).sort((a, b) => a.score - b.score);
  return order.map((row) => ({
    ...row,
    rank: 1 + order.filter((o) => o.score < row.score).length,
  }));
}
