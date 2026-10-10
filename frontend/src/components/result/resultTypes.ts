import type React from "react";
import type { StyleProp, TextStyle } from "react-native";
import type MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { TFunction } from "i18next";
import { formatNumber } from "../../api/statsDisplay";
import type { RankLookupStatus } from "../../game/_shared/useGameRank";

/**
 * The shapes of the one end-of-game result card every game uses (#2504, epic
 * #2500): what a game passes in, and the few helpers the card's parts share.
 * Split out of `GameResultModal` in #2990.
 */

export type GameOutcome = "win" | "loss" | "draw" | "ended";

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export type ResultHero =
  | { kind: "score"; label: string; value: number | string }
  | { kind: "versus"; you: number | string; opponent: number | string; opponentLabel: string };

export interface ResultStat {
  label: string;
  value: number | string;
}

export interface ResultAction {
  label: string;
  /**
   * Renders the button's text itself, given the button's text style, for a
   * label that updates on its own (a self-ticking countdown, #2964). `label`
   * is then not shown, and the screen-reader label comes from the rendered
   * text unless `accessibilityLabel` is set.
   */
  labelNode?: (textStyle: StyleProp<TextStyle>) => React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  /** Shown before the label; a disabled primary defaults to a clock. */
  icon?: IconName;
  accessibilityLabel?: string;
}

export interface ResultSubmission {
  status: RankLookupStatus;
  /** The rank of the player's best entry on the board (#2633). */
  rank?: number | null;
  /**
   * Whether this game is that best entry. `false` shows "Your best: #N"
   * instead of this game's placing; omitted means it is.
   */
  isBest?: boolean | null;
  playerName?: string | null;
  /**
   * The one-time "Join leaderboards" prompt (#2778): joins under a
   * server-generated name and looks the waiting game's rank up.
   */
  onJoinLeaderboards?: () => Promise<boolean> | void;
  onRetry?: () => void;
}

export interface GameResultModalProps {
  visible: boolean;
  outcome: GameOutcome;
  /** For a loss against a named opponent: the title becomes "{{name}} Wins". */
  winnerName?: string;
  /** Small caps line above the title, e.g. "SUDOKU · HARD". */
  eyebrow?: string;
  /** The game's own line under the title, e.g. "Solved in 12:48". */
  subtitle?: string;
  hero?: ResultHero;
  /** Up to four; the strip is hidden when empty. */
  stats?: ResultStat[];
  isNewBest?: boolean;
  /** Game-specific content (Hearts standings, Yacht scorecard). */
  detail?: React.ReactNode;
  /** Omit for games without a leaderboard. */
  submission?: ResultSubmission;
  /**
   * Opens the game's leaderboard (#2633): a "View leaderboard" link under
   * the submission line, whatever its status. Pass `useLeaderboardLink`'s
   * result, which is undefined (no link) for a game without an openable board.
   */
  onViewLeaderboard?: (options?: { pendingSync?: boolean }) => void;
  /** Defaults to Play Again when `onPlayAgain` is given. */
  primaryAction?: ResultAction;
  onPlayAgain?: () => void;
  /** Change Difficulty / Mode / Layout / Level, Share … */
  secondaryAction?: ResultAction;
  /** Required: Home is on every card, and Android back goes Home. */
  onHome: () => void;
  /** Screen-reader label for Home when it does more than leave (e.g. cashes out). */
  homeLabel?: string;
  /**
   * A win celebration to play before the card. Render it and call `done` when
   * it ends or is tapped; the card appears then (or after a safety timeout).
   */
  celebration?: (done: () => void) => React.ReactNode;
  testID?: string;
}

export type ResultCardProps = Omit<GameResultModalProps, "visible" | "celebration">;

/** Submission states where this game's rank isn't known yet (#2633). */
export const RANK_PENDING: ReadonlySet<RankLookupStatus> = new Set([
  "idle",
  "submitting",
  "offline",
]);

export function formatValue(t: TFunction, value: number | string): string {
  return typeof value === "number" ? formatNumber(t, value) : value;
}
