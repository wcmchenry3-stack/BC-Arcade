/**
 * Blackjack replay recording (#3284, epic #3273).
 *
 * A run is recorded one round at a time. A round is the recorder's unit and is
 * two kinds of event, so a round costs ONE replay row on the server (plus a
 * lifecycle row per hand), not one row per action:
 *
 *   round_played   one per round, saved when the round closes
 *   hand_resolved  one per hand, with its full cards (a lifecycle event)
 *
 * each wrapped in the recorder's envelope (`v`, `unit`, `t_ms`). The round is
 * collected in a `RoundLog` while it is played (a few small arrays; nothing is
 * serialised, stored or sent) and recorded once, when the last hand settles.
 *
 *   round_played { b, p, d, sh, rem, a?, dl?, r? }
 *     b    [bet, chips before the bet]
 *     p    the player's two cards as dealt
 *     d    the dealer's two cards as [hole, up] (the engine's order: dealer_hand[0]
 *          is the face-down card)
 *     sh   the shoe's size (decks x 52); rem the cards left in it after the deal
 *          (a `rem` above the last round's means the shoe was reshuffled)
 *     a    the actions in order, each [code, hand] plus a third item:
 *            ["h", i, "KS"]  hit, the card drawn       ["d", i, "9S"]  double, the card
 *            ["s", i]        stand                     ["p", i, [[A, new], [B, new]]]
 *          a split, the two hands it made, which take hand i's place (table order)
 *     dl   the dealer's play, only when it played (not when every hand busted or a
 *          natural settled on the deal): { d: cards drawn, t: final total, b?: 1 bust }
 *     r    1 on a round resumed after the app was killed mid-hand: the deal and the
 *          earlier actions were not kept, so `p` is absent and `a` is only what
 *          followed (the hands' cards are all in `hand_resolved`)
 *
 *   hand_resolved { i, o, p, ch, c }
 *     i the hand's index at the end of the round; o the outcome (blackjack, win,
 *     lose, push); p the chips it paid (negative for a loss); ch the chip count after
 *     the round; c the hand's cards
 *
 * Cards are the rank and the suit, `"QS"`: `A 2-9 T J Q K` and `S H D C` (ten is
 * `T`). Every card dealt or drawn is in one of these, so a round replays without
 * the shoe. Booleans are omitted when false.
 *
 * Builds before #3284 sent `bet_placed`, `hand_dealt` and `player_action` (one row
 * each) and a different `hand_resolved`; the backend still accepts them
 * (backend/blackjack/events.py). New builds do not send those three.
 *
 * Cost -> performance -> data: the log is small arrays and short strings; no
 * `JSON.stringify`, no storage, no deep copy. The recorder keeps the one event
 * in memory and saves the round at one idle moment after it ends, never in the
 * card animations.
 */

import { handValue, type Card, type EngineState } from "./engine";

/** The action a `["h"|"s"|"d"|"p", ...]` entry records. */
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

/** A round being played: what `round_played` will say. */
export interface RoundLog {
  readonly b: [number, number];
  readonly p?: string[];
  readonly d: string[];
  readonly sh: number;
  readonly rem: number;
  readonly a: unknown[][];
  dl?: { d: string[]; t: number; b?: 1 };
  readonly r?: 1;
}

/** A log for the round `prev` -> `next` just dealt (the bet). */
export function openRoundLog(prev: EngineState, next: EngineState): RoundLog {
  return {
    // From prev.chips: placeBet can settle a natural at once (#503).
    b: [next.bet, prev.chips],
    p: encodeCards(next.player_hand),
    d: encodeCards(next.dealer_hand.slice(0, 2)),
    sh: next.rules.deck_count * 52,
    rem: next.deck.length,
    a: [],
  };
}

/**
 * A log for a round found mid-hand after a kill (the saved state is in phase
 * `player`): the deal and the actions so far were not kept.
 */
export function resumedRoundLog(s: EngineState): RoundLog {
  return {
    b: [s.bet, s.chips],
    d: encodeCards(s.dealer_hand.slice(0, 2)),
    sh: s.rules.deck_count * 52,
    rem: s.deck.length,
    a: [],
    r: 1,
  };
}

/**
 * Add the action the player just took on hand `prev.active_hand_index`: the
 * card a hit or double drew, or the two hands a split made.
 */
export function logAction(
  log: RoundLog,
  prev: EngineState,
  next: EngineState,
  action: RecordedAction
): void {
  const i = prev.active_hand_index;
  const code = ACTION_CODE[action];
  if (action === "hit" || action === "double") {
    const hand = handAt(next, i);
    const drawn = hand[hand.length - 1];
    log.a.push(drawn ? [code, i, encodeCard(drawn)] : [code, i]);
  } else if (action === "split") {
    // After the split the acted-on hand and the one inserted behind it.
    log.a.push([code, i, [encodeCards(handAt(next, i)), encodeCards(handAt(next, i + 1))]]);
  } else {
    log.a.push([code, i]);
  }
}

/**
 * Add the dealer's play if this transition had one: the round ended with a
 * hand still standing (every hand busting means the dealer never draws, and a
 * natural settles on the deal, from `betting`).
 */
export function logDealer(log: RoundLog, prev: EngineState, next: EngineState): void {
  if (prev.phase !== "player" || next.phase === "player" || next.phase === "betting") return;
  const hands = next.split_count > 0 ? next.player_hands : [next.player_hand];
  if (hands.every((h) => handValue(h) > 21)) return;
  const total = handValue(next.dealer_hand);
  const dl: { d: string[]; t: number; b?: 1 } = {
    d: encodeCards(next.dealer_hand.slice(prev.dealer_hand.length)),
    t: total,
  };
  if (total > 21) dl.b = 1;
  log.dl = dl;
}

/** The `round_played` payload: a fresh object (the recorder keeps it as given). */
export function roundPlayedData(log: RoundLog): Record<string, unknown> {
  const data: Record<string, unknown> = { b: log.b };
  if (log.p) data.p = log.p;
  data.d = log.d;
  data.sh = log.sh;
  data.rem = log.rem;
  if (log.a.length > 0) data.a = log.a;
  if (log.dl) data.dl = log.dl;
  if (log.r) data.r = log.r;
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
