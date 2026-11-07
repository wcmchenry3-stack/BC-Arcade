/**
 * Dev-panel deck stacking for Blackjack (#3576). Pure functions, no React.
 *
 * The engine deals with `deck.pop()`, so the cards to be dealt first sit at the
 * END of the deck. `stackDeck` puts a chosen sequence there, leaving the engine
 * untouched; the dev panel applies it outside the recorded player actions.
 *
 * Deal order: `placeBet` deals player, dealer (hole), player, dealer (up card);
 * after that hits, doubles, splits and dealer draws pop from the same stack.
 */
import type { Card, EngineState } from "./engine";

/**
 * Returns `state` with `cards` on top of its deck: the first card in `cards` is
 * the next one dealt. One copy of each stacked card is removed from the rest of
 * the deck when present, so a single-deck game keeps sane card counts. When the
 * stack runs out (or the deck was empty) the engine's own empty-deck reshuffle
 * takes over, so the stacked cards still come first.
 */
export function stackDeck(state: EngineState, cards: readonly Card[]): EngineState {
  const rest = [...state.deck];
  for (const c of cards) {
    const i = rest.findIndex((d) => d.rank === c.rank && d.suit === c.suit);
    if (i >= 0) rest.splice(i, 1);
  }
  const stacked = cards.map((c) => ({ suit: c.suit, rank: c.rank })).reverse();
  return { ...state, deck: [...rest, ...stacked] };
}

export interface BlackjackDevPreset {
  readonly label: string;
  /** Cards in deal order. */
  readonly cards: readonly Card[];
}

const c = (rank: string, suit: string): Card => ({ rank, suit });

/**
 * Each preset lists cards in deal order: player, dealer hole, player, dealer up,
 * then the draws that follow (hits, split cards, dealer draws).
 */
export const BLACKJACK_DEV_PRESETS: readonly BlackjackDevPreset[] = [
  {
    // Player 8,8 (16) vs dealer ?,6. Split gives hands 8+3 and 8+K.
    label: "Pair to split",
    cards: [c("8", "♠"), c("10", "♥"), c("8", "♦"), c("6", "♣"), c("3", "♠"), c("K", "♥")],
  },
  {
    // Player 8,8 vs dealer ?,6. Three splits (the engine's maximum, MAX_SPLITS) make four hands.
    // 1st split: 8+8, 8+5. 2nd split of hand 0: 8+8, 8+2. 3rd split of hand 0: 8+3, 8+4.
    // Final hands: 8+3, 8+4, 8+2, 8+5. Needs chips for four bets.
    label: "Pair ×4 split",
    cards: [
      c("8", "♠"),
      c("10", "♥"),
      c("8", "♦"),
      c("6", "♣"),
      c("8", "♣"),
      c("5", "♠"),
      c("8", "♥"),
      c("2", "♦"),
      c("3", "♠"),
      c("4", "♥"),
    ],
  },
  {
    // Player 2,2 then hits 3, 2, A, A: six cards, 21. Dealer 10,7 stands on 17.
    label: "6-card 21",
    cards: [
      c("2", "♠"),
      c("10", "♥"),
      c("2", "♦"),
      c("7", "♣"),
      c("3", "♠"),
      c("2", "♥"),
      c("A", "♠"),
      c("A", "♥"),
    ],
  },
  {
    // Player A,K natural blackjack vs dealer 9,7 (16).
    label: "Player natural",
    cards: [c("A", "♠"), c("9", "♥"), c("K", "♦"), c("7", "♣")],
  },
  {
    // Player 10,9 (19) vs dealer A,K natural (21).
    label: "Dealer natural",
    cards: [c("10", "♠"), c("A", "♥"), c("9", "♦"), c("K", "♣")],
  },
  {
    // Player 10,9 (19) stands. Dealer 2,3 (5) draws 2, 3, 2, K and busts on 22.
    label: "Dealer draws 4 and busts",
    cards: [
      c("10", "♠"),
      c("2", "♥"),
      c("9", "♦"),
      c("3", "♣"),
      c("2", "♠"),
      c("3", "♦"),
      c("2", "♣"),
      c("K", "♥"),
    ],
  },
  {
    // Player 10,9 (19) vs dealer 10,9 (19). Stand for a push.
    label: "Push",
    cards: [c("10", "♠"), c("10", "♥"), c("9", "♦"), c("9", "♣")],
  },
  {
    // Player 10,8 (18) vs dealer A,6 (soft 17). With hit-soft-17 the dealer draws a 4 (21).
    label: "Soft 17",
    cards: [c("10", "♠"), c("A", "♥"), c("8", "♦"), c("6", "♣"), c("4", "♠")],
  },
  {
    // Player A,A vs dealer 9,6. Split gives hands A+K and A+5 (one card each, then done).
    label: "Ace pair",
    cards: [c("A", "♠"), c("9", "♥"), c("A", "♦"), c("6", "♣"), c("K", "♠"), c("5", "♥")],
  },
];
