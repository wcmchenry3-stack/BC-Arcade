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
  SHIP_IDS,
  shipGlowKey,
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

describe("shipGlowKey", () => {
  it("is one slot per clamped gun and hull level, in 0..8 for P1", () => {
    const keys = new Set<number>();
    for (let g = 1; g <= 3; g++) for (let h = 0; h <= 2; h++) keys.add(shipGlowKey("p1", g, h));
    expect(keys.size).toBe(9);
    expect(Math.min(...keys)).toBe(0);
    expect(Math.max(...keys)).toBe(8);
  });

  it("clamps exactly as shipStack does, so equal stacks share a slot", () => {
    for (const [g, h] of [
      [0, -1],
      [9, 5],
      [2.7, 1.9],
      [-3, 2],
    ] as const) {
      const stack = shipStack("p1", g, h);
      const same = [1, 2, 3].flatMap((gg) =>
        [0, 1, 2].filter((hh) => shipStack("p1", gg, hh) === stack).map((hh) => [gg, hh] as const)
      );
      expect(same).toHaveLength(1);
      expect(shipGlowKey("p1", g, h)).toBe(shipGlowKey("p1", same[0]![0], same[0]![1]));
    }
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

describe("the three ships (#3600)", () => {
  const LAYERS = ["Base", "Guns2", "Guns3", "Plating1", "Plating2"];

  it("lists P1 (the default), P2 and P3", () => {
    expect(SHIP_IDS).toEqual(["p1", "p2", "p3"]);
    expect(DEFAULT_SHIP_ID).toBe("p1");
  });

  it.each(SHIP_IDS)("%s draws only its own layers", (ship) => {
    expect(shipStack(ship, 3, 2)).toEqual(LAYERS.map((l) => `${ship}${l}`));
    expect(shipStack(ship, 1, 0)).toEqual([`${ship}Base`]);
    expect(shipStack(ship, 2, 1)).toEqual([`${ship}Base`, `${ship}Guns2`, `${ship}Plating1`]);
    expect(SHIP_BASE_SPRITE[ship]).toBe(`${ship}Base`);
  });

  it("gives every ship, gun and hull combination its own glow slot", () => {
    const keys = new Set<number>();
    for (const ship of SHIP_IDS)
      for (let g = 1; g <= 3; g++) for (let h = 0; h <= 2; h++) keys.add(shipGlowKey(ship, g, h));
    expect(keys.size).toBe(27);
    expect(Math.min(...keys)).toBe(0);
    expect(Math.max(...keys)).toBe(26);
  });

  it("keeps P2 and P3 glow slots clear of P1's (the P1 slots do not move)", () => {
    expect(shipGlowKey("p1", 3, 2)).toBe(8);
    expect(shipGlowKey("p2", 1, 0)).toBe(9);
    expect(shipGlowKey("p3", 1, 0)).toBe(18);
  });

  it("clamps P2 and P3 levels like P1's", () => {
    expect(shipStack("p3", 9, 9)).toBe(shipStack("p3", 3, 2));
    expect(shipGlowKey("p2", 0, -1)).toBe(shipGlowKey("p2", 1, 0));
  });
});
