/**
 * Blackjack replay recording (#3284, epic #3273).
 *
 * A run is recorded one round at a time. A round is the recorder's unit; its
 * events, in order, are:
 *
 *   bet_placed     { amount, chips_remaining }
 *   hand_dealt     { p, d, sh, rem }
 *   player_action  { a, i, c? | h? }          one per hit, stand, double, split
 *   dealer_played  { h, d, t, b? }            when the dealer played
 *   hand_resolved  { i, o, p, ch, c }         one per player hand
 *
 * each wrapped in the recorder's envelope (`v`, `unit`, `t_ms`). From the cards
 * and the bets in them a round replays without the shoe: every card that was
 * drawn is in the event of the action (or the deal) that drew it.
 *
 * Card codes are the rank and the suit, `"QS"`: `A 2-9 T J Q K` and `S H D C`
 * (a ten is `T`). The dealer's `d` in `hand_dealt` is `[hole, up]`, the
 * engine's order (`dealer_hand[0]` is the face-down card); the cards the dealer
 * draws later go in `dealer_played.d`. The hole card is repeated in
 * `dealer_played.h` so that event reads on its own.
 *
 * Wire shapes (schema `v` 1; the backend's models are blackjack/events.py):
 *
 *   hand_dealt     `p` the player's two cards; `d` the dealer's two; `sh` the
 *                  shoe's size (decks x 52); `rem` the cards left in it after
 *                  the deal. A `rem` above the last hand's means the shoe was
 *                  reshuffled before this deal.
 *   player_action  `a` h(it) / s(tand) / d(ouble) / p (split); `i` the hand
 *                  acted on, in the table order at that moment; `c` the card
 *                  drawn (hit, double); `h` the two hands a split made, which
 *                  take hand `i`'s place: `[[A, drawn], [B, drawn]]`.
 *   dealer_played  `h` the hole card; `d` the cards the dealer drew, in order;
 *                  `t` the dealer's final total; `b` 1 when it busted.
 *   hand_resolved  `i` the hand's index at the end of the round; `o` its outcome
 *                  (blackjack, win, lose, push); `p` the chips it paid (negative
 *                  for a loss); `ch` the chip count after the round; `c` the
 *                  hand's cards.
 *
 * Older builds sent a different shape (no `v`): `bet_placed` as above,
 * `hand_dealt` { player_hand, dealer_up_card, is_player_blackjack },
 * `player_action` { action, hand_index, hand_value_after } and `hand_resolved`
 * { hand_index, outcome, payout_delta, chips_after }. The backend still accepts
 * them (blackjack/events.py).
 *
 * Cost -> performance -> data: a builder reads the state it is given and makes
 * one small object (a few short strings); no `JSON.stringify`, no storage, no
 * deep copy. The recorder keeps the object in memory and the context saves the
 * round at one idle moment after it ends, never in the card animations.
 */

import { handValue, type Card, type EngineState } from "./engine";

/** The action a `player_action` records. */
export type RecordedAction = "hit" | "stand" | "double" | "split";

const ACTION_CODE: Readonly<Record<RecordedAction, string>> = {
  hit: "h",
  stand: "s",
  double: "d",
  split: "p",
};

const SUIT_CODE: Readonly<Record<string, string>> = {
  "♠": "S",
  "♥": "H",
  "♦": "D",
  "♣": "C",
};

/** `"QS"`: the card's rank (a ten is `T`) and suit. */
export function encodeCard(card: Card): string {
  return `${card.rank === "10" ? "T" : card.rank}${SUIT_CODE[card.suit] ?? "?"}`;
}

function encodeCards(cards: readonly Card[]): string[] {
  return cards.map(encodeCard);
}

/** The hand at table index `i`: the split hand, or the one hand before a split. */
function handAt(s: EngineState, i: number): readonly Card[] {
  if (s.split_count > 0) return s.player_hands[i] ?? s.player_hand;
  return s.player_hand;
}

/** `bet_placed`: the wager, and the chips left once it is down. */
export function betPlacedData(prev: EngineState, next: EngineState): Record<string, unknown> {
  // From prev.chips, not next.chips: placeBet can settle a natural at once (#503).
  return { amount: next.bet, chips_remaining: Math.max(0, prev.chips - next.bet) };
}

/** `hand_dealt`: both hands as dealt, the shoe's size and what is left of it. */
export function handDealtData(next: EngineState): Record<string, unknown> {
  return {
    p: encodeCards(next.player_hand),
    d: encodeCards(next.dealer_hand.slice(0, 2)),
    sh: next.rules.deck_count * 52,
    rem: next.deck.length,
  };
}

/**
 * `player_action`: what the player did to hand `prev.active_hand_index`, with
 * the card it drew (hit, double) or the two hands it made (split).
 */
export function playerActionData(
  prev: EngineState,
  next: EngineState,
  action: RecordedAction
): Record<string, unknown> {
  const i = prev.active_hand_index;
  const data: Record<string, unknown> = { a: ACTION_CODE[action], i };
  if (action === "hit" || action === "double") {
    const hand = handAt(next, i);
    const drawn = hand[hand.length - 1];
    if (drawn) data.c = encodeCard(drawn);
  } else if (action === "split") {
    // After the split the acted-on hand and the one inserted behind it.
    data.h = [encodeCards(handAt(next, i)), encodeCards(handAt(next, i + 1))];
  }
  return data;
}

/**
 * `dealer_played`, or null when the dealer did not play: the round ended with
 * every player hand bust (the dealer never draws), or settled on the deal.
 */
export function dealerPlayedData(
  prev: EngineState,
  next: EngineState
): Record<string, unknown> | null {
  if (prev.phase !== "player" || next.phase === "player" || next.phase === "betting") return null;
  const hands = next.split_count > 0 ? next.player_hands : [next.player_hand];
  if (hands.every((h) => handValue(h) > 21)) return null;
  const hole = next.dealer_hand[0];
  if (!hole) return null;
  const total = handValue(next.dealer_hand);
  const data: Record<string, unknown> = {
    h: encodeCard(hole),
    d: encodeCards(next.dealer_hand.slice(prev.dealer_hand.length)),
    t: total,
  };
  if (total > 21) data.b = 1;
  return data;
}

/** `hand_resolved`: one hand's cards, outcome and payout, and the chips after the round. */
export function handResolvedData(
  index: number,
  outcome: string,
  payout: number,
  chipsAfter: number,
  cards: readonly Card[]
): Record<string, unknown> {
  return { i: index, o: outcome, p: payout, ch: chipsAfter, c: encodeCards(cards) };
}
