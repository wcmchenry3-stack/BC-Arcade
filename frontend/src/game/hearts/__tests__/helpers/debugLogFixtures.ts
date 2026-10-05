/**
 * Hand debug logs for the debugLog formatter and the HeartsDebugPanel tests
 * (#2957). Not a test file.
 */
import type { HandDebugLog } from "../../debugLog";
import type { Card, PassDirection, Rank, Suit } from "../../types";

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });

/** One logged hand: seat 0 passes the Ace of spades, and seat 2 wins a trick holding the Queen. */
export function handLog(
  overrides: Partial<HandDebugLog> & { passDirection?: PassDirection } = {}
): HandDebugLog {
  return {
    handNumber: 1,
    passDirection: "left",
    initialHands: [
      [c("spades", 1), c("hearts", 10)],
      [c("clubs", 2)],
      [c("spades", 12), c("diamonds", 13)],
      [],
    ],
    passSelections: [[c("spades", 1)], [c("clubs", 2)], [c("diamonds", 13)], []],
    finalHands: [[c("hearts", 10)], [c("spades", 1)], [c("spades", 12)], [c("clubs", 2)]],
    tricks: [
      {
        plays: [
          { playerIndex: 0, card: c("hearts", 10) },
          { playerIndex: 1, card: c("hearts", 11) },
          { playerIndex: 2, card: c("hearts", 13) },
          { playerIndex: 3, card: c("hearts", 2) },
        ],
        winnerIndex: 2,
        pointsWon: 4,
      },
      {
        plays: [
          { playerIndex: 2, card: c("clubs", 5) },
          { playerIndex: 3, card: c("clubs", 3) },
        ],
        winnerIndex: 2,
        pointsWon: 0,
      },
    ],
    scoreDeltas: [0, 0, 4, 22],
    cumulativeScoresAfter: [5, 6, 9, 22],
    ...overrides,
  };
}

export const PLAYER_LABELS = ["You", "Ann", "Bo", "Cy"] as const;
