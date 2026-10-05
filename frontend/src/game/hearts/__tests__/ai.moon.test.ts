/**
 * Hearts AI unit tests (#606): moon detection and the moon-blocking / moon-attempt play paths.
 *
 * Split out of the former `ai.test.ts` (#2955) along the exported-function clusters of `ai.ts`:
 * passing (`selectCardsToPass`), playing (`selectCardToPlay`) and moon detection
 * (`detectPotentialMoon` / `detectMoonAttempt` and the moon-mode play paths they drive). Describe
 * blocks moved whole; shared fixtures live in `helpers/aiFixtures.ts`.
 */
import { detectMoonAttempt, detectPotentialMoon, selectCardToPlay } from "../ai";
import { setRng } from "../engine";
import type { Rank, TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardToPlay — moon blocking
// ---------------------------------------------------------------------------

describe("selectCardToPlay — moon blocking", () => {
  it("dumps a heart when potential moon detected", () => {
    // Player 0 has taken all 5 points so far — potential moon
    // Player 3 is void in the led suit (spades) so can discard freely
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
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
    // Should dump hearts 9 to block potential moon
    expect(pick).toEqual(c("hearts", 9));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — moon attempt
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, moon attempt", () => {
  it("discards non-hearts when void in led suit with a viable moon hand and no points taken", () => {
    // AI player 1 holds 7 hearts (5 top) + Q♠ + A♦-led diamonds (void in
    // clubs); no points taken → viable moon hand (#2234).
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9),
      c("hearts", 8),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 7),
      c("diamonds", 8),
    ];
    const trick: TrickCard[] = [{ card: c("clubs", 3), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 2,
      currentPlayerIndex: 1,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Void in clubs → can discard freely. Moon attempt: keep hearts and Q♠.
    // Should discard a diamond (highest of non-hearts/non-Q♠)
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).toBe("diamonds");
  });

  it("leads highest non-heart (A♦) in a moon attempt to stay in control", () => {
    // Moon attempt (#2234): 4 top hearts (10/J/Q/K♥) + Q♠, no points taken,
    // 11 cards remaining (trick 2) — past the opening hand, so only top hearts
    // and spade control are checked.
    const hand = [
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10),
      c("hearts", 12),
      c("hearts", 3),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 8),
      c("clubs", 13),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 2,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true); // in moon mode
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    // Moon attempt: lead highest non-heart (A♦, aceHigh=14) to win the trick.
    // Normal Daring would lead lowest of longest safe suit (8♦).
    expect(pick).toEqual(c("diamonds", 1));
  });

  it("leads a heart when only hearts and Q♠ remain in a moon attempt", () => {
    // Moon attempt (#2234): 4 top hearts + Q♠, myPoints=0=totalPointsTaken, 7 cards left
    const hand = [
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10),
      c("hearts", 12),
      c("spades", 12),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 6,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true); // in moon mode
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    // No non-hearts besides Q♠ — leads a heart (utility AI picks highest pWin heart).
    expect(pick.suit).toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("wins point trick with lowest winning card (10♥) in a moon attempt", () => {
    // Viable moon hand (#2234): 4 top hearts (10/J/Q/K♥), Q♠, A♦-led
    // diamonds; no points taken, 10 cards remaining (trick 3).
    const hand = [
      c("hearts", 10),
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 4),
      c("hearts", 12),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 5),
      c("diamonds", 6),
      c("clubs", 13),
    ];
    const trick: TrickCard[] = [
      { card: c("hearts", 3), playerIndex: 0 },
      { card: c("hearts", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt: play lowest card that beats current winner (9♥) → 10♥.
    // Normal Daring would play its loser (4♥) to avoid winning points.
    expect(pick).toEqual(c("hearts", 10));
  });
});

// ---------------------------------------------------------------------------
// detectPotentialMoon
// ---------------------------------------------------------------------------

describe("detectPotentialMoon", () => {
  it("returns null when no points taken", () => {
    const state = mkState({ handScores: [0, 0, 0, 0], wonCards: [[], [], [], []] });
    expect(detectPotentialMoon(state)).toBeNull();
  });

  it("returns player index when they have all points and ≥ 4 hearts", () => {
    const hearts4 = Array.from({ length: 4 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      handScores: [4, 0, 0, 0],
      wonCards: [hearts4, [], [], []],
    });
    expect(detectPotentialMoon(state)).toBe(0);
  });

  it("returns null when points are split between players", () => {
    const state = mkState({
      handScores: [2, 2, 0, 0],
      wonCards: [[c("hearts", 1), c("hearts", 2)], [c("hearts", 3), c("hearts", 4)], [], []],
    });
    expect(detectPotentialMoon(state)).toBeNull();
  });

  it("returns null when dominant player has fewer than 4 point cards", () => {
    const state = mkState({
      handScores: [3, 0, 0, 0],
      wonCards: [[c("hearts", 1), c("hearts", 2), c("hearts", 3)], [], [], []],
    });
    expect(detectPotentialMoon(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #1647 — Daring AI: chooseFollow moon-attempt 0-pt trick behaviour
// ---------------------------------------------------------------------------

describe("chooseFollow — moon attempt, 0-pt trick (#1647)", () => {
  it("wins 0-pt trick with lowest winning card when last to play in a moon attempt", () => {
    // Moon attempt (#2234): 4 top hearts + Q♠ in hand, 11 cards, no points taken.
    // Clubs led (0-pt trick). Player 3 is last; should win with lowest winner (9♣)
    // rather than exhausting a high card, to conserve trick-control resources.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 12),
      c("hearts", 7),
      c("hearts", 5),
      c("hearts", 3),
      c("spades", 12), // Q♠
      c("clubs", 9),
      c("clubs", 10),
      c("clubs", 11),
    ];
    const trick: TrickCard[] = [
      { card: c("clubs", 5), playerIndex: 0 },
      { card: c("clubs", 6), playerIndex: 1 },
      { card: c("clubs", 8), playerIndex: 2 }, // current winner (rank 8)
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    expect(detectMoonAttempt(hand, state, 3, "daring")).toBe(true); // in moon mode
    const pick = selectCardToPlay(hand, trick, state, 3, "daring");
    // Should win with lowest card above rank 8 → 9♣, not 10♣ or J♣
    expect(pick).toEqual(c("clubs", 9));
  });

  it("wins 0-pt trick but guards Q♠ when not last to play in a moon attempt", () => {
    // Moon attempt (#2234): player 1 holds 7 hearts (4 top) + Q♠ + K♠ + A♠,
    // 11 cards, no points taken.
    // Spades led (0-pt). Player 1 is NOT last (players 2 and 3 still to play).
    // Should win with lowest non-Q♠ winner (K♠), keeping Q♠ safe from later K♠/A♠.
    const hand = [
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10),
      c("hearts", 12),
      c("hearts", 3), // 7 hearts, 4 top
      c("spades", 12), // Q♠ — must NOT be played (not last)
      c("spades", 13), // K♠
      c("spades", 1), // A♠
      c("clubs", 7),
    ];
    const trick: TrickCard[] = [{ card: c("spades", 5), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      currentPlayerIndex: 1,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true); // in moon mode
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // K♠ and A♠ both beat 5♠; Q♠ excluded (not last); lowest non-Q♠ winner = K♠
    expect(pick).not.toEqual(c("spades", 12)); // Q♠ protected
    expect(pick).toEqual(c("spades", 13)); // K♠ — lowest non-Q♠ winner
  });
});

// ---------------------------------------------------------------------------
// #1592 — Cautious AI: basic moon blocking
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Cautious AI moon blocking (#1592)", () => {
  it("dumps highest point card when an opponent is threatening a moon", () => {
    // Player 0 has taken all 5 points — potential moon detected.
    // Player 3 (Cautious) is void in spades; should dump hearts 9 to disrupt.
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
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
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    expect(pick).toEqual(c("hearts", 9));
  });

  it("dumps A♥ before lower hearts when blocking a moon", () => {
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
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    expect(pick).toEqual(c("hearts", 1));
  });

  it("dumps a point card when LEADING and an opponent is threatening a moon", () => {
    // Cautious AI (player 1) is leading its turn. Player 0 has all 5 points — moon threat.
    // Hearts are broken, so hearts 9 is a valid lead and the moon-block should fire.
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 5,
      heartsBroken: true,
      handScores: [5, 0, 0, 0],
      wonCards: [allHearts5, [], [], []],
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, [], state, 1, "cautious");
    // Utility AI prefers safe non-point lead during moon threat (avoids feeding the shooter)
    expect(pick.suit).not.toBe("hearts");
  });

  it("plays normally (lowest) when no moon threat", () => {
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 6), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    // No moon threat → void cards all score equally; utility AI returns first candidate
    expect(pick).toEqual(c("hearts", 9));
  });
});

// ---------------------------------------------------------------------------
// #1593 — Daring AI: moonshot extended tracking + tricks-remaining guard
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring AI moonshot guard (#1593)", () => {
  it("stays in moon-attempt mode once committed: holds all points and ≥ 13 of them (#2234)", () => {
    // AI (player 1) has already captured Q♠ + 10♥ + J♥ (15 pts) and nobody else
    // has points. Its remaining hand (low hearts, two clubs) no longer rates
    // viable, but it is committed (MOON_HAND_RULES.commitPoints = 13).
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsAlreadyWon = [c("spades", 12), c("hearts", 10), c("hearts", 11)];
    const hand = [...heartsInHand, c("clubs", 8), c("clubs", 7)]; // 10 cards
    const trick: TrickCard[] = [{ card: c("diamonds", 3), playerIndex: 0 }]; // AI void in diamonds
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 15, 0, 0],
      wonCards: [[], heartsAlreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt active: keep the hearts, discard the highest junk = 8♣.
    // (Outside moon mode a void Daring dumps a heart instead.)
    expect(pick).toEqual(c("clubs", 8));
  });

  it("does not attempt a moon late in the hand without top hearts or commitment", () => {
    // AI (player 1) has already won six low hearts (6 pts); holds 2♥ 3♥ + Q♠ + 7♦ (4 cards).
    // No top hearts held or captured, and 6 < commitPoints (13) → isMoonAttempt=false
    // (#2234) → adversarial fires → dumps Q♠.
    // trick.length=3 (we are last) so the adversarial Q♠ dump to seat 0 is position-guaranteed.
    const heartsInHand = [c("hearts", 2), c("hearts", 3)];
    const heartsAlreadyWon = Array.from({ length: 6 }, (_, i) => c("hearts", (i + 4) as Rank));
    const hand = [...heartsInHand, c("spades", 12), c("diamonds", 7)]; // 4 cards
    const trick: TrickCard[] = [
      { card: c("clubs", 13), playerIndex: 0 }, // seat 0 winning with K♣
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 4), playerIndex: 3 },
    ]; // AI void in clubs, last to play
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 9,
      currentPlayerIndex: 1,
      handScores: [0, 6, 0, 0],
      wonCards: [[], heartsAlreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Not in moon mode → adversarial targeting fires (seat 0 winning K♣) → dumps Q♠.
    expect(pick).toEqual(c("spades", 12));
  });

  it("maintains moon-attempt mode when Q♠ is already in wonCards (not in hand)", () => {
    // AI (player 1) has already won Q♠ + 5 hearts; still holds 8 hearts + 2 clubs.
    // handScores[1] = 18 (13+5) === totalPointsTaken = 18 → it holds every point
    // taken and ≥ commitPoints (13), so it is committed to the attempt (#2234).
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsWon = [
      c("hearts", 10),
      c("hearts", 11),
      c("hearts", 12),
      c("hearts", 13),
      c("hearts", 1),
    ];
    const alreadyWon = [c("spades", 12), ...heartsWon]; // Q♠ + 5 hearts
    const hand = [...heartsInHand, c("clubs", 7), c("clubs", 8)]; // 10 cards
    const trick: TrickCard[] = [{ card: c("diamonds", 3), playerIndex: 0 }]; // AI void in diamonds
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 18, 0, 0],
      wonCards: [[], alreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt active: void in diamonds → discard highest non-hearts/non-Q♠ = clubs 8
    expect(pick).toEqual(c("clubs", 8));
  });

  it("exits moon-attempt mode when another player also has points (split points)", () => {
    // AI has 8 hearts in hand + 2 won; opponent also has 2 points → aiHasAllPoints=false.
    // trick.length=3 (we are last) so adversarial Q♠ dump to seat 0 is position-guaranteed.
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsAlreadyWon = [c("hearts", 10), c("hearts", 11)];
    const hand = [...heartsInHand, c("spades", 12), c("clubs", 7)];
    const trick: TrickCard[] = [
      { card: c("diamonds", 13), playerIndex: 0 }, // seat 0 winning with K♦
      { card: c("diamonds", 3), playerIndex: 2 },
      { card: c("diamonds", 4), playerIndex: 3 },
    ]; // AI void in diamonds, last to play
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 2, 2, 0], // player 2 also has points — AI doesn't have all points
      wonCards: [[], heartsAlreadyWon, [c("hearts", 12), c("hearts", 13)], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Not in moon mode (split points) → adversarial targeting fires (seat 0 winning K♦) → dumps Q♠.
    expect(pick).toEqual(c("spades", 12));
  });
});
