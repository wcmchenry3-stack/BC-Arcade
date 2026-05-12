/**
 * Hearts — shared types (#604).
 *
 * Pure data. No React, no AsyncStorage, no side effects. Imported by the
 * engine, AI, UI components, and persistence layer alike.
 */

export type AiDifficulty = "easy" | "medium" | "hard";
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "medium", "hard"];

/** UI events emitted by the engine and consumed by the animation layer. */
export type GameEvent =
  | { readonly type: "moonShot"; readonly shooter: number }
  | { readonly type: "heartsBroken" }
  | { readonly type: "queenOfSpadesPlayed" }
  | { readonly type: "queenOfSpades"; readonly takerSeat: number };

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** One card played in a trick, annotated with which player played it. */
export interface TrickCard {
  readonly card: Card;
  readonly playerIndex: number;
}

/** Pass direction cycles per hand: Left → Right → Across → Keep, repeat. */
export type PassDirection = "left" | "right" | "across" | "none";

export type HeartsPhase =
  | "dealing" // between hands — UI shows hand scores before next deal
  | "passing" // players select 3 cards to pass
  | "playing" // trick-taking in progress
  | "hand_end" // 13th trick complete, scoring in progress (transient)
  | "game_over"; // any player reached ≥ 100; lowest score wins

/**
 * Immutable snapshot of the full Hearts game.
 * Players: index 0 = human, 1 = left AI, 2 = top AI, 3 = right AI.
 * `_v` is a schema version so persisted saves can be migrated or rejected.
 * v2 adds `scoreHistory` so per-round deltas survive screen unmount (#745).
 * v3 adds `aiDifficulty` for the Easy/Medium/Hard AI difficulty selector (#1168).
 */
export interface HeartsState {
  readonly _v: 3;
  readonly aiDifficulty: AiDifficulty;
  readonly phase: HeartsPhase;
  /** 1-based. Pass direction = getPassDirection(handNumber). */
  readonly handNumber: number;
  readonly passDirection: PassDirection;
  /** Current cards held per player (index 0–3). */
  readonly playerHands: readonly (readonly Card[])[];
  /** Running point totals across all hands [human, ai1, ai2, ai3]. Lower is better. */
  readonly cumulativeScores: readonly number[];
  /** Points taken this hand per player (hearts + Q♠). Reset each hand. */
  readonly handScores: readonly number[];
  /**
   * Per-resolved-hand applied deltas (post-moon). scoreHistory[round][playerIndex]
   * is the score the player took for that round, after moon-shot inversion.
   * Length === completed hands === handNumber - 1 once we've started the next deal.
   */
  readonly scoreHistory: readonly (readonly number[])[];
  /** Cards each player has chosen to pass (up to 3). Empty until selection made. */
  readonly passSelections: readonly (readonly Card[])[];
  readonly passingComplete: boolean;
  /** Cards played in the current trick, in play order. */
  readonly currentTrick: readonly TrickCard[];
  /** Player index of whoever led the current trick (or leads next). */
  readonly currentLeaderIndex: number;
  /** Player index whose turn it is to act. */
  readonly currentPlayerIndex: number;
  /** All cards taken per player this hand (for moon detection). */
  readonly wonCards: readonly (readonly Card[])[];
  readonly heartsBroken: boolean;
  /** Number of tricks played so far this hand (0–13). */
  readonly tricksPlayedInHand: number;
  readonly isComplete: boolean;
  readonly winnerIndex: number | null;
  /**
   * One-shot UI events set by the engine and cleared by the animation layer.
   * Optional so legacy serialized states (no `events` field) deserialize cleanly.
   */
  readonly events?: readonly GameEvent[];
}
