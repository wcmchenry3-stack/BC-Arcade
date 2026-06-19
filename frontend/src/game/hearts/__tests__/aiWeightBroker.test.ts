/**
 * Hearts utility AI — weight broker + decision selector (GH #2031, story A7).
 *
 * Validates four properties:
 * 1. Legality — every play and pass decision is a legal action.
 * 2. Moon-attempt activation parity — earlyMoon/midMoon thresholds match rule-based code.
 * 3. Noise determinism — same seed → same decisions; Daring → zero noise deviations.
 * 4. Pass correctness — always 3 cards, never 2♣, all cards from the hand.
 */

import { selectCardToPlayUtility, selectCardsToPassUtility } from "../ai";
import {
  commitPass,
  createSeededRng,
  dealGame,
  getValidPlays,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import type { Card, HeartsState, Rank, Suit, TrickCard } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "daring",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands: [[], [], [], []],
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: [],
    currentLeaderIndex: 1,
    currentPlayerIndex: 1,
    wonCards: [[], [], [], []],
    heartsBroken: true,
    tricksPlayedInHand: 1,
    isComplete: false,
    winnerIndex: null,
    knownVoids: [[], [], [], []],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Legality
// ---------------------------------------------------------------------------

describe("Utility AI — decision legality", () => {
  const PERSONAS = ["cautious", "schemer", "daring"] as const;

  afterEach(() => setRng(Math.random));

  it("selectCardToPlayUtility always returns a card from getValidPlays", () => {
    // Scripted hand covering: leading, following, voiding
    const hand = [
      c("spades", 12), // Q♠
      c("hearts", 1),
      c("hearts", 13),
      c("diamonds", 3),
      c("clubs", 7),
    ];
    for (const persona of PERSONAS) {
      for (const seed of [1, 42, 999]) {
        setRng(createSeededRng(seed));
        // Leading scenario
        const leadState = mkState({
          playerHands: [[], hand, [], []],
          currentTrick: [],
          currentPlayerIndex: 1,
          currentLeaderIndex: 1,
        });
        const leadCard = selectCardToPlayUtility(hand, [], leadState, 1, persona);
        expect(getValidPlays(leadState, 1)).toContainEqual(leadCard);

        // Following — player 1 void in clubs (led suit), can discard anything
        const followState = mkState({
          playerHands: [[], hand, [], []],
          currentTrick: [{ card: c("clubs", 3), playerIndex: 0 }],
          currentPlayerIndex: 1,
          currentLeaderIndex: 0,
        });
        const followCard = selectCardToPlayUtility(
          hand,
          followState.currentTrick as TrickCard[],
          followState,
          1,
          persona
        );
        expect(getValidPlays(followState, 1)).toContainEqual(followCard);
      }
    }
  });

  it("selectCardToPlayUtility follows in-suit when not void", () => {
    // Player 1 holds clubs and non-clubs; clubs are led → must return a club.
    const hand = [c("clubs", 4), c("clubs", 9), c("hearts", 7), c("diamonds", 5)];
    for (const persona of PERSONAS) {
      for (const seed of [1, 42, 999]) {
        setRng(createSeededRng(seed));
        const state = mkState({
          playerHands: [[], hand, [], []],
          currentTrick: [{ card: c("clubs", 3), playerIndex: 0 }],
          currentPlayerIndex: 1,
          currentLeaderIndex: 0,
          heartsBroken: true,
          tricksPlayedInHand: 5,
        });
        const card = selectCardToPlayUtility(
          hand,
          state.currentTrick as TrickCard[],
          state,
          1,
          persona
        );
        const valid = getValidPlays(state, 1);
        expect(valid).toContainEqual(card);
        expect(card.suit).toBe("clubs");
      }
    }
  });

  it("full-game legality sweep: every play is legal across a seeded 13-trick hand", () => {
    // Deal a real hand via the engine, complete the pass phase with simple selections,
    // then simulate all AI players (seats 1-3) using selectCardToPlayUtility for each
    // of their turns. The test only asserts that every returned card is in getValidPlays.
    setRng(createSeededRng(77));
    let state = dealGame("daring");

    if (state.phase === "passing") {
      for (let p = 0; p < 4; p++) {
        const pHand = state.playerHands[p] ?? [];
        const eligibleCards = pHand.filter((card) => !(card.suit === "clubs" && card.rank === 2));
        for (let i = 0; i < 3 && i < eligibleCards.length; i++) {
          state = selectPassCard(state, p, eligibleCards[i]!);
        }
      }
      state = commitPass(state);
    }

    while (!state.isComplete && state.phase === "playing") {
      const pi = state.currentPlayerIndex;
      const pHand = state.playerHands[pi] ?? [];
      const trick = state.currentTrick as TrickCard[];
      const valid = getValidPlays(state, pi);

      let chosen: Card;
      if (pi === 0) {
        chosen = valid[0]!;
      } else {
        chosen = selectCardToPlayUtility(pHand, trick, state, pi, "daring");
      }

      expect(valid).toContainEqual(chosen);
      state = playCard(state, pi, chosen);
    }
  });

  it("selectCardsToPassUtility always returns exactly 3 cards from the hand", () => {
    const hand = [
      c("spades", 1),
      c("spades", 12),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("clubs", 7),
      c("diamonds", 5),
      c("diamonds", 9),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 3),
      c("hearts", 5),
    ];
    for (const persona of PERSONAS) {
      for (const direction of ["left", "right", "across", "none"] as const) {
        for (const seed of [1, 42]) {
          setRng(createSeededRng(seed));
          const result = selectCardsToPassUtility(hand, direction, persona, 1);
          expect(result).toHaveLength(3);
          for (const card of result) {
            expect(hand).toContainEqual(card);
          }
        }
      }
    }
  });

  it("selectCardsToPassUtility never passes 2♣", () => {
    const hand = [
      c("clubs", 2),
      c("clubs", 3),
      c("clubs", 4),
      c("clubs", 5),
      c("clubs", 6),
      c("clubs", 7),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
      c("diamonds", 2),
      c("diamonds", 3),
      c("spades", 2),
      c("spades", 3),
    ];
    for (const persona of PERSONAS) {
      setRng(createSeededRng(7));
      const result = selectCardsToPassUtility(hand, "left", persona, 1);
      expect(result).not.toContainEqual(c("clubs", 2));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Moon-attempt activation parity
// ---------------------------------------------------------------------------

describe("Utility AI — moon-attempt activation (calibration-drift guard)", () => {
  afterEach(() => setRng(Math.random));

  beforeEach(() => setRng(() => 0.99)); // suppress noise

  it("earlyMoon: leads highest non-heart for trick control", () => {
    // 7 hearts + Q♠ + A♣ + 2♦ in hand — earlyMoon condition fires
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9),
      c("hearts", 8), // 7 hearts
      c("spades", 12), // Q♠
      c("clubs", 1), // A♣ — highest non-heart, should be led for trick control
      c("diamonds", 2),
    ];
    // hand.length = 10 ≥ 8, heartsInHand = 7 ≥ 7, myHasQ = true, heartsWon = 0
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      currentPlayerIndex: 1,
      currentLeaderIndex: 1,
      wonCards: [[], [], [], []],
      handScores: [0, 0, 0, 0],
      heartsBroken: true,
      tricksPlayedInHand: 2,
    });

    const card = selectCardToPlayUtility(hand, [], state, 1, "daring");
    // Moon-attempt mode: lead highest non-heart → A♣ (not 2♦, not hearts, not Q♠)
    expect(card).toEqual(c("clubs", 1));
  });

  it("earlyMoon: discards junk non-point card when void in led suit (keeps Q♠)", () => {
    // 7 hearts + Q♠ + 2♦ in hand, void in clubs (led suit)
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9),
      c("hearts", 8),
      c("spades", 12),
      c("diamonds", 2),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [{ card: c("clubs", 3), playerIndex: 0 }],
      currentPlayerIndex: 1,
      currentLeaderIndex: 0,
      wonCards: [[], [], [], []],
      handScores: [0, 0, 0, 0],
      heartsBroken: true,
      tricksPlayedInHand: 2,
    });

    const card = selectCardToPlayUtility(
      hand,
      state.currentTrick as TrickCard[],
      state,
      1,
      "daring"
    );
    // Moon-attempt mode with void: dump 2♦ (junk), NOT Q♠ or any heart
    expect(card).toEqual(c("diamonds", 2));
    expect(card).not.toEqual(c("spades", 12));
  });

  it("midMoon/earlyMoon: neither fires when heartsInHand < 7 and another player holds points", () => {
    // 6 hearts (< 7 → earlyMoon off). midMoon requires myPoints === totalPointsTaken;
    // setting handScores so the human (seat 0) holds all current points breaks midMoon
    // for player 1 (myPoints=0 ≠ totalPointsTaken=3). Falls back to normal Daring weights.
    // Hand has no clubs so player 1 is void in the clubs-led trick.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9), // 6 hearts
      c("spades", 12), // Q♠
      c("diamonds", 4), // non-point discard option
      c("diamonds", 2), // non-point discard option
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [{ card: c("clubs", 3), playerIndex: 0 }],
      currentPlayerIndex: 1,
      currentLeaderIndex: 0,
      wonCards: [[c("hearts", 2), c("hearts", 3), c("hearts", 4)], [], [], []],
      handScores: [3, 0, 0, 0], // seat 0 holds all 3 pts → player 1 midMoon = false
      heartsBroken: true,
      tricksPlayedInHand: 2,
    });

    const card = selectCardToPlayUtility(
      hand,
      state.currentTrick as TrickCard[],
      state,
      1,
      "daring"
    );
    // Normal Daring: void in clubs → dump Q♠ (rateQueenSpadesRisk = 1.0 for off-suit Q♠
    // dump vs 0.8 for other discards while holding Q♠, giving Q♠ the highest score)
    expect(card).toEqual(c("spades", 12));
  });

  it("endgame mode (Daring, ≥65 pts): dumps Q♠ on score-leader's winning trick when void", () => {
    // Seat 2 has 70 cumulative pts → inEndgame=true. Player 1 is void in clubs
    // (led by seat 0); seat 2 is winning with 10♣. Daring should dump Q♠.
    const hand = [
      c("spades", 12), // Q♠ — adversarial endgame dump target
      c("hearts", 5),
      c("diamonds", 6),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [
        { card: c("clubs", 3), playerIndex: 0 },
        { card: c("clubs", 10), playerIndex: 2 }, // seat 2 winning
      ],
      currentPlayerIndex: 1,
      currentLeaderIndex: 0,
      cumulativeScores: [10, 5, 70, 15], // seat 2 at 70 → endgame
      handScores: [0, 0, 0, 0],
      heartsBroken: true,
      tricksPlayedInHand: 5,
    });

    setRng(() => 0.99); // suppress noise
    const card = selectCardToPlayUtility(
      hand,
      state.currentTrick as TrickCard[],
      state,
      1,
      "daring"
    );
    // Endgame weights elevate queenSpadesRisk (2.5), so Q♠ (rateQueenSpadesRisk=1.0)
    // outscores 5♥/6♦ (rateQueenSpadesRisk=0.8 while holding Q♠).
    expect(card).toEqual(c("spades", 12));
  });

  it("adversarial mode (Daring): dumps Q♠ on seat-0's winning trick when void", () => {
    // Seat 0 is winning a hearts trick; player 2 is void in hearts.
    // No endgame (maxScore=25 < 65), no moon attempt → adversarial mode fires.
    const hand = [
      c("spades", 12), // Q♠
      c("diamonds", 6),
      c("clubs", 8),
    ];
    const state = mkState({
      playerHands: [[], [], hand, []],
      currentTrick: [
        { card: c("hearts", 5), playerIndex: 0 }, // seat 0 led
        { card: c("hearts", 3), playerIndex: 1 }, // seat 1 follows (seat 0 still winning)
        // player 2 (void in hearts) is next
      ],
      currentPlayerIndex: 2,
      currentLeaderIndex: 0,
      cumulativeScores: [10, 20, 15, 25], // maxScore=25 — not endgame
      handScores: [0, 0, 0, 0],
      heartsBroken: true,
      tricksPlayedInHand: 5,
    });

    setRng(() => 0.99); // suppress noise
    const card = selectCardToPlayUtility(
      hand,
      state.currentTrick as TrickCard[],
      state,
      2,
      "daring"
    );
    // Adversarial weights: queenSpadesRisk=5.0 → Q♠ score 7.0 vs 6♦/8♣ score 6.0.
    expect(card).toEqual(c("spades", 12));
  });

  it("moon-viable pass: does not pass Q♠ or A♥ when 6+ hearts in hand", () => {
    // moonViable = heartsInHand ≥ 6 && hasQSpades. Use direction "across" for player 1
    // so that passingToSeat0(1, "across") → (1+2)%4=3 ≠ 0 → not targeting human,
    // ensuring moon-viable mode activates.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9), // 6 hearts
      c("spades", 12), // Q♠
      c("diamonds", 3),
      c("diamonds", 4),
      c("diamonds", 5),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
    ];
    const result = selectCardsToPassUtility(hand, "across", "daring", 1);
    expect(result).toHaveLength(3);
    // Moon-viable: keep Q♠ and all hearts
    expect(result).not.toContainEqual(c("spades", 12));
    expect(result).not.toContainEqual(c("hearts", 1));
    // Should pass lowest eligible non-hearts
    const resultSuits = result.map((card) => card.suit);
    expect(resultSuits.every((s) => s !== "hearts")).toBe(true);
  });

  it("moon-viable pass: fires for Daring but NOT for Schemer", () => {
    // Same hand passed by player 1 going "across" (offset=2, seat (1+2)%4=3 ≠ 0 → not
    // targeting seat 0, so moon-viable activates for Daring).
    // Schemer has no moon-viable mode and should pass Q♠ (unprotected going across).
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9),
      c("spades", 12),
      c("diamonds", 3),
      c("diamonds", 4),
      c("diamonds", 5),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
    ];

    const daringResult = selectCardsToPassUtility(hand, "across", "daring", 1);
    expect(daringResult).not.toContainEqual(c("spades", 12)); // moon-viable: keep Q♠

    const schemerResult = selectCardsToPassUtility(hand, "across", "schemer", 1);
    expect(schemerResult).toContainEqual(c("spades", 12)); // Schemer passes Q♠ going across
  });
});

// ---------------------------------------------------------------------------
// 3. Noise determinism
// ---------------------------------------------------------------------------

describe("Utility AI — noise determinism", () => {
  afterEach(() => setRng(Math.random));

  const hand = [
    c("spades", 3),
    c("spades", 7),
    c("hearts", 2),
    c("hearts", 6),
    c("diamonds", 4),
    c("diamonds", 8),
    c("clubs", 5),
    c("clubs", 9),
    c("clubs", 10),
    c("clubs", 11),
    c("diamonds", 10),
    c("diamonds", 11),
    c("diamonds", 12),
  ];

  it("same seed → identical play decisions — cautious", () => {
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      currentPlayerIndex: 1,
      currentLeaderIndex: 1,
      heartsBroken: false,
    });
    setRng(createSeededRng(42));
    const a = selectCardToPlayUtility(hand, [], state, 1, "cautious");
    setRng(createSeededRng(42));
    const b = selectCardToPlayUtility(hand, [], state, 1, "cautious");
    expect(a).toEqual(b);
  });

  it("same seed → identical play decisions — schemer", () => {
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      currentPlayerIndex: 1,
      currentLeaderIndex: 1,
      heartsBroken: true,
    });
    setRng(createSeededRng(100));
    const a = selectCardToPlayUtility(hand, [], state, 1, "schemer");
    setRng(createSeededRng(100));
    const b = selectCardToPlayUtility(hand, [], state, 1, "schemer");
    expect(a).toEqual(b);
  });

  it("same seed → identical pass decisions — schemer", () => {
    setRng(createSeededRng(200));
    const a = selectCardsToPassUtility(hand, "left", "schemer", 1);
    setRng(createSeededRng(200));
    const b = selectCardsToPassUtility(hand, "left", "schemer", 1);
    expect(a).toEqual(b);
  });

  it("Daring produces zero noise deviations on play", () => {
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      currentPlayerIndex: 1,
      currentLeaderIndex: 1,
      heartsBroken: true,
    });
    // Two very different seeds — Daring ignores the RNG, so decisions must match
    setRng(createSeededRng(1));
    const a = selectCardToPlayUtility(hand, [], state, 1, "daring");
    setRng(createSeededRng(9999));
    const b = selectCardToPlayUtility(hand, [], state, 1, "daring");
    expect(a).toEqual(b);
  });

  it("Daring produces zero noise deviations on pass", () => {
    setRng(createSeededRng(1));
    const a = selectCardsToPassUtility(hand, "right", "daring", 1);
    setRng(createSeededRng(9999));
    const b = selectCardsToPassUtility(hand, "right", "daring", 1);
    expect(a).toEqual(b);
  });

  it("different seeds produce different play decisions for cautious (probabilistic)", () => {
    // With 25% noise, two different seeds should differ across many calls.
    // Run 20 decisions with each seed; at least one should differ.
    // Theoretical false-failure probability: ≈ (1/5)^20 ≈ 10^-14 — practically impossible.
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      currentPlayerIndex: 1,
      currentLeaderIndex: 1,
      heartsBroken: true,
    });
    const collectN = (seed: number): Card[] => {
      setRng(createSeededRng(seed));
      return Array.from({ length: 20 }, () =>
        selectCardToPlayUtility(hand, [], state, 1, "cautious")
      );
    };
    const a = collectN(1);
    const b = collectN(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
