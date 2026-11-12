import { FRUIT_SETS, FruitTier } from "../fruitSets";

const ALL_TIERS: FruitTier[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

describe("fruitSets structure", () => {
  it("defines exactly two sets", () => {
    expect(Object.keys(FRUIT_SETS)).toHaveLength(2);
    expect(FRUIT_SETS).toHaveProperty("fruits");
    expect(FRUIT_SETS).toHaveProperty("cosmos");
  });

  for (const [setId, set] of Object.entries(FRUIT_SETS)) {
    describe(`set: ${setId}`, () => {
      it("has exactly 12 fruit definitions", () => {
        expect(set.fruits).toHaveLength(12);
      });

      it("has no duplicate tiers", () => {
        const tiers = set.fruits.map((f) => f.tier);
        const unique = new Set(tiers);
        expect(unique.size).toBe(12);
      });

      it("covers all tiers 0–11", () => {
        const tiers = set.fruits.map((f) => f.tier).sort((a, b) => a - b);
        expect(tiers).toEqual(ALL_TIERS);
      });

      it("every fruit has a non-empty name, emoji, and color", () => {
        for (const fruit of set.fruits) {
          expect(fruit.name.length).toBeGreaterThan(0);
          expect(fruit.emoji.length).toBeGreaterThan(0);
          expect(fruit.color.length).toBeGreaterThan(0);
        }
      });

      it("tiers 0-10 have image assets; the capstone (11) is a placeholder until the art story (#3698)", () => {
        for (const fruit of set.fruits) {
          if (fruit.tier === 11) expect(fruit.icon).toBeUndefined();
          else expect(fruit.icon).toBeTruthy();
        }
      });
    });
  }

  it("uses the requested smallest-to-largest order for cosmos", () => {
    expect(FRUIT_SETS["cosmos"]?.fruits.map((fruit) => fruit.name)).toEqual([
      "Moon",
      "Pluto",
      "Mercury",
      "Mars",
      "Venus",
      "Earth",
      "Neptune",
      "Uranus",
      "Saturn",
      "Jupiter",
      "Sun",
      "Milky Way",
    ]);
  });
});
