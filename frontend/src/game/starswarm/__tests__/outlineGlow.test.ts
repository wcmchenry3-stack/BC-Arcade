/**
 * #3592: the web canvas's armour outline is built once into an offscreen canvas. These tests
 * drive it with recording fakes (jsdom has no 2D context).
 */
import { buildOutlineGlow, prebuildShipGlows, shipGlow } from "../render/outlineGlow";
import type { GlowCache, GlowSource, MakeCanvas } from "../render/outlineGlow";
import { ARMOUR_OUTLINE, shipGlowKey } from "../render/ship";
import type { ShipSpriteKey } from "../render/ship";

type Ctx = Record<string, unknown> & { calls: [string, unknown[]][] };
function fakeCanvases() {
  const made: { w: number; h: number; ctx: Ctx }[] = [];
  const make: MakeCanvas = (w, h) => {
    const ctx = { calls: [] } as unknown as Ctx;
    for (const fn of ["drawImage", "fillRect"]) {
      ctx[fn] = (...a: unknown[]) => ctx.calls.push([fn, a]);
    }
    made.push({ w, h, ctx });
    return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
  return { make, made };
}
const layer = (n: string): GlowSource => ({ n, width: 126, height: 126 }) as unknown as GlowSource;

describe("buildOutlineGlow", () => {
  it("stacks the layers, dilates the silhouette on a circle, tints it and shadow-blurs it", () => {
    const { make, made } = fakeCanvases();
    const out = buildOutlineGlow([layer("a"), layer("b")], 2, 3, make);
    expect(out).not.toBeNull();
    const [sil, dil, glow] = made;
    expect(sil!.ctx.calls.map((c) => c[0])).toEqual(["drawImage", "drawImage"]);
    // the dilation: the silhouette at its own spot and at 24 offsets of `grow` px (3x)
    const offsets = dil!.ctx.calls.filter((c) => c[0] === "drawImage").map((c) => c[1] as number[]);
    expect(offsets).toHaveLength(25);
    const r = ARMOUR_OUTLINE[2].grow * 3;
    for (const [, dx, dy] of offsets.slice(1)) {
      expect(Math.hypot(dx as number, dy as number)).toBeCloseTo(r);
    }
    expect(dil!.ctx.globalCompositeOperation).toBe("source-in");
    expect(dil!.ctx.fillStyle).toBe("rgba(31,182,255,1)");
    // the blur is a shadow (2 sigma) of the tinted shape drawn one canvas width away
    expect(glow!.ctx.shadowBlur).toBeCloseTo(2 * ARMOUR_OUTLINE[2].sigma * 3);
    expect(glow!.ctx.shadowColor).toBe("rgba(31,182,255,1)");
    expect(glow!.ctx.shadowOffsetX).toBe(126);
    expect(glow!.ctx.calls[0]![1]).toEqual([expect.anything(), -126, 0]);
  });

  it("hull 1 is the lighter outline: a smaller dilation and blur at 75% strength", () => {
    const { make, made } = fakeCanvases();
    buildOutlineGlow([layer("a")], 1, 3, make);
    expect(made[2]!.ctx.shadowColor).toBe("rgba(31,182,255,0.75)");
    const [, dx] = made[1]!.ctx.calls[1]![1] as number[];
    expect(Math.abs(dx!)).toBeLessThan(ARMOUR_OUTLINE[2].grow * 3);
  });

  it("returns null with no layers or when a 2D context is unavailable", () => {
    expect(buildOutlineGlow([], 1, 3, fakeCanvases().make)).toBeNull();
    const none: MakeCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;
    expect(buildOutlineGlow([layer("a")], 1, 3, none)).toBeNull();
    expect(buildOutlineGlow([layer("a")], 1, 3, () => null)).toBeNull();
  });
});

describe("shipGlow", () => {
  const images = {
    p1Base: layer("base"),
    p1Guns2: layer("g2"),
    p1Guns3: null,
    p1Plating1: layer("p1"),
    p1Plating2: null,
  } as Record<ShipSpriteKey, GlowSource | null>;

  it("builds on first use, then returns the cached canvas without touching a canvas again", () => {
    const { make, made } = fakeCanvases();
    const cache: GlowCache = [];
    const a = shipGlow(cache, "p1", images, 2, 1, 3, make);
    expect(a).not.toBeNull();
    expect(made).toHaveLength(3);
    expect(shipGlow(cache, "p1", images, 2, 1, 3, make)).toBe(a);
    expect(made).toHaveLength(3);
    // another level pair is its own entry
    shipGlow(cache, "p1", images, 1, 1, 3, make);
    expect(made).toHaveLength(6);
  });

  it("is keyed by ship and the clamped gun and hull, like shipStack", () => {
    const { make, made } = fakeCanvases();
    const cache: GlowCache = [];
    const a = shipGlow(cache, "p1", images, 2, 1, 3, make);
    // values that draw the same layers share the glow, whatever they were before clamping
    expect(shipGlow(cache, "p1", images, 2.9, 1.7, 3, make)).toBe(a);
    expect(made).toHaveLength(3);
    // out-of-range values land on the clamped slot (guns 3 needs layers that are not loaded)
    expect(shipGlow(cache, "p1", images, 9, 1, 3, make)).toBeNull();
    expect(shipGlow(cache, "p1", images, 0, 7, 3, make)).toBeNull(); // hull 2: plating2 not loaded
    expect(shipGlow(cache, "p1", images, -4, 1, 3, make)).toBe(
      shipGlow(cache, "p1", images, 1, 1, 3, make)
    );
    expect(cache[shipGlowKey("p1", 1, 1)]).toBeDefined();
    expect(cache[shipGlowKey("p1", 1, 1)]).not.toBe(a);
  });

  it("has no glow at hull 0", () => {
    const { make, made } = fakeCanvases();
    expect(shipGlow([], "p1", images, 1, 0, 3, make)).toBeNull();
    expect(shipGlow([], "p1", images, 1, -3, 3, make)).toBeNull();
    expect(made).toHaveLength(0);
  });

  it("builds nothing, and caches nothing, while a layer of the stack has not loaded", () => {
    const { make, made } = fakeCanvases();
    const cache: GlowCache = [];
    expect(shipGlow(cache, "p1", images, 3, 1, 3, make)).toBeNull();
    expect(made).toHaveLength(0);
    expect(cache).toEqual([]);
  });
});

describe("prebuildShipGlows", () => {
  const all = Object.fromEntries(
    ["p1Base", "p1Guns2", "p1Guns3", "p1Plating1", "p1Plating2"].map((k) => [k, layer(k)])
  ) as Record<ShipSpriteKey, GlowSource | null>;

  it("builds the six P1 glows (guns 1-3 x hull 1-2) up front, so a frame finds them cached", () => {
    const { make, made } = fakeCanvases();
    const cache: GlowCache = [];
    prebuildShipGlows(cache, "p1", all, 3, make);
    expect(made).toHaveLength(6 * 3);
    const slots = [1, 2, 3].flatMap((g) => [1, 2].map((h) => shipGlowKey("p1", g, h)));
    expect(new Set(slots).size).toBe(6);
    for (const i of slots) expect(cache[i]).toBeTruthy();
    // hull 0 has none, and a later draw builds nothing more
    expect(cache[shipGlowKey("p1", 1, 0)]).toBeUndefined();
    shipGlow(cache, "p1", all, 3, 2, 3, make);
    expect(made).toHaveLength(6 * 3);
  });
});
