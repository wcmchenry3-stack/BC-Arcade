import { createSeededRng } from "../../engine";
import { DICE_TAG, createStream, deriveSeed, turnDiceTable, turnNoiseStream } from "../streams";

function draws(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

function correlation(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sx += (x[i]! - mx) ** 2;
    sy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sx * sy);
}

// With n = 20,000 the standard error of a zero correlation is ~0.007, so
// |r| < 0.035 is a ~5σ bound: it catches real coupling, never flakes.
const N = 20_000;
const MAX_ABS_R = 0.035;

describe("streams", () => {
  it("is deterministic for a given seed", () => {
    expect(draws(createStream(42), 50)).toEqual(draws(createStream(42), 50));
    expect(draws(createStream(42), 50)).not.toEqual(draws(createStream(43), 50));
  });

  it("returns values in [0, 1)", () => {
    for (const v of draws(createStream(7), 5_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("gives the two players' streams in a block uncorrelated sequences", () => {
    const x = draws(createStream(deriveSeed(1, 0, 0)), N);
    const y = draws(createStream(deriveSeed(1, 0, 1)), N);
    expect(Math.abs(correlation(x, y))).toBeLessThan(MAX_ABS_R);
  });

  it("gives adjacent blocks uncorrelated first draws (the LCG's seed+1 flaw)", () => {
    // First draw of block i vs block i+1, across many blocks.
    const firstOf = (block: number) => createStream(deriveSeed(1, block, 0))();
    const x = Array.from({ length: N }, (_, i) => firstOf(i));
    const y = Array.from({ length: N }, (_, i) => firstOf(i + 1));
    expect(Math.abs(correlation(x, y))).toBeLessThan(MAX_ABS_R);

    // Documents why seeds are hashed: the engine LCG fails this badly.
    const lx = Array.from({ length: 2_000 }, (_, i) => createSeededRng(i)());
    const ly = Array.from({ length: 2_000 }, (_, i) => createSeededRng(i + 1)());
    expect(correlation(lx, ly)).toBeGreaterThan(0.99);
  });

  it("derives distinct seeds for distinct inputs and order", () => {
    const seeds = new Set<number>();
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) seeds.add(deriveSeed(a, b));
    expect(seeds.size).toBe(400);
    expect(deriveSeed(1, 2)).not.toBe(deriveSeed(2, 1));
  });

  it("turnDiceTable is a deterministic 3×5 table of fair dice", () => {
    expect(turnDiceTable(9, 3)).toEqual(turnDiceTable(9, 3));
    expect(turnDiceTable(9, 3)).not.toEqual(turnDiceTable(9, 4));

    const counts = [0, 0, 0, 0, 0, 0];
    for (let r = 1; r <= 2_000; r++) {
      const table = turnDiceTable(123, r);
      expect(table).toHaveLength(3);
      for (const row of table) {
        expect(row).toHaveLength(5);
        for (const face of row) counts[face - 1]!++;
      }
    }
    // 30,000 dice: each face expected 5,000 (SD ≈ 65); ±400 is > 6σ.
    for (const c of counts) expect(Math.abs(c - 5_000)).toBeLessThan(400);
  });

  it("keeps noise and dice sub-streams separate", () => {
    const noise = turnNoiseStream(5, 1)();
    const dice = createStream(deriveSeed(5, DICE_TAG, 1))();
    expect(noise).not.toBe(dice);
  });
});
