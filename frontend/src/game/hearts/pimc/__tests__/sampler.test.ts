import { buildHeartsInfoSet } from "../../aiInfoSet";
import { createSeededRng, dealGame, setRng } from "../../engine";
import type { Card, HeartsState, Rank, Suit } from "../../types";
import { DealSampler, dealConstraints, type DealConstraints } from "../sampler";

const c = (suit: Suit, rank: number): Card => ({ suit, rank: rank as Rank });
const key = (card: Card) => `${card.suit}:${card.rank}`;

afterEach(() => setRng(Math.random));

/** A mid-hand state: 3 tricks played, seat 2 void in diamonds, seat 1 passed Q♠ to seat 2. */
function midHand(): HeartsState {
  setRng(createSeededRng(5));
  const dealt = dealGame("schemer");
  const hands = dealt.playerHands.map((h) => [...h]);
  // Move all of seat 2's diamonds to seat 3 (swapping for seat 3's non-diamonds) so the void is real.
  const d2 = hands[2]!.filter((x) => x.suit === "diamonds");
  const n3 = hands[3]!.filter((x) => x.suit !== "diamonds").slice(0, d2.length);
  hands[2] = [...hands[2]!.filter((x) => x.suit !== "diamonds"), ...n3];
  hands[3] = [...hands[3]!.filter((x) => !n3.includes(x)), ...d2];
  // Seat 1 "passed" Q♠ to seat 2: make sure seat 2 holds it.
  const holder = hands.findIndex((h) => h.some((x) => x.suit === "spades" && x.rank === 12));
  if (holder !== 2) {
    const q = hands[holder]!.find((x) => x.suit === "spades" && x.rank === 12)!;
    const give = hands[2]!.find((x) => x.suit !== "diamonds")!;
    hands[holder] = [...hands[holder]!.filter((x) => x !== q), give];
    hands[2] = [...hands[2]!.filter((x) => x !== give), q];
  }
  return {
    ...dealt,
    phase: "playing",
    playerHands: hands,
    knownVoids: [[], [], ["diamonds"], []],
    passDirection: "left",
    passedAwayByPlayer: [[], [c("spades", 12)], [], []],
    receivedByPlayer: [[], [], [], []],
  } as HeartsState;
}

describe("dealConstraints", () => {
  it("counts only unseen cards, pins passed cards to the recipient and reads voids", () => {
    const state = midHand();
    const info = buildHeartsInfoSet(state.playerHands[1]!, [], state, 1);
    const k = dealConstraints(state, info);
    expect(k.opponents).toEqual([0, 2, 3]);
    expect(k.pinned[2]!.map(key)).toEqual(["spades:12"]);
    expect(k.capacity).toEqual([13, 12, 13]);
    expect(k.voids[1]![2]).toBe(true); // seat 2, diamonds
    const unknown = k.unknown.flat().map(key);
    expect(unknown).not.toContain("spades:12");
    expect(unknown.length).toBe(38);
    for (const own of state.playerHands[1]!) expect(unknown).not.toContain(key(own));
  });

  it("ignores voids and pass memory without inference", () => {
    const state = midHand();
    const info = buildHeartsInfoSet(state.playerHands[1]!, [], state, 1);
    const k = dealConstraints(state, info, false);
    expect(k.pinned[2]).toEqual([]);
    expect(k.capacity).toEqual([13, 13, 13]);
    expect(k.voids.flat().some(Boolean)).toBe(false);
  });
});

describe("DealSampler", () => {
  it("deals every seat the right number of cards, respecting voids and pins", () => {
    const state = midHand();
    const info = buildHeartsInfoSet(state.playerHands[1]!, [], state, 1);
    const sampler = new DealSampler(dealConstraints(state, info));
    const rng = createSeededRng(9);
    for (let i = 0; i < 200; i++) {
      const hands = sampler.sample(rng);
      expect(hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
      expect(new Set(hands.flat().map(key)).size).toBe(52);
      expect(hands[1]!.map(key).sort()).toEqual(state.playerHands[1]!.map(key).sort());
      expect(hands[2]!.some((x) => x.suit === "diamonds")).toBe(false);
      expect(hands[2]!.map(key)).toContain("spades:12");
    }
  });

  it("samples every consistent deal equally often (exact, small case)", () => {
    // 6 unknown cards in two suits; opponents hold 2 each; opponent 1 is void in hearts.
    const k: DealConstraints = {
      seat: 0,
      opponents: [1, 2, 3],
      unknown: [
        [c("spades", 2), c("spades", 3), c("spades", 4)],
        [c("hearts", 2), c("hearts", 3), c("hearts", 4)],
        [],
        [],
      ],
      pinned: [[], [], [], []],
      capacity: [2, 2, 2],
      voids: [
        [false, true, false, false],
        [false, false, false, false],
        [false, false, false, false],
      ],
    };
    // Brute force: opponent 1 takes 2 spades (3 ways); the other 4 cards split 2/2 (6 ways) = 18 deals.
    const sampler = new DealSampler(k);
    expect(sampler.count).toBeCloseTo(18, 9);
    const counts = new Map<string, number>();
    const rng = createSeededRng(3);
    const N = 18000;
    for (let i = 0; i < N; i++) {
      const hands = sampler.sample(rng);
      const id = [1, 2, 3].map((p) => hands[p]!.map(key).sort().join(",")).join("|");
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(18);
    // Each deal expects 1000; a chi-square with 17 dof stays under 40.8 with p > 0.999.
    const chi2 = [...counts.values()].reduce((s, n) => s + (n - 1000) ** 2 / 1000, 0);
    expect(chi2).toBeLessThan(40.8);
  });

  it("reports contradictory constraints instead of sampling", () => {
    const k: DealConstraints = {
      seat: 0,
      opponents: [1, 2, 3],
      unknown: [[c("spades", 2), c("spades", 3)], [], [], []],
      pinned: [[], [], [], []],
      capacity: [1, 1, 0],
      voids: [
        [true, false, false, false],
        [true, false, false, false],
        [false, false, false, false],
      ],
    };
    const sampler = new DealSampler(k);
    expect(sampler.count).toBe(0);
    expect(() => sampler.sample(Math.random)).toThrow("no deal fits");
  });
});
