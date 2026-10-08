import type { LeaderboardSubmitState } from "../../game/_shared/useLeaderboardSubmit";
import type { ResultSubmission } from "./GameResultModal";

/**
 * What `toSubmission` reads from the rank-lookup hook (`useGameLeaderboard`'s
 * `leaderboard`, i.e. `useLeaderboardSubmit`'s state): its status fields and
 * its two actions. The hook's `submit` / `reset` are the screen's, not the
 * card's, so they are not needed.
 */
export type SubmissionSource = Pick<
  LeaderboardSubmitState<unknown>,
  "status" | "rank" | "isBest" | "playerName" | "joinLeaderboards" | "retry"
>;

/**
 * The result card's `submission` prop from the rank-lookup hook (#2976).
 *
 * `GameResultModal` keeps its own prop shape (owner decision on #2976 and
 * #2990): the hook's fields pass through as they are, and its actions are
 * renamed to the card's callbacks — `joinLeaderboards` → `onJoinLeaderboards`
 * (the one-time "Join leaderboards" prompt) and `retry` → `onRetry` (Retry
 * after an `error`).
 *
 *   <GameResultModal submission={toSubmission(leaderboard)} … />
 *
 * Returns a new object on each call, as the inline literal it replaces did.
 */
export function toSubmission(source: SubmissionSource): ResultSubmission {
  return {
    status: source.status,
    rank: source.rank,
    isBest: source.isBest,
    playerName: source.playerName,
    onJoinLeaderboards: source.joinLeaderboards,
    onRetry: source.retry,
  };
}
