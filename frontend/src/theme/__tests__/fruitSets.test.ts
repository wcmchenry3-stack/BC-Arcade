import { FRUIT_SETS, FruitTier } from "../fruitSets";

/** #3960: 12 tiers (0-11). */
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

      it("every fruit has a non-empty name and color", () => {
        for (const fruit of set.fruits) {
          expect(fruit.name.length).toBeGreaterThan(0);
          expect(fruit.color.length).toBeGreaterThan(0);
        }
      });

      it("every piece names its set (its code-drawn art, #3698) and carries no image", () => {
        for (const fruit of set.fruits) {
          expect(fruit.set).toBe(setId);
          expect(fruit).not.toHaveProperty("icon");
          expect(fruit).not.toHaveProperty("bakedIcon");
          expect(fruit).not.toHaveProperty("bakedClipR");
        }
      });
    });
  }

  it("uses the requested smallest-to-largest order for cosmos", () => {
    expect(FRUIT_SETS["cosmos"]?.fruits.map((fruit) => fruit.name)).toEqual([
      "Pluto",
      "Moon",
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

  // #3920 (owner decision): the Peach is removed; the Apple is a green apple. #3960: 12 tiers.
  it("uses the owner's smallest-to-largest order for fruits", () => {
    expect(FRUIT_SETS["fruits"]?.fruits.map((fruit) => fruit.name)).toEqual([
      "Cherry",
      "Lychee",
      "Lime",
      "Lemon",
      "Plum",
      "Orange",
      "Apple",
      "Pomegranate",
      "Dragonfruit",
      "Pineapple",
      "Watermelon",
      "Pumpkin",
    ]);
    // No stand-in emoji on any piece (owner, #3964).
    expect(FRUIT_SETS["fruits"]?.fruits[6]).not.toHaveProperty("emoji");
  });
});
