/**
 * The conservative CPU's pass (#3159): docs/hearts/CONSERVATIVE_AI.md §2.4
 * Passing (P8 = P5 then P6, then the P4 danger order), judged against the
 * original 13. The pass direction never changes the choice. No RNG.
 */

import { isQueenOfSpades } from "../engine";
import type { Card, PassDirection } from "../types";
import {
  type PrincipleId,
  dangerOrder,
  isHighHeart,
  isSpadeHonour,
  label,
  passView,
  rankValue,
  spadesProtected,
  without,
} from "./terms";

export interface PassDecision {
  /** The three cards, in P8 order. */
  readonly cards: readonly Card[];
  /** Always P8-PASS: the rulebook's principle for a pass. */
  readonly principle: "P8-PASS";
  /** The §2.4 Passing step that listed each card (P5, P6 or P4), in `cards` order. */
  readonly principles: readonly PrincipleId[];
  /** One plain-English sentence per card (developer-facing; not shown to players). */
  readonly reasons: readonly string[];
}

/** The conservative CPU's three cards to pass from a 13-card hand. `_direction` is deliberately unused (§4). */
export function choosePass(hand: readonly Card[], _direction: PassDirection): PassDecision {
  const v = passView(hand);
  const list: { card: Card; principle: PrincipleId; reason: string }[] = [];
  let rest: Card[] = [...hand];

  // 1. P5: Q♠, A♠, K♠ (those held, in that order) unless spades are PROTECTED;
  //    if PROTECTED, all three are kept and no later step may pass them.
  const queenAndHonours = (c: Card) => isQueenOfSpades(c) || isSpadeHonour(c);
  if (!spadesProtected(hand)) {
    for (const rank of [12, 1, 13] as const) {
      const card = rest.find((c) => c.suit === "spades" && c.rank === rank);
      if (card) list.push({ card, principle: "P5-QUEEN", reason: "spades are unprotected." });
    }
  }
  rest = without(rest, queenAndHonours);

  // 2. P6: HIGH hearts, highest first.
  const highHearts = rest
    .filter((c) => isHighHeart(v, c))
    .sort((a, b) => rankValue(b) - rankValue(a));
  for (const card of highHearts) {
    list.push({ card, principle: "P6-DISCARD", reason: "a high heart." });
  }
  rest = without(rest, (c) => highHearts.includes(c));

  // 3. P4: every other card, in danger order.
  for (const card of [...rest].sort(dangerOrder(v))) {
    list.push({ card, principle: "P4-DANGER", reason: "next in danger order." });
  }

  const chosen = list.slice(0, 3);
  return {
    cards: chosen.map((p) => p.card),
    principle: "P8-PASS",
    principles: chosen.map((p) => p.principle),
    reasons: chosen.map((p) => `${label(p.card)}: ${p.reason}`),
  };
}
