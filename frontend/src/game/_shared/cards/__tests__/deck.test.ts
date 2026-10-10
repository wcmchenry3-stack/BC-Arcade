import { createSeededRng } from "../../seededRng";
import { createDeck, fisherYates } from "../deck";
import { RANKS, SUITS } from "../types";

// Verbatim copy of the per-engine shuffle that #2986 replaced (Solitaire and
// FreeCell had this exact body). Proves the shared shuffle deals byte-identically.
function oldFisherYates<T>(deck: T[], rng: () => number): T[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a !== undefined && b !== undefined) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck;
}

describe("createDeck", () => {
  it("returns 52 distinct cards, suits in SUITS order and each Ace→King", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}:${c.rank}`)).size).toBe(52);
    expect(deck[0]).toEqual({ suit: "spades", rank: 1 });
    expect(deck[12]).toEqual({ suit: "spades", rank: 13 });
    expect(deck[13]).toEqual({ suit: "hearts", rank: 1 });
    expect(deck[51]).toEqual({ suit: "clubs", rank: 13 });
    expect(deck.map((c) => c.suit)).toEqual(SUITS.flatMap((s) => RANKS.map(() => s)));
  });

  it("writes only suit and rank, in that key order (saved card shape)", () => {
    expect(JSON.stringify(createDeck()[0])).toBe('{"suit":"spades","rank":1}');
  });

  it("returns a fresh array each call", () => {
    const a = createDeck();
    const b = createDeck();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("fisherYates", () => {
  it("shuffles in place and returns the same array", () => {
    const deck = createDeck();
    const out = fisherYates(deck, createSeededRng(1));
    expect(out).toBe(deck);
  });

  it("keeps every card (a permutation)", () => {
    const shuffled = fisherYates(createDeck(), createSeededRng(7));
    const key = (c: { suit: string; rank: number }) => `${c.suit}:${c.rank}`;
    expect(shuffled.map(key).sort()).toEqual(createDeck().map(key).sort());
  });

  it("is deterministic for a seed", () => {
    expect(fisherYates(createDeck(), createSeededRng(42))).toEqual(
      fisherYates(createDeck(), createSeededRng(42))
    );
  });

  it("matches the pre-#2986 engine shuffle for many seeds", () => {
    for (let seed = 0; seed < 500; seed++) {
      const shared = fisherYates(createDeck(), createSeededRng(seed));
      const old = oldFisherYates(createDeck(), createSeededRng(seed));
      expect(JSON.stringify(shared)).toBe(JSON.stringify(old));
    }
  });

  it("pins the deal order for seed 42 (FreeCell's first column for that seed)", () => {
    const top = fisherYates(createDeck(), createSeededRng(42))
      .slice(0, 6)
      .map((c) => `${c.suit}:${c.rank}`);
    expect(top).toEqual(PINNED_SEED_42);
  });

  it("draws exactly length - 1 times, from the end down", () => {
    const draws: number[] = [];
    const rng = () => {
      draws.push(draws.length);
      return 0;
    };
    // rng() = 0 always picks j = 0: each step swaps index i with index 0.
    expect(fisherYates([1, 2, 3, 4], rng)).toEqual([2, 3, 4, 1]);
    expect(draws).toHaveLength(3);
  });

  it("leaves empty and single-element arrays alone without drawing", () => {
    const rng = jest.fn(() => 0.5);
    expect(fisherYates([], rng)).toEqual([]);
    expect(fisherYates(["x"], rng)).toEqual(["x"]);
    expect(rng).not.toHaveBeenCalled();
  });

  it("skips a swap rather than writing undefined into a sparse array", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse: (number | undefined)[] = [1, , 3];
    fisherYates(sparse, () => 0.4);
    expect(sparse.filter((v) => v !== undefined)).toHaveLength(2);
  });
});

const PINNED_SEED_42 = ["diamonds:5", "clubs:9", "spades:9", "clubs:11", "spades:3", "hearts:2"];
