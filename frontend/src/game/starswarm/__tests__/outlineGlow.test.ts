/**
 * #3592: the web canvas's armour outline is built once into an offscreen canvas. These tests
 * drive it with recording fakes (jsdom has no 2D context).
 */
import { buildOutlineGlow, shipGlow } from "../render/outlineGlow";
import type { GlowCache, GlowSource, MakeCanvas } from "../render/outlineGlow";
import { ARMOUR_OUTLINE } from "../render/ship";
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
    const stack = ["p1Base", "p1Guns2", "p1Plating1"] as const;
    const a = shipGlow(cache, stack, images, 2, 1, 1, 3, make);
    expect(a).not.toBeNull();
    expect(made).toHaveLength(3);
    expect(shipGlow(cache, stack, images, 2, 1, 1, 3, make)).toBe(a);
    expect(made).toHaveLength(3);
    // another level pair is its own entry
    shipGlow(cache, ["p1Base", "p1Plating1"], images, 1, 1, 1, 3, make);
    expect(made).toHaveLength(6);
  });

  it("builds nothing, and caches nothing, while a layer of the stack has not loaded", () => {
    const { make, made } = fakeCanvases();
    const cache: GlowCache = [];
    expect(shipGlow(cache, ["p1Base", "p1Guns3"], images, 3, 1, 1, 3, make)).toBeNull();
    expect(made).toHaveLength(0);
    expect(cache).toEqual([]);
  });
});
