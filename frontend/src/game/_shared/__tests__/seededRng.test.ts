import { LCG_MODULUS, createRngSlot, createSeededRng, lcgNext } from "../seededRng";

// Verbatim copies of the per-engine LCGs that #2985 replaced. They prove the shared
// generator is byte-identical to each engine's previous behaviour.
const OLD_IMUL = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const OLD_MUL = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const SEEDS = [
  0, 1, 2, 7, 42, 99, 1234, 65535, 65536, 123456789, 2147483647, 2147483648, 4294967295, 4294967296,
  -1, -42, 1.9, 0xdeadbeef,
];
for (let i = 0; i < 40; i++) SEEDS.push((i * 2654435761 + 12345) >>> 0);

describe("createSeededRng equivalence with the pre-#2985 engine copies", () => {
  const engines: Array<[string, (s: number) => () => number]> = [
    ["hearts/solitaire/freecell/mahjong (Math.imul)", OLD_IMUL],
    ["yacht/blackjack/twenty48 (plain multiply)", OLD_MUL],
  ];
  for (const [name, old] of engines) {
    it(`matches ${name} for ${SEEDS.length} seeds x 500 draws`, () => {
      for (const seed of SEEDS) {
        const a = createSeededRng(seed);
        const b = old(seed);
        for (let i = 0; i < 500; i++) expect(a()).toBe(b());
      }
    });
  }
});

describe("createSeededRng", () => {
  it("known-answer sequence for seed 42", () => {
    const rng = createSeededRng(42);
    const s1 = (Math.imul(1664525, 42) + 1013904223) >>> 0;
    expect(rng()).toBe(s1 / LCG_MODULUS);
    expect(rng()).toBe(lcgNext(s1) / LCG_MODULUS);
  });

  it("never returns 1.0 even at the top of the state space", () => {
    // The old Star Swarm divisor (0xffffffff) mapped state 0xffffffff to exactly 1.0.
    expect(0xffffffff / LCG_MODULUS).toBeLessThan(1);
    const rng = createSeededRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("independent generators do not share state", () => {
    const a = createSeededRng(5);
    const b = createSeededRng(5);
    a();
    a();
    expect(b()).toBe(createSeededRng(5)());
  });
});

describe("createRngSlot", () => {
  it("defaults to Math.random-backed draws and swaps via setRng", () => {
    const slot = createRngSlot();
    const v = slot.rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
    const seeded = createSeededRng(3);
    slot.setRng(seeded);
    expect(slot.getRng()).toBe(seeded);
    expect(slot.rng()).toBe(createSeededRng(3)());
  });

  it("the rng reference follows later setRng calls", () => {
    const slot = createRngSlot(() => 0.25);
    const draw = slot.rng;
    expect(draw()).toBe(0.25);
    slot.setRng(() => 0.75);
    expect(draw()).toBe(0.75);
  });

  it("slots are isolated from each other", () => {
    const a = createRngSlot(() => 0.1);
    const b = createRngSlot(() => 0.9);
    a.setRng(() => 0.5);
    expect(a.rng()).toBe(0.5);
    expect(b.rng()).toBe(0.9);
  });
});
