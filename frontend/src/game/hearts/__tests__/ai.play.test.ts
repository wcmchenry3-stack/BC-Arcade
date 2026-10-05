/**
 * Hearts AI unit tests (#606): `selectCardToPlay` — leads, follows and discards (`chooseLead` /
 * `chooseFollow`).
 *
 * Split out of the former `ai.test.ts` (#2955) along the exported-function clusters of `ai.ts`:
 * passing (`selectCardsToPass`), playing (`selectCardToPlay`) and moon detection
 * (`detectPotentialMoon` / `detectMoonAttempt` and the moon-mode play paths they drive). Describe
 * blocks moved whole; shared fixtures live in `helpers/aiFixtures.ts`.
 */
import { detectMoonAttempt, selectCardToPlay } from "../ai";
import { getValidPlays, setRng } from "../engine";
import type { Card, HeartsState, Rank, TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardToPlay — void (discarding)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — void in led suit", () => {
  it("discards Q♠ when void and Q♠ is a valid play", () => {
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 12));
  });

  it("discards highest heart when void and no Q♠", () => {
    const hand = [c("hearts", 5), c("hearts", 11), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Utility AI discards a heart (any heart is valid; not penalised for suit choice)
    expect(pick.suit).toBe("hearts");
  });

  it("discards highest card of longest suit when no hearts or Q♠", () => {
    const hand = [c("diamonds", 5), c("diamonds", 10), c("spades", 3)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Utility AI discards a non-point card (no hearts or Q♠ to penalise)
    expect([c("diamonds", 5), c("diamonds", 10), c("spades", 3)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// selectCardToPlay — following suit
// ---------------------------------------------------------------------------

describe("selectCardToPlay — following suit with points in trick", () => {
  it("plays highest card that still loses when trick has points", () => {
    const hand = [c("spades", 5), c("spades", 7), c("spades", 9)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 1), playerIndex: 1 }, // discard — has points
      { card: c("spades", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Winning rank is 10; utility AI plays a losing spade (any of 5, 7, 9)
    expect(pick.suit).toBe("spades");
    expect([5, 7, 9]).toContain(pick.rank);
  });

  it("plays a spade when forced to win a trick with points", () => {
    const hand = [c("spades", 11), c("spades", 13)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 2), playerIndex: 1 },
    ];
    const state = mkState({
      playerHands: [[], [], [hand[0]!, hand[1]!], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 2,
    });
    const pick = selectCardToPlay(hand, trick, state, 2);
    // Both 11 and 13 beat 10; utility AI picks one (valid play required)
    expect(["spades"]).toContain(pick.suit);
    expect([11, 13]).toContain(pick.rank);
  });
});

// ---------------------------------------------------------------------------
// selectCardToPlay — always returns a valid card
// ---------------------------------------------------------------------------

describe("selectCardToPlay — always valid", () => {
  it("returns a card that passes getValidPlays (first trick lead)", () => {
    const hand = [c("clubs", 2), c("hearts", 5), c("spades", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      tricksPlayedInHand: 0,
      heartsBroken: false,
      currentTrick: [],
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    const valid = getValidPlays(state, 0);
    expect(valid).toContainEqual(pick);
  });

  it("returns a card that passes getValidPlays (following, must follow suit)", () => {
    const hand = [c("hearts", 3), c("hearts", 7), c("clubs", 9)];
    const trick: TrickCard[] = [{ card: c("hearts", 2), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], [hand[0]!, hand[1]!, hand[2]!], [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1);
    const valid = getValidPlays(state, 1);
    expect(valid).toContainEqual(pick);
  });

  it("returns the only valid card when just one option", () => {
    const hand = [c("clubs", 2)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      tricksPlayedInHand: 0,
      currentTrick: [],
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    expect(pick).toEqual(c("clubs", 2));
  });
});

// ---------------------------------------------------------------------------
// Ace-high regression tests (issue #1166)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — ace treated as high card", () => {
  it("chooseLead: does not lead ace when Q♠ is still live", () => {
    // A♠ risks having Q♠ discarded onto us; utility AI avoids leading it.
    const hand = [c("spades", 1), c("spades", 3)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    expect(pick).not.toEqual(c("spades", 1));
  });

  it("chooseDiscard: discards ace as highest heart when void in led suit", () => {
    const hand = [c("hearts", 1), c("hearts", 3), c("diamonds", 5)];
    const trick: TrickCard[] = [
      { card: c("clubs", 8), playerIndex: 0 },
      { card: c("clubs", 9), playerIndex: 1 },
      { card: c("clubs", 10), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("hearts", 1));
  });

  it("chooseDiscard: discards a club when void in spades (all clubs are non-point)", () => {
    const hand = [c("clubs", 1), c("clubs", 4), c("clubs", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 },
      { card: c("spades", 6), playerIndex: 1 },
      { card: c("spades", 7), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick.suit).toBe("clubs");
  });

  it("moon blocking: dumps ace of hearts before lower hearts", () => {
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 2) as Rank));
    const hand = [c("hearts", 1), c("hearts", 3), c("diamonds", 4)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 6), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      handScores: [5, 0, 0, 0],
      wonCards: [allHearts5, [], [], []],
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("hearts", 1));
  });
});

// ---------------------------------------------------------------------------
// Cautious AI — selectCardToPlay
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Cautious difficulty", () => {
  it("leads the lowest valid card", () => {
    const hand = [c("spades", 1), c("spades", 3), c("diamonds", 5)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0, "cautious");
    // Lowest card (ace-high, so spades 3 is lowest)
    expect(pick).toEqual(c("spades", 3));
  });

  it("discards the lowest card when void in led suit", () => {
    const hand = [c("spades", 12), c("hearts", 11), c("diamonds", 3)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    // Utility AI rates Q♠ off-suit void dump at 1.0 vs 0.8 for other cards while holding Q♠
    expect(pick).toEqual(c("spades", 12));
  });

  it("follows suit with the highest card that still loses (duck high, #1500, #2236)", () => {
    // 10♠ is winning with A♥ in the trick. 5♠ and 9♠ are beaten; J♠ could
    // still take the trick (and the heart). Shed 9♠ — the higher liability.
    const hand = [c("spades", 5), c("spades", 9), c("spades", 11)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 1), playerIndex: 1 },
    ];
    const state = mkState({
      playerHands: [[], [], [hand[0]!, hand[1]!, hand[2]!], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 2,
    });
    const pick = selectCardToPlay(hand, trick, state, 2, "cautious");
    expect(pick).toEqual(c("spades", 9));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — card counting (leading)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, card counting", () => {
  it("avoids leading K♠ when Q♠ is still live", () => {
    const hand = [c("spades", 13), c("spades", 2), c("clubs", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []], // Q♠ not seen
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    // Should not lead K♠ since Q♠ might be discarded onto it
    expect(pick).not.toEqual(c("spades", 13));
  });

  it("leads a safe card when Q♠ is already in wonCards (K♠ no longer avoided)", () => {
    const hand = [c("spades", 13), c("spades", 2), c("clubs", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 6,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[c("spades", 12)], [], [], []], // Q♠ already taken
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    // Q♠ is gone — K♠/A♠ risk no longer applies; any card is a safe lead.
    // Utility AI picks lowest of a safe suit (2♠ or 7♣ are expected candidates).
    expect([c("spades", 2), c("clubs", 7), c("spades", 13)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// Daring AI — score-aware endgame
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, score-aware endgame", () => {
  it("dumps Q♠ on score leader when void and score leader is winning the trick", () => {
    // Player 0 has the highest score (70) and is winning the trick.
    // Daring (player 1) is void in clubs and should dump Q♠ to push player 0 toward 100.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 8), playerIndex: 0 },
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 5), playerIndex: 3 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [70, 20, 10, 15],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("holds Q♠ when dumping would push trick winner to 100+ and Daring is not the game leader", () => {
    // Player 2 (score 88) is winning the trick; 88 + 13 = 101 ≥ 100 would end the game.
    // Daring (player 1, score 50) is not the game leader (player 0 has lowest score 30).
    // Player 3 is the score leader (92) but is NOT winning the trick — offensive dump doesn't fire.
    // Daring should hold Q♠ and discard a safe card instead.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 4), playerIndex: 3 },
      { card: c("clubs", 6), playerIndex: 0 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [30, 50, 88, 92],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// chooseFollow — safe trick, never self-dump point cards (#1363)
// ---------------------------------------------------------------------------

describe("chooseFollow — safe trick, never self-dump Q♠ or hearts (#1363)", () => {
  it("does not play Q♠ last in a 0-pt spades trick when a lower spade is available", () => {
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Q♠ (rank 12) would win the trick — should not be played
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("plays Q♠ when it is the only spade remaining (forced)", () => {
    const hand = [c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 12));
  });

  it("exhausts K♠ last in a 0-pt spades trick (K♠ has no point value)", () => {
    const hand = [c("spades", 13), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 13));
  });
});

// ---------------------------------------------------------------------------
// Regression: #1500 — chooseFollow plays highest losing card when trick is 0-pt
// ---------------------------------------------------------------------------
describe("chooseFollow — highest losing card (#1500)", () => {
  it("plays highest losing card (not lowest) in a 0-pt trick when not last to play", () => {
    // A♠ leads; K♠ and 5♠ both lose to it. Before fix: plays 5♠. After fix: plays K♠.
    const hand = [c("spades", 13), c("spades", 5)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ wins (ace-high)
    ];
    // player 1 follows; players 2 and 3 still to play (not last)
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13));
  });

  it("dumps Q♠ on K♠ trick (highest losing = Q♠ beats keeping it)", () => {
    // K♠ leads; Q♠ (rank 12 < rank 13 ace-high) loses to it — dump it.
    const hand = [c("spades", 12), c("spades", 5)];
    const trick: TrickCard[] = [
      { card: c("spades", 13), playerIndex: 0 }, // K♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ dumped
  });
});

// ---------------------------------------------------------------------------
// Regression: #1510 — chooseFollow sheds Q♠ before K♠ when A♠ is played
// ---------------------------------------------------------------------------
describe("chooseFollow — Q♠ priority over K♠ when both lose (#1510)", () => {
  it("sheds Q♠ before K♠ when A♠ leads and both would lose (pts > 0)", () => {
    // A♠ leads with Q♥ already in the trick (points > 0).
    // Player holds K♠ + Q♠ — both lose to A♠. Q♠ must be shed first.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ leads (ace-high wins)
      { card: c("hearts", 12), playerIndex: 2 }, // Q♥ discarded — trick has points
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ not K♠
  });

  it("sheds Q♠ before K♠ when A♠ leads in a 0-pt trick (no-points branch)", () => {
    // A♠ leads, no points in trick yet, player not last to play.
    // Player holds K♠ + Q♠ — both lose to A♠. Q♠ must still be shed first.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    // Player 1 follows; players 2 and 3 still to play → not last
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ not K♠
  });
});

// ---------------------------------------------------------------------------
// Regression: protected Q♠ (A♠+K♠+Q♠) must-win — never self-dump Q♠
// ---------------------------------------------------------------------------
describe("chooseFollow — protected Q♠ never self-taken when non-point winner available", () => {
  it("plays K♠ not Q♠ when A♠+K♠+Q♠ all win a 0-pt trick (not last to play)", () => {
    // Low spade leads; A♠, K♠, Q♠ all win. Should play K♠ (lowest non-point winner), not Q♠.
    const hand = [c("spades", 1), c("spades", 13), c("spades", 12), c("clubs", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 }, // 4♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    // Player 1 follows; players 2 and 3 still to play → not last
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).not.toEqual(c("spades", 12)); // Q♠ must not be played
    expect(pick.suit).toBe("spades"); // must follow suit
    expect([1, 13]).toContain(pick.rank); // A♠ or K♠ (non-point winners)
  });

  it("plays non-Q♠ winner when forced to win a point trick with K♠+Q♠ (not last)", () => {
    // Hearts trick has points; spade player must win (all spades beat current winner).
    // Should prefer K♠ over Q♠.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 }, // 10♠ leads
      { card: c("hearts", 3), playerIndex: 2 }, // heart discard — pts > 0
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    // K♠ (13) and Q♠ (12) both beat 10♠; trick has points. Should play K♠ not Q♠.
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13)); // K♠, not Q♠
  });

  it("plays non-Q♠ winner when forced to win a point trick with K♠+Q♠ (last to play)", () => {
    // Same scenario but player 1 is last (3 cards already in trick → isLastToPlay = true).
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 }, // 5♠ leads
      { card: c("hearts", 7), playerIndex: 2 }, // heart discard — pts > 0
      { card: c("spades", 6), playerIndex: 3 }, // low spade — current winner
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 7,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    // trick.length === 3 → isLastToPlay = true; pts = 1 (7♥). K♠ and Q♠ both beat 6♠.
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13)); // K♠, not Q♠
  });
});

// ---------------------------------------------------------------------------
// Regression: #1501 — medium AI avoids leading K♠/A♠ when Q♠ still live
// ---------------------------------------------------------------------------
describe("chooseLead — medium AI avoids risky spade leads (#1501)", () => {
  it("does not lead K♠ when Q♠ has not been seen", () => {
    const hand = [c("spades", 13), c("clubs", 5), c("diamonds", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: false,
      wonCards: [[], [], [], []], // Q♠ not in wonCards
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 13));
  });

  it("does not lead A♠ when Q♠ has not been seen", () => {
    const hand = [c("spades", 1), c("clubs", 4), c("diamonds", 6)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: false,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 1));
  });

  it("leads K♠ freely once Q♠ is in wonCards", () => {
    // Only K♠ is safe to lead (other cards are hearts); Q♠ already won → K♠ is safe.
    const hand = [c("spades", 13), c("hearts", 2), c("hearts", 3)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: true,
      wonCards: [[c("spades", 12)], [], [], []], // Q♠ has been played
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).toEqual(c("spades", 13));
  });
});

// ---------------------------------------------------------------------------
// Regression: #1525 — chooseFollow dumps Q♠ when last to play with covering card
// ---------------------------------------------------------------------------
describe("chooseFollow — last to play, covering card (#1525)", () => {
  it("dumps Q♠ when A♠ is covering and K♠ is already played", () => {
    // A♠ led — winningRank=14. Q♠ (rank 12) loses to A♠, so dump it.
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 },
      { card: c("spades", 13), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "schemer");
    expect(pick).toEqual(c("spades", 12));
  });

  it("does not dump Q♠ when no covering card — Q♠ would win the trick", () => {
    // 9♠ is the current winner; Q♠ rank 12 > 9 so playing Q♠ takes the trick.
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 9), playerIndex: 0 },
      { card: c("spades", 3), playerIndex: 1 },
      { card: c("spades", 5), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "schemer");
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("hard AI in moon-attempt mode does not dump Q♠ even when covering card present", () => {
    // Daring holds a viable moon hand (#2234: 5 top hearts, Q♠, A♦-led
    // diamonds) with 0 pts taken → isMoonAttempt = true.
    // A♠ is covering; Q♠ should be held to complete the moon shot.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("spades", 12),
      c("spades", 7),
      c("diamonds", 1),
      c("diamonds", 3),
      c("diamonds", 2),
    ];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 },
      { card: c("spades", 13), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "daring");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// #1594 — Daring AI: chooseLeadHard never leads Q♠ as fallback
// ---------------------------------------------------------------------------

describe("chooseLeadHard — Q♠ last-resort fallback (#1594) + shortest-suit lead when holding Q♠ (#1646)", () => {
  it("leads 2♥ (not Q♠ or K♠) when holding Q♠ — avoids spades to create void for dump (#1646)", () => {
    // valid = [Q♠, K♠, 2♥]: hearts broken. holdingQ=true → exclude spades from lead pool.
    // Only non-spade non-Q♠ option is 2♥ → lead 2♥ to void hearts and get a Q♠ dump opportunity.
    const hand = [c("spades", 12), c("spades", 13), c("hearts", 2)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 8,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []], // Q♠ not yet played
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("hearts", 2)); // only non-spade option when holding Q♠
  });

  it("leads Q♠ only when it is the sole remaining card", () => {
    const hand = [c("spades", 12)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 12,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("leads a non-Q♠ card when hearts outnumber other unsafe cards in fallback pool", () => {
    // valid = [Q♠, K♠, 3♥, 5♥]: K♠ has Q♠ risk (score 0.25); hearts safer.
    const hand = [c("spades", 12), c("spades", 13), c("hearts", 3), c("hearts", 5)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 5,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12)); // never leads Q♠
  });

  it("leads a non-spade card when holding Q♠ — Hard (#1646)", () => {
    // hand = [Q♠, K♦, 2♦, 7♣, 8♣, 9♣]: holdingQ → avoids spade lead.
    // Utility AI leads a diamond or club (shortest non-spade is diamonds).
    const hand = [
      c("spades", 12),
      c("diamonds", 13),
      c("diamonds", 2),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).not.toBe("spades");
  });

  it("leads a non-spade card when holding Q♠ — Medium (#1646)", () => {
    const hand = [
      c("spades", 12),
      c("diamonds", 13),
      c("diamonds", 2),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).not.toBe("spades");
  });

  it("leads a non-heart safe card when NOT holding Q♠ — longest path (#1646)", () => {
    // Without Q♠: no special restriction. Utility AI leads a safe non-heart card.
    const hand = [c("diamonds", 13), c("diamonds", 2), c("clubs", 7), c("clubs", 8), c("clubs", 9)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pickDaring = selectCardToPlay(hand, [], state, 0, "daring");
    const pickSchemer = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pickDaring.suit).not.toBe("hearts");
    expect(pickSchemer.suit).not.toBe("hearts");
  });
});

// ---------------------------------------------------------------------------
// Daring AI — adversarial targeting (#1638)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, adversarial void discard", () => {
  it("dumps Q♠ on seat 0 when seat 0 is winning the trick and Daring is void", () => {
    // Player 1 (Daring) is void in clubs and holds Q♠ + hearts.
    // Seat 0 is winning with K♣. Dump Q♠ on any void opportunity (not gated on position).
    const hand = [c("spades", 12), c("hearts", 5), c("hearts", 9), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 13), playerIndex: 0 }, // seat 0 winning
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 4), playerIndex: 3 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Seat 0 is winning — adversarial: dump Q♠ on human.
    expect(pick).toEqual(c("spades", 12));
  });

  it("dumps Q♠ immediately when void, even when an AI (not seat 0) is winning", () => {
    // Player 1 (Daring) is void in clubs. Seat 2 is winning with K♣ (not seat 0).
    // Adversarial mode only fires when seat 0 is winning; here it does not, so
    // normal Daring weights apply — Q♠ off-suit dump scores highest (1.0 vs 0.8 for hearts).
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });
});

describe("selectCardToPlay — Daring difficulty, adversarial void discard (edge cases)", () => {
  it("falls through to normal discard when seat 0 is winning but Daring holds no Q♠ or hearts", () => {
    // Player 1 holds only non-point cards — nothing to target seat 0 with.
    // Should fall through and discard normally (highest non-point card).
    const hand = [c("diamonds", 10), c("clubs", 9), c("diamonds", 6)];
    const trick: TrickCard[] = [
      { card: c("spades", 13), playerIndex: 0 }, // seat 0 winning with K♠
      { card: c("spades", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // No Q♠ or hearts to dump — adversarial block falls through; normal discard fires.
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("does not apply adversarial targeting when Daring is seat 0 (never happens in real game)", () => {
    // Regression: Daring at seat 0 must NOT save Q♠ waiting for a 'seat 0 win' that can never
    // fire from its own void plays — it would hold Q♠ indefinitely and hurt its own score.
    // Daring at seat 0 should dump Q♠ normally (chooseDiscard) regardless of who is winning.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 1 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning — not seat 0
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 0,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 0, "daring");
    // Adversarial targeting inactive for playerIndex=0; chooseDiscard dumps Q♠ normally.
    expect(pick).toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// First-trick club play — all personas should play highest club (#firstTrick)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — first trick, play highest club (all personas)", () => {
  function mkTrick0State(playerHands: Card[][]): HeartsState {
    return mkState({
      playerHands,
      tricksPlayedInHand: 0,
      heartsBroken: false,
    });
  }

  const personas = ["cautious", "schemer", "daring"] as const;

  for (const persona of personas) {
    it(`${persona}: 2nd follower plays highest club, not lowest`, () => {
      // Player 1 leads 2♣; player 2 (2nd follower, not last) has 6♣ 5♣ 3♣.
      const hand2 = [c("clubs", 6), c("clubs", 5), c("clubs", 3)];
      const trick: TrickCard[] = [{ card: c("clubs", 2), playerIndex: 1 }];
      const state = mkTrick0State([[], hand2, hand2, []]);
      // currentTrick must match trick so getValidPlays sees a following situation.
      const pick = selectCardToPlay(
        hand2,
        trick,
        {
          ...state,
          currentPlayerIndex: 2,
          currentTrick: trick,
        },
        2,
        persona
      );
      expect(pick).toEqual(c("clubs", 6));
    });

    it(`${persona}: 3rd follower plays highest club, not lowest`, () => {
      // Player 1 leads 2♣, player 2 played 5♣; player 3 has K♣ J♣ 10♣ — should play K♣.
      const hand3 = [c("clubs", 13), c("clubs", 11), c("clubs", 10)];
      const trick: TrickCard[] = [
        { card: c("clubs", 2), playerIndex: 1 },
        { card: c("clubs", 5), playerIndex: 2 },
      ];
      const state = mkTrick0State([[], [], [], hand3]);
      const pick = selectCardToPlay(
        hand3,
        trick,
        {
          ...state,
          currentPlayerIndex: 3,
          currentTrick: trick,
        },
        3,
        persona
      );
      expect(pick).toEqual(c("clubs", 13));
    });

    it(`${persona}: last follower (4th) plays highest club`, () => {
      // Last to play — should also play highest club (A♣ over 4♣).
      const hand0 = [c("clubs", 1), c("clubs", 9), c("clubs", 4)];
      const trick: TrickCard[] = [
        { card: c("clubs", 2), playerIndex: 1 },
        { card: c("clubs", 7), playerIndex: 2 },
        { card: c("clubs", 11), playerIndex: 3 },
      ];
      const state = mkTrick0State([hand0, [], [], []]);
      const pick = selectCardToPlay(
        hand0,
        trick,
        {
          ...state,
          currentPlayerIndex: 0,
          currentTrick: trick,
        },
        0,
        persona
      );
      expect(pick).toEqual(c("clubs", 1)); // Ace (rank 1) is highest
    });
  }
});

// ---------------------------------------------------------------------------
// Daring AI — Q♠ spade-follow behavior (#1893)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring Q♠ spade-follow behavior (#1893)", () => {
  it("dumps Q♠ when following spades with no A♠/K♠ cover and Q♠ won't win", () => {
    // Player 1 (Daring) follows spades: holds Q♠ + J♠ but NO A♠/K♠.
    // Seat 0 led A♠ — Q♠ (rank 12) loses to A♠ (aceHigh=14). Dump Q♠.
    const hand = [c("spades", 12), c("spades", 11), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("plays A♠ to win safely when holding Q♠ + A♠ and a low spade leads", () => {
    // Player 1 holds Q♠ + A♠. Low 5♠ leads — both Q♠ and A♠ would win.
    // chooseFollow plays lowestNonPoint (A♠) to win without taking 13 pts.
    const hand = [c("spades", 12), c("spades", 1), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 }, // low spade — both Q♠ and A♠ win
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // lowestNonPoint wins: A♠ (0 pts) is played, not Q♠ (13 pts).
    expect(pick).toEqual(c("spades", 1));
  });

  it("does NOT dump Q♠ when it would win the trick (no higher spade played)", () => {
    // Only J♠ in trick — Q♠ (rank 12) would WIN. Play a losing spade instead.
    const hand = [c("spades", 12), c("spades", 9), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 11), playerIndex: 0 }, // J♠ winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Q♠ would win — utility AI avoids taking the trick with Q♠.
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).toBe("spades"); // must follow suit
  });

  it("commits to the moon after capturing Q♠ + hearts (#2234)", () => {
    // Captured Q♠ + 10♥ + J♥ (15 pts), nobody else has points → committed
    // (MOON_HAND_RULES.commitPoints = 13), even though the 6-card hand no
    // longer rates on its own. The old heart-count rule (6+ total hearts)
    // dropped out here.
    const heartsInHand = [c("hearts", 2), c("hearts", 4), c("hearts", 6)];
    const heartsWon = [c("hearts", 10), c("hearts", 11)];
    const alreadyWon = [c("spades", 12), ...heartsWon]; // Q♠ + 2 hearts
    const hand = [...heartsInHand, c("diamonds", 13), c("diamonds", 8), c("clubs", 7)]; // 6 cards
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 7,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 15, 0, 0], // Q♠(13) + 2 hearts won
      wonCards: [[], alreadyWon, [], []],
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true); // committed
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    expect(pick.suit).not.toBe("hearts"); // keeps its hearts to collect the rest
  });
});
