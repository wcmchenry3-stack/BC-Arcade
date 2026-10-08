import {
  canStackOnFoundation,
  emptyFoundations,
  isWin,
  withFoundation,
  type Foundations,
} from "../foundations";
import { RANKS, SUITS, type PlayingCard, type Rank, type Suit } from "../types";

const c = (suit: Suit, rank: Rank): PlayingCard => ({ suit, rank });
const pile = (suit: Suit, upTo: number): PlayingCard[] =>
  RANKS.filter((r) => r <= upTo).map((r) => c(suit, r));

describe("emptyFoundations", () => {
  it("has an empty pile per suit, keyed in SUITS order", () => {
    const f = emptyFoundations();
    expect(f).toEqual({ spades: [], hearts: [], diamonds: [], clubs: [] });
    expect(Object.keys(f)).toEqual([...SUITS]);
  });

  it("returns fresh piles each call", () => {
    expect(emptyFoundations().spades).not.toBe(emptyFoundations().spades);
  });
});

describe("withFoundation", () => {
  it("replaces one suit's pile and leaves the input untouched", () => {
    const before = emptyFoundations();
    const after = withFoundation(before, "hearts", [c("hearts", 1)]);
    expect(after.hearts).toEqual([c("hearts", 1)]);
    expect(after.spades).toBe(before.spades);
    expect(before.hearts).toEqual([]);
  });

  it("keeps the key order (saved shape)", () => {
    const after = withFoundation(emptyFoundations(), "diamonds", [c("diamonds", 1)]);
    expect(Object.keys(after)).toEqual([...SUITS]);
  });

  it("preserves extended card fields", () => {
    type FaceCard = PlayingCard & { faceUp: boolean };
    const f = emptyFoundations<FaceCard>();
    const next = withFoundation(f, "clubs", [{ suit: "clubs", rank: 1, faceUp: true }]);
    expect(next.clubs[0]?.faceUp).toBe(true);
  });
});

describe("isWin", () => {
  const full: Foundations = {
    spades: pile("spades", 13),
    hearts: pile("hearts", 13),
    diamonds: pile("diamonds", 13),
    clubs: pile("clubs", 13),
  };

  it("is true once every card is on the foundations", () => {
    expect(isWin(full, 52)).toBe(true);
  });

  it("is false while a card is missing", () => {
    expect(isWin(withFoundation(full, "clubs", pile("clubs", 12)), 52)).toBe(false);
    expect(isWin(emptyFoundations(), 52)).toBe(false);
  });

  it("compares against the supplied deck size", () => {
    expect(isWin(emptyFoundations(), 0)).toBe(true);
    expect(isWin(full, 104)).toBe(false);
  });
});

describe("canStackOnFoundation", () => {
  it("accepts only an Ace on an empty pile", () => {
    expect(canStackOnFoundation(c("spades", 1), [])).toBe(true);
    expect(canStackOnFoundation(c("spades", 2), [])).toBe(false);
  });

  it("accepts the next rank of the same suit", () => {
    expect(canStackOnFoundation(c("hearts", 4), pile("hearts", 3))).toBe(true);
  });

  it("rejects a skipped rank, a repeated rank or another suit", () => {
    expect(canStackOnFoundation(c("hearts", 5), pile("hearts", 3))).toBe(false);
    expect(canStackOnFoundation(c("hearts", 3), pile("hearts", 3))).toBe(false);
    expect(canStackOnFoundation(c("diamonds", 4), pile("hearts", 3))).toBe(false);
  });

  it("rejects anything on a complete pile", () => {
    expect(canStackOnFoundation(c("clubs", 1), pile("clubs", 13))).toBe(false);
  });

  it("rejects a pile whose top slot is a hole", () => {
    const holed = [c("spades", 1)];
    holed.length = 2;
    expect(canStackOnFoundation(c("spades", 2), holed)).toBe(false);
  });
});
