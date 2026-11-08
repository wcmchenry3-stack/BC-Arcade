/**
 * #3592: the player ship's layer choice and the armour outline's numbers, shared by both
 * renderers.
 */
import {
  ARMOUR_OUTLINE,
  armourLevel,
  DEFAULT_SHIP_ID,
  playerFallbackOp,
  SHIP_BASE_SPRITE,
  shipStack,
} from "../render/ship";

describe("shipStack", () => {
  it("is the same frozen list every call for a level pair (nothing allocated per frame)", () => {
    for (const guns of [1, 2, 3]) {
      for (const hull of [0, 1, 2]) {
        const a = shipStack(DEFAULT_SHIP_ID, guns, hull);
        expect(shipStack(DEFAULT_SHIP_ID, guns, hull)).toBe(a);
        expect(Object.isFrozen(a)).toBe(true);
        expect(a[0]).toBe(SHIP_BASE_SPRITE[DEFAULT_SHIP_ID]);
        expect(a).toHaveLength(1 + (guns - 1) + hull);
      }
    }
  });

  it("clamps levels outside the engine's ranges instead of returning nothing", () => {
    expect(shipStack("p1", 0, -1)).toBe(shipStack("p1", 1, 0));
    expect(shipStack("p1", 9, 9)).toBe(shipStack("p1", 3, 2));
    expect(shipStack("p1", 2.9, 1.9)).toBe(shipStack("p1", 2, 1));
  });
});

describe("armour outline", () => {
  it("exists from hull 1, thin then bold", () => {
    expect(armourLevel(0)).toBeUndefined();
    expect(armourLevel(1)).toBe(1);
    expect(armourLevel(2)).toBe(2);
    expect(ARMOUR_OUTLINE[2].grow).toBeGreaterThan(ARMOUR_OUTLINE[1].grow);
    expect(ARMOUR_OUTLINE[2].sigma).toBeGreaterThan(ARMOUR_OUTLINE[1].sigma);
    expect(ARMOUR_OUTLINE[2].alpha).toBeGreaterThan(ARMOUR_OUTLINE[1].alpha);
  });

  it("stays inside the sprite's 4 px margin: the grow plus 3 sigma of blur never clips", () => {
    for (const level of [1, 2] as const) {
      const o = ARMOUR_OUTLINE[level];
      expect(o.grow + 3 * o.sigma).toBeLessThan(4);
    }
  });

  it("matches the generator's simulation (dilate 2 and 4 px, blur 1.0 and 1.6 px at 3x)", () => {
    expect(ARMOUR_OUTLINE[1].grow * 3).toBeCloseTo(2);
    expect(ARMOUR_OUTLINE[1].sigma * 3).toBeCloseTo(1);
    expect(ARMOUR_OUTLINE[2].grow * 3).toBeCloseTo(4);
    expect(ARMOUR_OUTLINE[2].sigma * 3).toBeCloseTo(1.6);
  });
});

describe("playerFallbackOp", () => {
  it("is a triangle with its apex at the top centre", () => {
    expect(playerFallbackOp(10, 20, 34, 30)).toMatchObject({
      k: "poly",
      points: [27, 20, 10, 50, 44, 50],
    });
  });
});
