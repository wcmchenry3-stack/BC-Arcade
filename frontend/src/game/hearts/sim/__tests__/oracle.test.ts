import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Card, HeartsState, Rank, Suit } from "../../types";
import {
  DEFAULT_REGRET_BANDS,
  bandForRegret,
  decisionRegret,
  evaluatePlays,
  handCost,
  regretFromValues,
  rolloutPlay,
} from "../oracle";

const c = (suit: Suit, rank: number): Card => ({ suit, rank: rank as Rank });

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
    heartsBroken: true,
    tricksPlayedInHand: 11,
    isComplete: false,
    winnerIndex: null,
    ...overrides,
  };
}

const hearts = (n: number): Card[] => Array.from({ length: n }, (_, i) => c("hearts", i + 2));

/**
 * Two tricks left, seat 0 to lead. Leading K♠ lets seat 1 duck Q♠ under it
 * (13 points to seat 0); leading 2♠ forces seat 1's lone spade, Q♠, to win
 * its own trick, and seat 0 later discards K♠ on diamonds.
 */
const queenEndgame = mkState({
  playerHands: [
    [c("spades", 2), c("spades", 13)],
    [c("spades", 12), c("diamonds", 3)],
    [c("spades", 5), c("diamonds", 4)],
    [c("spades", 6), c("diamonds", 5)],
  ],
});

describe("handCost", () => {
  it("is own points minus the table mean without a moon", () => {
    const won = [[c("spades", 12)], hearts(5), hearts(13).slice(5), []];
    expect(handCost(won)).toEqual([13 - 6.5, 5 - 6.5, 8 - 6.5, 0 - 6.5]);
  });

  it("scores a moon as the swing it makes: shooter −19.5, everyone else +6.5", () => {
    const won = [[], [...hearts(13), c("spades", 12)], [c("clubs", 2)], []];
    expect(handCost(won)).toEqual([6.5, -19.5, 6.5, 6.5]);
  });
});

describe("rolloutPlay", () => {
  it("follows with the highest card that still loses", () => {
    const state = mkState({
      playerHands: [[c("spades", 3), c("spades", 9), c("spades", 11)], [], [], []],
      currentTrick: [{ card: c("spades", 10), playerIndex: 3 }],
    });
    expect(rolloutPlay(state, 0)).toEqual(c("spades", 9));
  });

  it("dumps Q♠ when void in the led suit", () => {
    const state = mkState({
      playerHands: [[c("spades", 12), c("hearts", 1), c("diamonds", 9)], [], [], []],
      currentTrick: [{ card: c("clubs", 10), playerIndex: 3 }],
    });
    expect(rolloutPlay(state, 0)).toEqual(c("spades", 12));
  });

  it("leads the lowest card an opponent can beat", () => {
    const state = mkState({
      playerHands: [
        [c("clubs", 1), c("diamonds", 4), c("diamonds", 9)],
        [c("diamonds", 10)],
        [c("clubs", 3)],
        [],
      ],
    });
    expect(rolloutPlay(state, 0)).toEqual(c("diamonds", 4));
  });

  it("plays a committed moon out: the lone point-holder wins with its highest card", () => {
    const state = mkState({
      playerHands: [[c("diamonds", 4), c("diamonds", 13)], [], [], []],
      currentTrick: [{ card: c("diamonds", 10), playerIndex: 3 }],
      handScores: [12, 0, 0, 0],
    });
    expect(rolloutPlay(state, 0)).toEqual(c("diamonds", 13));
  });
});

describe("evaluatePlays (perfect-information reference)", () => {
  it("picks the objectively correct card in a known endgame", () => {
    const values = evaluatePlays(queenEndgame);
    const cost = (card: Card) =>
      values.find((v) => v.card.suit === card.suit && v.card.rank === card.rank)!.cost;
    expect(cost(c("spades", 13)) - cost(c("spades", 2))).toBe(13);
  });

  it("is deterministic", () => {
    expect(evaluatePlays(queenEndgame)).toEqual(evaluatePlays(queenEndgame));
  });

  it("grades the Q♠-feeding lead as a 13-point blunder and the right lead as optimal", () => {
    const bad = decisionRegret(queenEndgame, c("spades", 13));
    expect(bad).toMatchObject({ regret: 13, band: "blunder", best: c("spades", 2) });
    expect(decisionRegret(queenEndgame, c("spades", 2))).toMatchObject({
      regret: 0,
      band: "optimal",
    });
  });

  it("only uses the engine's rules — nothing from the AI it grades", () => {
    const source = readFileSync(join(__dirname, "..", "oracle.ts"), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../engine", "../types"]);
  });
});

describe("regret and bands", () => {
  const values = [
    { card: c("clubs", 2), cost: -3 },
    { card: c("clubs", 9), cost: -1.5 },
    { card: c("spades", 12), cost: 10 },
  ];

  it("measures regret against the cheapest card", () => {
    expect(regretFromValues(values, c("clubs", 2))).toMatchObject({ regret: 0, band: "optimal" });
    expect(regretFromValues(values, c("clubs", 9))).toMatchObject({ regret: 1.5, band: "minor" });
    expect(regretFromValues(values, c("spades", 12))).toMatchObject({
      regret: 13,
      band: "blunder",
    });
  });

  it("rejects a card that wasn't legal", () => {
    expect(() => regretFromValues(values, c("hearts", 5))).toThrow("not legal");
  });

  it("bands at the documented thresholds", () => {
    expect(DEFAULT_REGRET_BANDS).toEqual({ minor: 3, mistake: 10 });
    expect(bandForRegret(0)).toBe("optimal");
    expect(bandForRegret(0.01)).toBe("minor");
    expect(bandForRegret(2.99)).toBe("minor");
    expect(bandForRegret(3)).toBe("mistake");
    expect(bandForRegret(9.99)).toBe("mistake");
    expect(bandForRegret(10)).toBe("blunder");
    expect(bandForRegret(5, { minor: 1, mistake: 5 })).toBe("blunder");
  });
});
