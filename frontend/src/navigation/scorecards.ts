/**
 * The games with a live Scorecard (#2636): a view of the match in progress,
 * opened from the game's ⋯ menu. The one list of them — pure data, no React.
 *
 * `GameShell` adds the Scorecard item to a game screen whose `gameType` is
 * here, the `Scorecard` route's `gameKey` is typed from it, and
 * `ScorecardScreen` has a live view for each. A player's history for a game
 * is the Stats screen (`GameStats`), which every game has.
 */
import type { GameType } from "../api/vocab";

export const SCORECARD_GAMES = [
  "hearts",
  "yacht",
  "blackjack",
] as const satisfies readonly GameType[];

export type ScorecardGame = (typeof SCORECARD_GAMES)[number];

/** Whether `game` has a live Scorecard. Takes any string: route params are untyped at run time. */
export function hasScorecard(game: string | null | undefined): game is ScorecardGame {
  return game != null && (SCORECARD_GAMES as readonly string[]).includes(game);
}
