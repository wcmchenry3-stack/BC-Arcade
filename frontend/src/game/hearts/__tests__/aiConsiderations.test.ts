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
  MOON_DEFENSE,
  rateMoonThreat,
  ratePassingQuality,
  rateQueenSpadesRisk,
  rateSuitVoidingUtility,
  rateTactics,
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
// computePWin — pass-memory refinement (#2237)
// ---------------------------------------------------------------------------

describe("computePWin — pass-memory refinement (#2237)", () => {
  it("known-owner outstanding cards are not diluted by an unrelated opponent's void", () => {
    // Leading 9♦. T♦/J♦/Q♦ are already collected (seen), leaving K♦ and A♦ as the
    // only two outstanding higher diamonds (maxHigher=5). We passed K♦ to player 1
    // — a certain, specific-opponent threat. Players 2 and 3 are void in diamonds,
    // which is irrelevant to K♦'s known location.
    const hand = [c("diamonds", 9)];
    const baseState = mkState({
      wonCards: [[c("diamonds", 10), c("diamonds", 11), c("diamonds", 12)], [], [], []],
      knownVoids: [[], [], ["diamonds"], ["diamonds"]],
    });
    const infoWithPassMemory = buildHeartsInfoSet(
      hand,
      [],
      { ...baseState, passedAwayByPlayer: [[c("diamonds", 13)], [], [], []] },
      0
    );
    const infoWithoutPassMemory = buildHeartsInfoSet(hand, [], baseState, 0);

    const pWith = computePWin(c("diamonds", 9), infoWithPassMemory);
    const pWithout = computePWin(c("diamonds", 9), infoWithoutPassMemory);

    // Exact expected value: basePWin = 1 - 2/5 = 0.6; unknownFraction = 1/2
    // (only A♦ is unknown-location); voidFraction = 2/3 (players 2,3 void).
    // pWith = 0.6 + 2/3 * 1/2 * 0.4 ≈ 0.7333.
    expect(pWith).toBeCloseTo(0.7333, 3);
    // Without pass memory, the full void bonus applies to both outstanding cards:
    // pWithout = 0.6 + 2/3 * 0.4 ≈ 0.8667.
    expect(pWithout).toBeCloseTo(0.8667, 3);
    expect(pWith).toBeLessThan(pWithout);
  });

  it("is unaffected when nothing was passed this hand (regression safety)", () => {
    // Same as the pre-existing void-ledger-bonus case — passedCards defaults to
    // empty, so unknownFractionOfHigher is 1 and the formula reduces to the
    // original behavior exactly.
    const hand = [c("diamonds", 9)];
    const info = buildHeartsInfoSet(
      hand,
      [],
      mkState({ knownVoids: [[], ["diamonds"], ["diamonds"], ["diamonds"]] }),
      0
    );
    expect(computePWin(c("diamonds", 9), info)).toBe(1.0); // all 3 opponents void → certain win
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

  it("leading A♠/K♠ while Q♠ is outstanding (not held, not passed): flat 0.25 baseline", () => {
    const info = mkInfo([c("spades", 1)], []); // A♠ in hand, Q♠ unaccounted for
    expect(rateQueenSpadesRisk(info, c("spades", 1))).toBe(0.25);
  });

  describe("pass-memory refinement (#2237)", () => {
    it("known Q♠ holder without a passed cover card: worse than the unknown-location baseline", () => {
      // We passed only Q♠ (left, offset 1 → recipient is player 1). No corroborating
      // K♠/A♠ passed alongside it, so we don't know if the recipient has cover.
      const hand = [c("spades", 1)]; // leading A♠
      const state = mkState({
        passDirection: "left",
        passedAwayByPlayer: [[c("spades", 12)], [], [], []],
      });
      const info = buildHeartsInfoSet(hand, [], state, 0);
      expect(rateQueenSpadesRisk(info, c("spades", 1))).toBe(0.15);
    });

    it("known Q♠ holder WITH a passed cover card: safer than the unknown-location baseline", () => {
      // We passed Q♠ and K♠ to the same recipient — they have cover, so leading A♠
      // (the other top spade) is less likely to force them to reveal Q♠.
      const hand = [c("spades", 1)]; // leading A♠
      const state = mkState({
        passDirection: "left",
        passedAwayByPlayer: [[c("spades", 12), c("spades", 13)], [], [], []],
      });
      const info = buildHeartsInfoSet(hand, [], state, 0);
      expect(rateQueenSpadesRisk(info, c("spades", 1))).toBe(0.45);
    });

    it("cover-card check is symmetric: leading K♠ checks for a passed A♠", () => {
      const hand = [c("spades", 13)]; // leading K♠
      const state = mkState({
        passDirection: "left",
        passedAwayByPlayer: [[c("spades", 12), c("spades", 1)], [], [], []],
      });
      const info = buildHeartsInfoSet(hand, [], state, 0);
      expect(rateQueenSpadesRisk(info, c("spades", 13))).toBe(0.45);
    });

    it("a passed cover card that's since been played no longer counts as cover", () => {
      // We passed Q♠ and K♠ to the same recipient, but K♠ has since appeared in
      // a completed trick (seenKeys) — the recipient no longer holds it, so
      // leading A♠ should score as the uncovered case (0.15), not covered (0.45).
      const hand = [c("spades", 1)]; // leading A♠
      const state = mkState({
        passDirection: "left",
        passedAwayByPlayer: [[c("spades", 12), c("spades", 13)], [], [], []],
        wonCards: [[], [c("spades", 13)], [], []], // K♠ already taken
      });
      const info = buildHeartsInfoSet(hand, [], state, 0);
      expect(rateQueenSpadesRisk(info, c("spades", 1))).toBe(0.15);
    });

    it("does not apply when the pass memory doesn't include Q♠", () => {
      // We passed cards away, but Q♠ wasn't one of them — no certain-holder knowledge.
      const hand = [c("spades", 1)];
      const state = mkState({
        passDirection: "left",
        passedAwayByPlayer: [[c("hearts", 5), c("clubs", 9), c("diamonds", 3)], [], [], []],
      });
      const info = buildHeartsInfoSet(hand, [], state, 0);
      expect(rateQueenSpadesRisk(info, c("spades", 1))).toBe(0.25);
    });
  });
});

// ---------------------------------------------------------------------------
// rateMoonThreat
// ---------------------------------------------------------------------------

describe("rateMoonThreat (#2235)", () => {
  // Seat 1 is the would-be shooter throughout: it holds every point taken.
  // Tricks are seated in turn order: the leader, then the next seats, then us.
  const shooterPts = (pts: number) => [0, pts, 0, 0];

  describe("detection", () => {
    it("is neutral with no points taken, points spread, or when this player holds them", () => {
      expect(rateMoonThreat(mkInfo([c("hearts", 5)], []), c("hearts", 5))).toBe(0.5);
      const spread = mkInfo([c("hearts", 5)], [], { handScores: [0, 5, 3, 0] });
      expect(rateMoonThreat(spread, c("hearts", 5))).toBe(0.5);
      const mine = mkInfo([c("hearts", 5)], [], { handScores: [6, 0, 0, 0] });
      expect(rateMoonThreat(mine, c("hearts", 5))).toBe(0.5); // not a threat to ourselves
    });

    it("is neutral when no points are at stake in the trick", () => {
      // Shooter (P1) led 5♣, P2 and P3 followed low; we (P0, last) play a club.
      const trick = [tc("clubs", 5, 1), tc("clubs", 3, 2), tc("clubs", 2, 3)];
      const info = mkInfo([c("clubs", 9)], trick, {
        handScores: shooterPts(13),
        currentTrick: trick,
      });
      expect(rateMoonThreat(info, c("clubs", 9))).toBe(0.5);
    });

    it("reacts before the old 4-point gate, growing from the threshold to full", () => {
      // Shooter (P1) led the winning 5♣; P2, P3 followed low; we (P0, last) are void.
      const trick = [tc("clubs", 5, 1), tc("clubs", 3, 2), tc("clubs", 2, 3)];
      const score = (pts: number) =>
        rateMoonThreat(
          mkInfo([c("hearts", 3)], trick, { handScores: shooterPts(pts), currentTrick: trick }),
          c("hearts", 3)
        );
      expect(score(MOON_DEFENSE.minThreatPoints - 1)).toBe(0.5); // below the threshold: neutral
      const early = score(MOON_DEFENSE.minThreatPoints); // 2 pts: the old gate (4) was off here
      const full = score(MOON_DEFENSE.fullThreatPoints);
      expect(early).toBeLessThan(0.5); // feeding the shooter is already discouraged...
      expect(early).toBeGreaterThan(full); // ...less than at a full threat
      expect(score(20)).toBeCloseTo(full, 10); // capped at full threat
    });
  });

  describe("where the points go", () => {
    it("penalises discarding points onto a trick the shooter will take — keep the stoppers", () => {
      // Shooter's 5♣ is winning and we're last: a dumped heart or Q♠ feeds the moon.
      const trick = [tc("clubs", 5, 1), tc("clubs", 3, 2), tc("clubs", 2, 3)];
      const hand = [c("hearts", 3), c("spades", 12), c("diamonds", 4)];
      const info = mkInfo(hand, trick, { handScores: shooterPts(6), currentTrick: trick });
      expect(rateMoonThreat(info, c("diamonds", 4))).toBe(0.5); // safe discard
      expect(rateMoonThreat(info, c("hearts", 3))).toBeLessThan(0.2);
      expect(rateMoonThreat(info, c("spades", 12))).toBeLessThan(
        rateMoonThreat(info, c("hearts", 3))
      );
    });

    it("counts on later players to overtake the shooter", () => {
      // The shooter (P1) led 5♣; we (P2) are void; P3 and P0 still play, and
      // eight higher clubs are out — most likely one of them takes the trick.
      const trick = [tc("clubs", 5, 1)];
      const info = mkInfo(
        [c("hearts", 3)],
        trick,
        {
          handScores: shooterPts(6),
          currentTrick: trick,
          currentLeaderIndex: 1,
        },
        2
      );
      const last = [tc("clubs", 5, 1), tc("clubs", 3, 2), tc("clubs", 2, 3)];
      const lastInfo = mkInfo([c("hearts", 3)], last, {
        handScores: shooterPts(6),
        currentTrick: last,
      });
      expect(rateMoonThreat(info, c("hearts", 3))).toBeGreaterThan(0.5);
      expect(rateMoonThreat(lastInfo, c("hearts", 3))).toBeLessThan(0.2); // nobody left to overtake
    });

    it("rewards discarding points onto a trick the shooter has already lost", () => {
      // Shooter played 5♣ but P3's K♣ is winning, and we're last: points go to P3.
      const trick = [tc("clubs", 5, 1), tc("clubs", 3, 2), tc("clubs", 13, 3)];
      const hand = [c("hearts", 3), c("spades", 12)];
      const info = mkInfo(hand, trick, { handScores: shooterPts(6), currentTrick: trick });
      expect(rateMoonThreat(info, c("hearts", 3))).toBeGreaterThan(0.8);
      expect(rateMoonThreat(info, c("spades", 12))).toBeGreaterThan(
        rateMoonThreat(info, c("hearts", 3))
      );
    });

    it("extends to in-suit forced choices: a losing heart is a block only if the shooter can't take the trick", () => {
      const hand = [c("hearts", 2)];
      const st = (trick: TrickCard[]) => ({
        handScores: shooterPts(6),
        currentTrick: trick,
        heartsBroken: true,
      });
      const blocked = [tc("hearts", 9, 1), tc("hearts", 13, 2), tc("hearts", 4, 3)]; // P2 winning
      const fed = [tc("hearts", 13, 1), tc("hearts", 4, 2), tc("hearts", 3, 3)]; // shooter winning
      expect(rateMoonThreat(mkInfo(hand, blocked, st(blocked)), c("hearts", 2))).toBeGreaterThan(
        0.8
      );
      expect(rateMoonThreat(mkInfo(hand, fed, st(fed)), c("hearts", 2))).toBeLessThan(0.2);
    });

    it("credits winning a trick that already holds points, even with a non-point card", () => {
      // Shooter led 10♣, P2 dumped 5♥, P3 followed low; our A♣ takes the heart.
      const trick = [tc("clubs", 10, 1), tc("hearts", 5, 2), tc("clubs", 3, 3)];
      const hand = [c("clubs", 1), c("clubs", 2)];
      const info = mkInfo(hand, trick, {
        handScores: shooterPts(6),
        currentTrick: trick,
        heartsBroken: true,
      });
      expect(rateMoonThreat(info, c("clubs", 1))).toBeGreaterThan(0.8); // breaks the moon
      expect(rateMoonThreat(info, c("clubs", 2))).toBeLessThan(0.2); // lets the shooter have it
    });

    it("rewards taking a point ourselves — one heart is cheap against 26", () => {
      // Shooter led 5♥, P2 and P3 followed low; our A♥ wins and breaks the moon.
      const trick = [tc("hearts", 5, 1), tc("hearts", 3, 2), tc("hearts", 2, 3)];
      const hand = [c("hearts", 1), c("hearts", 4)];
      const info = mkInfo(hand, trick, {
        handScores: shooterPts(6),
        currentTrick: trick,
        heartsBroken: true,
      });
      expect(rateMoonThreat(info, c("hearts", 1))).toBeGreaterThan(0.8);
      expect(rateMoonThreat(info, c("hearts", 4))).toBeLessThan(0.2); // loses to the shooter's 5♥
    });

    it("estimates the shooter's overtake from where the higher cards can be", () => {
      // P2 leads K♥, P3 follows, we (P0) play next; the shooter (P1) plays last.
      const trick = [tc("hearts", 13, 2), tc("hearts", 3, 3)];
      const hand = [c("hearts", 2)];
      const base = {
        handScores: shooterPts(6),
        currentTrick: trick,
        heartsBroken: true,
        currentLeaderIndex: 2,
      };
      const score = (extra: Partial<HeartsState>) =>
        rateMoonThreat(mkInfo(hand, trick, { ...base, ...extra }), c("hearts", 2));
      const aceOut = score({});
      expect(aceOut).toBeGreaterThan(0.5); // the shooter holds A♥ ~1/3 of the time
      expect(score({ wonCards: [[], [c("hearts", 1)], [], []] })).toBeGreaterThan(aceOut); // A♥ gone
      expect(score({ knownVoids: [[], ["hearts"], [], []] })).toBeGreaterThan(aceOut); // shooter void
      // We passed A♥ to the shooter this hand: it certainly overtakes.
      const passedAce = score({
        passedAwayByPlayer: [[c("hearts", 1), c("clubs", 9), c("clubs", 8)], [], [], []],
      });
      expect(passedAce).toBeLessThan(0.2);
    });

    it("leading: a winning heart blocks, and a low heart blocks only if the shooter can't follow", () => {
      const hand = [c("hearts", 1), c("hearts", 2)];
      const st = { handScores: shooterPts(6), heartsBroken: true };
      const info = mkInfo(hand, [], st);
      expect(rateMoonThreat(info, c("hearts", 1))).toBeGreaterThan(0.8); // A♥ can't be beaten
      expect(rateMoonThreat(info, c("hearts", 2))).toBeLessThan(0.5); // the shooter likely takes it
      const voidInfo = mkInfo(hand, [], { ...st, knownVoids: [[], ["hearts"], [], []] });
      expect(rateMoonThreat(voidInfo, c("hearts", 2))).toBeGreaterThan(0.8);
    });
  });
});

// ---------------------------------------------------------------------------
// rateTactics (#2236)
// ---------------------------------------------------------------------------

describe("rateTactics (#2236)", () => {
  describe("(a) duck high", () => {
    it("prefers the highest card that is already beaten", () => {
      // 10♠ leads the trick; 5♠ and 9♠ are beaten.
      const trick = [tc("spades", 10, 1)];
      const hand = [c("spades", 5), c("spades", 9), c("spades", 11)];
      const info = mkInfo(hand, trick, { currentTrick: trick }, 2);
      expect(rateTactics(info, c("spades", 9))).toBeGreaterThan(rateTactics(info, c("spades", 5)));
    });

    it("gives no duck bonus to a card that still beats the current winner", () => {
      // J♠ beats the 10♠ even though Q/K/A♠ are out (computePWin says 0 here).
      const trick = [tc("spades", 10, 1)];
      const hand = [c("spades", 9), c("spades", 11)];
      const info = mkInfo(hand, trick, { currentTrick: trick }, 2);
      expect(computePWin(c("spades", 11), info)).toBe(0);
      expect(rateTactics(info, c("spades", 11))).toBe(0.5);
      expect(rateTactics(info, c("spades", 9))).toBeGreaterThan(0.5);
    });

    it("sheds the highest off-suit card when void", () => {
      const trick = [tc("clubs", 5, 1)];
      const hand = [c("diamonds", 3), c("diamonds", 13)];
      const info = mkInfo(hand, trick, { currentTrick: trick }, 2);
      expect(rateTactics(info, c("diamonds", 13))).toBeGreaterThan(
        rateTactics(info, c("diamonds", 3))
      );
    });
  });

  describe("(b) forced or free win", () => {
    it("wins with the highest card when every card of the suit wins (last to play)", () => {
      const trick = [tc("hearts", 2, 1), tc("hearts", 3, 2), tc("hearts", 4, 3)];
      const hand = [c("hearts", 8), c("hearts", 13)];
      const info = mkInfo(hand, trick, { currentTrick: trick, heartsBroken: true }, 0);
      expect(rateTactics(info, c("hearts", 13))).toBeGreaterThan(rateTactics(info, c("hearts", 8)));
    });

    it("plays the highest card of the suit when the trick holds no points (a free win)", () => {
      // Last to play in a pointless club trick: A♣ wins for free, 9♣ would duck.
      const trick = [tc("clubs", 2, 1), tc("clubs", 7, 2), tc("clubs", 11, 3)];
      const hand = [c("clubs", 1), c("clubs", 9), c("clubs", 4)];
      const info = mkInfo(hand, trick, { currentTrick: trick }, 0);
      expect(rateTactics(info, c("clubs", 1))).toBeGreaterThan(rateTactics(info, c("clubs", 9)));
    });

    it("ducks instead when the trick holds points and a card can lose", () => {
      const trick = [tc("clubs", 10, 1), tc("hearts", 5, 2), tc("clubs", 3, 3)];
      const hand = [c("clubs", 1), c("clubs", 9)];
      const info = mkInfo(hand, trick, { currentTrick: trick, heartsBroken: true }, 0);
      expect(rateTactics(info, c("clubs", 9))).toBeGreaterThan(rateTactics(info, c("clubs", 1)));
      expect(rateTactics(info, c("clubs", 1))).toBe(0.5); // A♣ wins: no bonus
    });
  });

  describe("(c) spade flush", () => {
    it("rewards leading a low spade while Q♠ is out and we hold none of Q/K/A♠", () => {
      const hand = [c("spades", 4), c("diamonds", 4)];
      const info = mkInfo(hand, []);
      expect(rateTactics(info, c("spades", 4))).toBeGreaterThan(0.5);
      expect(rateTactics(info, c("diamonds", 4))).toBe(0.5);
    });

    it("does not flush when Q♠ is gone, ours, or could land on our A♠/K♠", () => {
      const lead = (hand: Card[], extra: Partial<HeartsState> = {}) =>
        rateTactics(mkInfo(hand, [], extra), c("spades", 4));
      expect(lead([c("spades", 4)], { wonCards: [[], [c("spades", 12)], [], []] })).toBe(0.5);
      expect(lead([c("spades", 4), c("spades", 12)])).toBe(0.5);
      expect(lead([c("spades", 4), c("spades", 13)])).toBe(0.5);
      expect(lead([c("spades", 4), c("spades", 1)])).toBe(0.5);
    });
  });
});

// ---------------------------------------------------------------------------
// rateMoonAttemptProgress
// ---------------------------------------------------------------------------

describe("rateMoonAttemptProgress", () => {
  it("returns ≥0.9 for dumping junk (non-point) when void (rank bonus added)", () => {
    const trick = [tc("clubs", 5, 1)]; // clubs led
    const hand = [c("diamonds", 3)]; // void in clubs, diamond discard
    const info = mkInfo(hand, trick, { currentTrick: trick });
    expect(rateMoonAttemptProgress(info, c("diamonds", 3))).toBeGreaterThanOrEqual(0.9);
    expect(rateMoonAttemptProgress(info, c("diamonds", 3))).toBeLessThanOrEqual(1.0);
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
