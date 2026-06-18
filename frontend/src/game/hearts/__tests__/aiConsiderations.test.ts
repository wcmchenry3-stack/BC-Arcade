/**
 * Hearts consideration evaluator unit tests (#2030, story A6).
 *
 * Coverage:
 *   computePWin      — certain-to-win, following loses, P_win vs hand-computed
 *   rateMinimizeImmediatePoints
 *   rateSuitVoidingUtility
 *   rateQueenSpadesRisk
 *   rateMoonThreat
 *   rateMoonAttemptProgress
 *   ratePassingQuality
 *   Range invariants — all considerations return [0,1] on randomised states
 */

import {
  computePWin,
  rateMinimizeImmediatePoints,
  rateMoonAttemptProgress,
  rateMoonThreat,
  ratePassingQuality,
  rateQueenSpadesRisk,
  rateSuitVoidingUtility,
} from "../aiConsiderations";
import { buildHeartsInfoSet } from "../aiInfoSet";
import { createSeededRng, dealGame, getValidPlays, playCard, setRng } from "../engine";
import type { Card, HeartsState, Rank, Suit, TrickCard } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function tc(suit: Suit, rank: Rank, playerIndex: number): TrickCard {
  return { card: c(suit, rank), playerIndex };
}

function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "schemer",
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
    currentLeaderIndex: 0,
    currentPlayerIndex: 0,
    wonCards: [[], [], [], []],
    heartsBroken: false,
    tricksPlayedInHand: 1,
    isComplete: false,
    winnerIndex: null,
    knownVoids: [[], [], [], []],
    ...overrides,
  };
}

function mkInfo(
  hand: Card[],
  trick: TrickCard[],
  stateOverrides: Partial<HeartsState> = {},
  playerIndex = 0
) {
  return buildHeartsInfoSet(hand, trick, mkState(stateOverrides), playerIndex);
}

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// computePWin
// ---------------------------------------------------------------------------

describe("computePWin — certain-to-win invariant", () => {
  it("returns 1.0 when all higher cards in led suit are in seenKeys (following)", () => {
    // Holding K♠ (rank 13). Only A♠ is higher. A♠ is in seenKeys → P_win = 1.
    const seenCards = [c("spades", 1)]; // A♠ seen
    const wonCards = [[...seenCards], [], [], []];
    const trick = [tc("spades", 5, 3)]; // spades led
    const hand = [c("spades", 13)];
    const state = mkState({ wonCards, currentTrick: trick });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    expect(computePWin(c("spades", 13), info)).toBe(1.0);
  });

  it("returns 1.0 when Ace leads (nothing beats A)", () => {
    const hand = [c("hearts", 1)];
    const info = mkInfo(hand, []);
    expect(computePWin(c("hearts", 1), info)).toBe(1.0);
  });

  it("returns 0 when card is off-suit while following", () => {
    const trick = [tc("clubs", 5, 3)]; // clubs led
    const info = mkInfo([c("hearts", 1)], trick, { currentTrick: trick });
    expect(computePWin(c("hearts", 1), info)).toBe(0);
  });

  it("returns 0 when card already beaten by current trick winner", () => {
    const trick = [tc("spades", 10, 3)]; // 10♠ winning
    const info = mkInfo([c("spades", 7)], trick, { currentTrick: trick });
    expect(computePWin(c("spades", 7), info)).toBe(0); // 7 < 10
  });

  it("returns value between 0 and 1 when some (not all) higher cards outstanding", () => {
    // 9♣ following 3♣ lead. Higher clubs: T,J,Q,K,A = 5 cards max (maxHigher=14-9=5).
    // Put 3 of them in seenKeys (collected), leaving 2 outstanding.
    // P_win = 1 - 2/5 = 0.6 — between 0 and 1.
    const trick = [tc("clubs", 3, 3)];
    const won = [[c("clubs", 10), c("clubs", 11), c("clubs", 12)], [], [], []]; // T,J,Q gone
    const hand = [c("clubs", 9)];
    const state = mkState({ wonCards: won, currentTrick: trick });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const p = computePWin(c("clubs", 9), info);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it("void-ledger bonus: known-void opponents raise P_win when leading", () => {
    // Leading 9♦ — some higher diamonds outstanding, but all opponents known void in diamonds
    const hand = [c("diamonds", 9)];
    const info = buildHeartsInfoSet(
      hand,
      [],
      mkState({
        knownVoids: [[], ["diamonds"], ["diamonds"], ["diamonds"]],
      }),
      0
    );
    const pWithVoids = computePWin(c("diamonds", 9), info);

    // Without voids
    const infoNoVoids = mkInfo(hand, []);
    const pNoVoids = computePWin(c("diamonds", 9), infoNoVoids);

    expect(pWithVoids).toBeGreaterThanOrEqual(pNoVoids);
  });
});

// ---------------------------------------------------------------------------
// rateMinimizeImmediatePoints
// ---------------------------------------------------------------------------

describe("rateMinimizeImmediatePoints", () => {
  it("returns 1.0 when the card cannot win the trick (off-suit discard)", () => {
    const trick = [tc("clubs", 5, 3)];
    // Discarding A♥ — void in clubs — cannot win
    const info = mkInfo([c("hearts", 1)], trick, { currentTrick: trick });
    expect(rateMinimizeImmediatePoints(info, c("hearts", 1))).toBe(1.0);
  });

  it("returns 1.0 when the trick contains zero points", () => {
    // Trick with only non-point cards; leading a non-point card
    const trick = [tc("clubs", 5, 3), tc("clubs", 7, 1)];
    const hand = [c("clubs", 9)];
    const info = mkInfo(hand, trick, { currentTrick: trick });
    // No points in the trick, card has 0 points
    expect(rateMinimizeImmediatePoints(info, c("clubs", 9))).toBe(1.0);
  });

  it("returns < 1.0 when card would likely win a trick with hearts", () => {
    // A♥ leads; opponent played 2♥; we follow with K♥ — high chance of winning 2 pts
    const trick = [tc("hearts", 2, 3), tc("hearts", 5, 1)];
    const hand = [c("hearts", 13)]; // K♥
    // Seed known-voids so A♥ is in seenKeys (A♥ already played → K♥ becomes top)
    const won = [[c("hearts", 1)], [], [], []];
    const state = mkState({ wonCards: won, currentTrick: trick, heartsBroken: true });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const score = rateMinimizeImmediatePoints(info, c("hearts", 13));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });

  it("returns a lower score for Q♠ certain to win than for a 2♠ that loses", () => {
    // 3♠ led. K♠ and A♠ are both in seenKeys, so Q♠ (rank 12) is the highest
    // outstanding spade and will win. 2♠ is beaten by the current 3♠ → P_win=0.
    const trick = [tc("spades", 3, 3)];
    const won = [[c("spades", 1), c("spades", 13)], [], [], []]; // A♠, K♠ gone
    const hand = [c("spades", 12), c("spades", 2)];
    const state = mkState({ wonCards: won, currentTrick: trick });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const qScore = rateMinimizeImmediatePoints(info, c("spades", 12)); // certain win, 13 pts
    const lowScore = rateMinimizeImmediatePoints(info, c("spades", 2)); // P_win=0 → score=1.0
    expect(qScore).toBeLessThan(lowScore);
  });
});

// ---------------------------------------------------------------------------
// rateSuitVoidingUtility
// ---------------------------------------------------------------------------

describe("rateSuitVoidingUtility", () => {
  it("returns 1.0 when playing the card creates an immediate void", () => {
    const hand = [c("diamonds", 7)]; // only diamond
    const info = mkInfo(hand, []);
    expect(rateSuitVoidingUtility(info, c("diamonds", 7))).toBe(1.0);
  });

  it("returns ~0.67 with 2 cards remaining in suit", () => {
    const hand = [c("diamonds", 7), c("diamonds", 9)];
    const info = mkInfo(hand, []);
    expect(rateSuitVoidingUtility(info, c("diamonds", 7))).toBeCloseTo(0.667, 2);
  });

  it("returns 0.33 with 3 cards remaining in suit", () => {
    const hand = [c("diamonds", 5), c("diamonds", 7), c("diamonds", 9)];
    const info = mkInfo(hand, []);
    expect(rateSuitVoidingUtility(info, c("diamonds", 5))).toBeCloseTo(0.333, 2);
  });

  it("returns 0 with 4+ cards remaining in suit", () => {
    const hand = [c("clubs", 6), c("clubs", 7), c("clubs", 8), c("clubs", 9)];
    const info = mkInfo(hand, []);
    expect(rateSuitVoidingUtility(info, c("clubs", 6))).toBe(0);
  });

  it("a singleton produces higher void utility than a doubleton", () => {
    const handSingle = [c("spades", 5)];
    const handDouble = [c("spades", 5), c("spades", 7)];
    const infoS = mkInfo(handSingle, []);
    const infoD = mkInfo(handDouble, []);
    expect(rateSuitVoidingUtility(infoS, c("spades", 5))).toBeGreaterThan(
      rateSuitVoidingUtility(infoD, c("spades", 5))
    );
  });
});

// ---------------------------------------------------------------------------
// rateQueenSpadesRisk
// ---------------------------------------------------------------------------

describe("rateQueenSpadesRisk", () => {
  it("returns 1.0 when Q♠ is already gone (in seenKeys)", () => {
    const won = [[c("spades", 12)], [], [], []];
    const info = mkInfo([c("hearts", 5)], [], { wonCards: won });
    expect(rateQueenSpadesRisk(info, c("hearts", 5))).toBe(1.0);
  });

  it("returns 1.0 for Q♠ as off-suit void discard (safe dump)", () => {
    // Clubs led; we're void in clubs; discarding Q♠ safely
    const trick = [tc("clubs", 5, 3)];
    const hand = [c("spades", 12)];
    const info = mkInfo(hand, trick, { currentTrick: trick });
    expect(rateQueenSpadesRisk(info, c("spades", 12))).toBe(1.0);
  });

  it("returns very low for leading Q♠ (near-certain self-take)", () => {
    const hand = [c("spades", 12), c("spades", 3)];
    const info = mkInfo(hand, []);
    expect(rateQueenSpadesRisk(info, c("spades", 12))).toBeLessThanOrEqual(0.1);
  });

  it("score for Q♠ following spades: inversely proportional to win chance", () => {
    // Spades led; A♠ and K♠ already seen → Q♠ wins the trick (highest remaining)
    const trick = [tc("spades", 5, 3)];
    const won = [[c("spades", 1), c("spades", 13)], [], [], []]; // A♠,K♠ gone
    const hand = [c("spades", 12)];
    const state = mkState({ wonCards: won, currentTrick: trick });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    // Q♠ will win (nothing higher outstanding) → high self-take risk → low score
    expect(rateQueenSpadesRisk(info, c("spades", 12))).toBeLessThan(0.2);
  });

  it("returns low when winning a trick containing Q♠", () => {
    // Q♠ is in the trick; we're following with a high spade that beats it
    const trick = [tc("spades", 3, 3), tc("spades", 12, 1)]; // Q♠ played by P1
    const hand = [c("spades", 1)]; // A♠ will win this trick
    const info = mkInfo(hand, trick, { currentTrick: trick });
    const score = rateQueenSpadesRisk(info, c("spades", 1));
    expect(score).toBeLessThan(0.5);
  });

  it("penalises leading A♠/K♠ while holding Q♠", () => {
    const hand = [c("spades", 12), c("spades", 1), c("spades", 13)];
    const info = mkInfo(hand, []);
    const aScore = rateQueenSpadesRisk(info, c("spades", 1));
    const kScore = rateQueenSpadesRisk(info, c("spades", 13));
    // Leading cover cards while holding Q♠ should score poorly
    expect(aScore).toBeLessThan(0.5);
    expect(kScore).toBeLessThan(0.5);
  });

  it("returns 0.5 for leading a lower spade while holding Q♠", () => {
    // 6♠ is not a cover card — leading it while holding Q♠ is risky but not catastrophic
    const hand = [c("spades", 12), c("spades", 6)];
    const info = mkInfo(hand, []);
    expect(rateQueenSpadesRisk(info, c("spades", 6))).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// rateMoonThreat
// ---------------------------------------------------------------------------

describe("rateMoonThreat", () => {
  it("returns 0.5 when there is no moon threat (no points taken)", () => {
    const info = mkInfo([c("clubs", 5)], []);
    expect(rateMoonThreat(info, c("clubs", 5))).toBe(0.5);
  });

  it("returns 0.5 when points are spread across multiple players", () => {
    const state = mkState({ handScores: [5, 3, 0, 0] });
    const info = buildHeartsInfoSet([c("clubs", 5)], [], state, 0);
    expect(rateMoonThreat(info, c("clubs", 5))).toBe(0.5);
  });

  it("returns > 0.5 for off-suit point dump onto shooter's trick", () => {
    // P1 has all 6 points (moon threat). We're void in clubs, discarding Q♠.
    const trick = [tc("clubs", 5, 1)]; // shooter is winning
    const hand = [c("spades", 12)]; // Q♠ to dump
    const state = mkState({
      handScores: [0, 6, 0, 0],
      currentTrick: trick,
    });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const score = rateMoonThreat(info, c("spades", 12)); // off-suit Q♠ dump
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns < 0.5 for leading hearts during a moon threat (feeds the shooter)", () => {
    const hand = [c("hearts", 10)];
    const state = mkState({ handScores: [0, 6, 0, 0] });
    const info = buildHeartsInfoSet(hand, [], state, 0);
    expect(rateMoonThreat(info, c("hearts", 10))).toBeLessThan(0.5);
  });

  it("Q♠ dump scores higher than a single heart dump", () => {
    const trick = [tc("clubs", 5, 1)]; // shooter winning
    const hand = [c("spades", 12), c("hearts", 3)];
    const state = mkState({ handScores: [0, 4, 0, 0], currentTrick: trick });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const qScore = rateMoonThreat(info, c("spades", 12));
    const hScore = rateMoonThreat(info, c("hearts", 3));
    expect(qScore).toBeGreaterThan(hScore);
  });

  it("does not misidentify self as threat (uses playerIndex)", () => {
    // We (P0) have all points — we're not a threat to ourselves
    const state = mkState({ handScores: [6, 0, 0, 0] });
    const info = buildHeartsInfoSet([c("clubs", 5)], [], state, 0);
    expect(rateMoonThreat(info, c("clubs", 5))).toBe(0.5); // no opponent threat
  });

  it("following in-suit point card that probably loses scores near 0.95", () => {
    // Hearts led. We have K♥ (rank 13, ace-high=13). A♥ is in seenKeys → K♥ is top.
    // P_win = 1.0 → score = 0.5 + (1 - 1.0) * 0.45 = 0.5. That's not right for this case.
    // Actually we want: following in-suit point card that LOSES (low pWin) → score near 0.5+0.45=0.95.
    // Use 2♥ following a hearts trick where K♥ is already winning — 2♥ cannot win.
    const trick = [tc("hearts", 13, 3)]; // K♥ leading / winning
    const hand = [c("hearts", 2)]; // 2♥ cannot beat K♥
    const state = mkState({ handScores: [0, 6, 0, 0], currentTrick: trick, heartsBroken: true });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    // 2♥: pWin=0 (beaten by K♥) → score = 0.5 + (1-0)*0.45 = 0.95
    const score = rateMoonThreat(info, c("hearts", 2));
    expect(score).toBeCloseTo(0.95, 2);
  });
});

// ---------------------------------------------------------------------------
// rateMoonAttemptProgress
// ---------------------------------------------------------------------------

describe("rateMoonAttemptProgress", () => {
  it("returns 0.9 for dumping junk (non-point) when void", () => {
    const trick = [tc("clubs", 5, 1)]; // clubs led
    const hand = [c("diamonds", 3)]; // void in clubs, diamond discard
    const info = mkInfo(hand, trick, { currentTrick: trick });
    expect(rateMoonAttemptProgress(info, c("diamonds", 3))).toBeCloseTo(0.9, 5);
  });

  it("returns ~0.05 for discarding a heart when void (fatal for moon run)", () => {
    const trick = [tc("clubs", 5, 1)];
    const hand = [c("hearts", 7)];
    const info = mkInfo(hand, trick, { currentTrick: trick });
    expect(rateMoonAttemptProgress(info, c("hearts", 7))).toBeCloseTo(0.05, 5);
  });

  it("scores following in-suit point card proportional to P_win", () => {
    // Hearts led; we have A♥. A♥ (rank=1, ace-high=14) is the highest card in
    // any suit — nothing beats it → P_win = 1.0 → score = 1 * 0.95 = 0.95
    const trick = [tc("hearts", 3, 3)];
    const hand = [c("hearts", 1)];
    const state = mkState({ wonCards: [[], [], [], []], currentTrick: trick, heartsBroken: true });
    const info = buildHeartsInfoSet(hand, trick, state, 0);
    const score = rateMoonAttemptProgress(info, c("hearts", 1));
    expect(score).toBeCloseTo(0.95, 2);
  });

  it("non-heart lead: higher P_win yields higher score", () => {
    // Leading 2♣ (low, many higher outstanding) vs A♣ (certain win)
    const hand2 = [c("clubs", 2)];
    const handA = [c("clubs", 1)];
    const info2 = mkInfo(hand2, []);
    const infoA = mkInfo(handA, []);
    const s2 = rateMoonAttemptProgress(info2, c("clubs", 2));
    const sA = rateMoonAttemptProgress(infoA, c("clubs", 1));
    expect(sA).toBeGreaterThan(s2);
  });
});

// ---------------------------------------------------------------------------
// ratePassingQuality
// ---------------------------------------------------------------------------

describe("ratePassingQuality", () => {
  it("returns 0.0 for 2♣ (must never be passed)", () => {
    const info = mkInfo([c("clubs", 2), c("clubs", 5)], []);
    expect(ratePassingQuality(info, c("clubs", 2))).toBe(0.0);
  });

  it("returns 0.9 for A♥ (always wins heart tricks)", () => {
    const info = mkInfo([c("hearts", 1)], []);
    expect(ratePassingQuality(info, c("hearts", 1))).toBe(0.9);
  });

  it("danger hearts descend: A♥ > K♥ > Q♥ > J♥", () => {
    const hand = [c("hearts", 1), c("hearts", 13), c("hearts", 12), c("hearts", 11)];
    const info = mkInfo(hand, []);
    const [aH, kH, qH, jH] = hand.map((cd) => ratePassingQuality(info, cd));
    expect(aH).toBeGreaterThan(kH!);
    expect(kH!).toBeGreaterThan(qH!);
    expect(qH!).toBeGreaterThan(jH!);
  });

  it("Q♠ scores high when passing right (no protection needed)", () => {
    const hand = [c("spades", 12), c("spades", 1), c("spades", 13)];
    const state = mkState({ passDirection: "right" });
    const info = buildHeartsInfoSet(hand, [], state, 0);
    expect(ratePassingQuality(info, c("spades", 12))).toBeGreaterThan(0.9);
  });

  it("Q♠ scores low when passing left and holding A♠ + K♠ (fully protected)", () => {
    const hand = [c("spades", 12), c("spades", 1), c("spades", 13)];
    const state = mkState({ passDirection: "left" });
    const info = buildHeartsInfoSet(hand, [], state, 0);
    // left + A♠ cover → protected → should not pass Q♠
    expect(ratePassingQuality(info, c("spades", 12))).toBeLessThan(0.3);
  });

  it("K♠ scores low when holding Q♠ (needed as cover)", () => {
    const hand = [c("spades", 12), c("spades", 13)];
    const info = mkInfo(hand, []);
    expect(ratePassingQuality(info, c("spades", 13))).toBeLessThan(0.3);
  });

  it("K♠ scores moderately high without Q♠ in hand", () => {
    const hand = [c("spades", 13), c("clubs", 5)];
    const info = mkInfo(hand, []);
    expect(ratePassingQuality(info, c("spades", 13))).toBeGreaterThan(0.5);
  });

  it("10♥ scores higher when passing right vs left", () => {
    const hand = [c("hearts", 10)];
    const stateRight = mkState({ passDirection: "right" });
    const stateLeft = mkState({ passDirection: "left" });
    const infoR = buildHeartsInfoSet(hand, [], stateRight, 0);
    const infoL = buildHeartsInfoSet(hand, [], stateLeft, 0);
    expect(ratePassingQuality(infoR, c("hearts", 10))).toBeGreaterThan(
      ratePassingQuality(infoL, c("hearts", 10))
    );
  });

  it("A♣/K♣ score higher than low clubs (danger early cycle)", () => {
    const hand = [c("clubs", 1), c("clubs", 13), c("clubs", 6)];
    const info = mkInfo(hand, []);
    const aScore = ratePassingQuality(info, c("clubs", 1));
    const kScore = ratePassingQuality(info, c("clubs", 13));
    const lowScore = ratePassingQuality(info, c("clubs", 6));
    expect(aScore).toBeGreaterThan(lowScore);
    expect(kScore).toBeGreaterThan(lowScore);
  });

  it("Q♠ with passDirection=none: protected only when holding both A♠ and K♠", () => {
    const handBoth = [c("spades", 12), c("spades", 1), c("spades", 13)];
    const handOne = [c("spades", 12), c("spades", 1)]; // A♠ but no K♠
    const stateNone = mkState({ passDirection: "none" });
    const infoBoth = buildHeartsInfoSet(handBoth, [], stateNone, 0);
    const infoOne = buildHeartsInfoSet(handOne, [], stateNone, 0);
    // With both covers: fullyProtected=true → low score (keep Q♠)
    expect(ratePassingQuality(infoBoth, c("spades", 12))).toBeLessThan(0.3);
    // With only A♠: fullyProtected=false → high score (pass Q♠)
    expect(ratePassingQuality(infoOne, c("spades", 12))).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// Range invariants — all considerations must return [0, 1] on arbitrary states
// ---------------------------------------------------------------------------

describe("Range invariants — all considerations in [0, 1]", () => {
  const CONSIDERATIONS = [
    rateMinimizeImmediatePoints,
    rateSuitVoidingUtility,
    rateQueenSpadesRisk,
    rateMoonThreat,
    rateMoonAttemptProgress,
    ratePassingQuality,
  ] as const;

  it("all return [0,1] for every valid play in 30 seeded games", () => {
    for (let seed = 0; seed < 30; seed++) {
      setRng(createSeededRng(seed));
      let state = dealGame();

      // Fast-forward to trick 3 (past first-trick restrictions) by playing first tricks
      for (let t = 0; t < 3; t++) {
        for (let p = 0; p < 4; p++) {
          const player = state.currentPlayerIndex;
          const valid = getValidPlays(state, player);
          if (valid.length === 0) break;
          state = playCard(state, player, valid[0]!);
          if (state.phase !== "playing") break;
        }
        if (state.phase !== "playing") break;
      }

      if (state.phase !== "playing") continue;

      const player = state.currentPlayerIndex;
      const hand = state.playerHands[player] ?? [];
      const trick = state.currentTrick;
      const info = buildHeartsInfoSet([...hand], [...trick], state, player);
      const valid = getValidPlays(state, player);

      for (const card of valid) {
        for (const fn of CONSIDERATIONS) {
          const score = fn(info, card);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
