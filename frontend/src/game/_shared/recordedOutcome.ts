import type { GameOutcome } from "../../api/vocab";

/** The result card's outcome — the same union as `GameResultModal`'s `GameOutcome`. */
export type ResultOutcome = "win" | "loss" | "draw" | "ended";

/**
 * The outcome a finished game records on its `games` row (#2517), from the
 * outcome its result card shows (#2504). Games with a winner record who won,
 * so stats can tell a win from a loss; score-only games stay `completed`.
 *
 * A tie is `push` (the vocabulary's existing tie value, #2517) rather than a
 * new `draw`, which would need a vocab + DB constraint change for no gain.
 * Every value here is a finished game: the read side counts anything that
 * isn't `abandoned` (backend/games/filters.py), so none of them drops a game
 * out of leaderboards, stats or XP.
 */
export function recordedOutcome(outcome: ResultOutcome): GameOutcome {
  switch (outcome) {
    case "win":
      return "win";
    case "loss":
      return "loss";
    case "draw":
      return "push";
    case "ended":
      return "completed";
  }
}
