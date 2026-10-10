/**
 * The result card moved to `components/result/` (#2990). This path re-exports
 * it for one release; import from `../result/GameResultModal` and its
 * siblings instead.
 */
export { default, CELEBRATION_MAX_MS, useResultFeedback } from "../result/GameResultModal";
export { ResultCard } from "../result/ResultCard";
export type {
  GameOutcome,
  GameResultModalProps,
  ResultAction,
  ResultCardProps,
  ResultHero,
  ResultStat,
  ResultSubmission,
} from "../result/resultTypes";
