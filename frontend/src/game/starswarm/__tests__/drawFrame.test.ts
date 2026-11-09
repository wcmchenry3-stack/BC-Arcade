/**
 * #2565: the UI-thread renderer replays a display list onto a Skia canvas. These tests drive it
 * against a recording fake of the Skia API and pin, per op kind, the draw call and the paint
 * state it is made with, matching what the phase-2 declarative renderer drew (removed in #2567).
 */
// Counts of the Skia objects drawFrame makes, so the #2963 cache can be pinned.
const mockMade = {
  paints: 0,
  colors: 0,
  paths: 0,
  disposed: 0,
  filters: 0,
  colorFilters: 0,
  surfaces: 0,
  matrices: 0,
};
// #3594: Skia rects made, kept apart from `mockMade` (which tests compare whole across frames)
const mockRects = { made: 0 };
// What was drawn on the offscreen surfaces (#3592), one list per surface
const mockSurfaceCalls: { fn: string; args: unknown[] }[][] = [];
let mockSurfaceFails = false;
let mockSnapshotThrows = false;

jest.mock("@shopify/react-native-skia", () => {
  // #2963: colours arrive packed 0xAARRGGBB; the fake Skia colour keeps the number
  const Paint = () => {
    mockMade.paints++;
    const st = { color: 0, alpha: 1, style: 0, strokeWidth: 0, antiAlias: false };
    return {
      st,
      setColor: (c: { packed: number }) => {
        st.color = c.packed;
        st.alpha = ((c.packed >>> 24) & 255) / 255;
      },
      getAlphaf: () => st.alpha,
      setAlphaf: (a: number) => {
        st.alpha = a;
      },
      setStyle: (s: number) => {
        st.style = s;
      },
      setStrokeWidth: (w: number) => {
        st.strokeWidth = w;
      },
      setAntiAlias: (b: boolean) => {
        st.antiAlias = b;
      },
      setImageFilter: (f: unknown) => {
        (st as Record<string, unknown>).imageFilter = f;
      },
      setColorFilter: (f: unknown) => {
        (st as Record<string, unknown>).colorFilter = f;
      },
    };
  };
  // #3592: the armour outline's filter chain, as a tree the tests can read back
  const filter = (kind: string, args: Record<string, unknown>) => {
    mockMade.filters++;
    return { kind, ...args };
  };
  return {
    PaintStyle: { Fill: 0, Stroke: 1 },
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    BlendMode: { SrcIn: 6 },
    TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: {
      Surface: {
        Make: (w: number, h: number) => {
          if (mockSurfaceFails) return null;
          mockMade.surfaces++;
          const calls: { fn: string; args: unknown[] }[] = [];
          mockSurfaceCalls.push(calls);
          const rec =
            (fn: string) =>
            (...args: unknown[]) =>
              calls.push({ fn, args });
          const canvas = {
            saveLayer: (p: { st: Record<string, unknown> }, b: unknown) =>
              calls.push({ fn: "saveLayer", args: [b, p.st.imageFilter] }),
            restore: rec("restore"),
            drawImageRectOptions: (i: { id: string }, src: unknown, dst: unknown) =>
              calls.push({ fn: "drawImageRect", args: [i.id, src, dst] }),
          };
          return {
            getCanvas: () => canvas,
            flush: rec("flush"),
            dispose: rec("dispose"),
            makeImageSnapshot: () => {
              if (mockSnapshotThrows) throw new Error("snapshot failed");
              return {
                id: `glow${mockMade.surfaces}`,
                size: [w, h],
                width: () => w,
                height: () => h,
              };
            },
          };
        },
      },
      Paint,
      ImageFilter: {
        MakeDilate: (rx: number, ry: number, input: unknown) => filter("dilate", { rx, ry, input }),
        MakeColorFilter: (cf: unknown, input: unknown) => filter("tint", { cf, input }),
        MakeBlur: (sx: number, sy: number, mode: number, input: unknown) =>
          filter("blur", { sx, sy, mode, input }),
      },
      ColorFilter: {
        MakeBlend: (color: unknown, mode: number) => {
          mockMade.colorFilters++;
          return { color, mode };
        },
        MakeMatrix: (matrix: number[]) => {
          mockMade.matrices++;
          return { matrix };
        },
      },
      Color: (packed: number) => {
        mockMade.colors++;
        return { packed };
      },
      XYWHRect: (x: number, y: number, width: number, height: number) => {
        mockRects.made++; // #3594: so a shot's per-frame rects can be counted
        return { x, y, width, height };
      },
      PathBuilder: {
        Make: () => {
          mockMade.paths++;
          const cmds: (string | number)[][] = [];
          const b = {
            moveTo: (x: number, y: number) => (cmds.push(["M", x, y]), b),
            lineTo: (x: number, y: number) => (cmds.push(["L", x, y]), b),
            close: () => (cmds.push(["Z"]), b),
            detach: () => ({
              cmds,
              dispose: () => {
                mockMade.disposed++;
              },
            }),
            dispose: () => {},
          };
          return b;
        },
      },
    },
    useImage: () => null,
  };
});

import { drawFrame, fitRect, type DrawImages } from "../render/drawFrame";
import { ROCK_TINT_MATRICES } from "../render/rockTint";
import { withAlpha } from "../render/color";
import { setDebugOpKeys } from "../render/opKeys";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { drawImagesOf, sameDrawImages } from "../assets";
import { initStarSwarm, CANVAS_W, CANVAS_H } from "../engine";
import type { StarSwarmState } from "../types";
import type { SkCanvas } from "@shopify/react-native-skia";

type Call = {
  fn: string;
  args: unknown[];
  paint?: Record<string, unknown>;
  sampling?: { fm: number; mm: number };
};

/** #3596: the colour filter on the paint of each image drawn, in order. */
const imageFilters: unknown[] = [];

function recorder() {
  const calls: Call[] = [];
  const snap = (p: unknown) => ({ ...(p as { st: Record<string, unknown> }).st });
  const canvas = {
    drawColor: (c: { packed: number }) => calls.push({ fn: "drawColor", args: [c.packed] }),
    drawRect: (r: unknown, p: unknown) => calls.push({ fn: "drawRect", args: [r], paint: snap(p) }),
    drawCircle: (cx: number, cy: number, r: number, p: unknown) =>
      calls.push({ fn: "drawCircle", args: [cx, cy, r], paint: snap(p) }),
    drawPath: (path: { cmds: unknown[] }, p: unknown) =>
      calls.push({ fn: "drawPath", args: [path.cmds], paint: snap(p) }),
    drawLine: (x0: number, y0: number, x1: number, y1: number, p: unknown) =>
      calls.push({ fn: "drawLine", args: [x0, y0, x1, y1], paint: snap(p) }),
    drawImageRectOptions: (
      img: { id: string },
      src: unknown,
      dst: unknown,
      fm: number,
      mm: number,
      p?: { st: Record<string, unknown> }
    ) => {
      imageFilters.push(p?.st.colorFilter); // #3596: the rock tint, kept out of `calls`
      return calls.push({ fn: "drawImageRect", args: [img.id, src, dst], sampling: { fm, mm } });
    },
    save: () => calls.push({ fn: "save", args: [] }),
    saveLayer: (p: unknown, bounds: unknown) =>
      calls.push({
        fn: "saveLayer",
        args: [bounds],
        paint: { imageFilter: (p as { st: Record<string, unknown> }).st.imageFilter },
      }),
    restore: () => calls.push({ fn: "restore", args: [] }),
    translate: (x: number, y: number) => calls.push({ fn: "translate", args: [x, y] }),
    scale: (x: number, y: number) => calls.push({ fn: "scale", args: [x, y] }),
    rotate: (deg: number, px: number, py: number) =>
      calls.push({ fn: "rotate", args: [deg, px, py] }),
  };
  return { calls, canvas: canvas as unknown as SkCanvas };
}

const img = (id: string, w = 100, h = 50) => ({ id, width: () => w, height: () => h });
function images(over: Partial<Record<string, unknown>> = {}): DrawImages {
  return {
    p1Base: img("p1base", 126, 126),
    p1Guns2: img("p1guns2", 126, 126),
    p1Guns3: img("p1guns3", 126, 126),
    p1Plating1: img("p1plating1", 126, 126),
    p1Plating2: img("p1plating2", 126, 126),
    p2Base: img("p2base", 126, 126),
    p2Guns2: img("p2guns2", 126, 126),
    p2Guns3: img("p2guns3", 126, 126),
    p2Plating1: img("p2plating1", 126, 126),
    p2Plating2: img("p2plating2", 126, 126),
    p3Base: img("p3base", 126, 126),
    p3Guns2: img("p3guns2", 126, 126),
    p3Guns3: img("p3guns3", 126, 126),
    p3Plating1: img("p3plating1", 126, 126),
    p3Plating2: img("p3plating2", 126, 126),
    buddyShip: img("buddy", 34, 34),
    enemyGrunt: img("grunt"),
    enemyElite: img("elite"),
    enemyGuardian: img("guardian"),
    enemyCarrier: img("carrier"),
    enemyEliteAttack: img("enemyEliteAttack"),
    enemyEliteHurt: img("enemyEliteHurt"),
    enemyGuardianPlate: img("enemyGuardianPlate"),
    enemyGuardianCracks: img("enemyGuardianCracks"),
    enemyGuardianPlate2: img("enemyGuardianPlate2"),
    enemyCarrierCracks: img("enemyCarrierCracks"),
    shotPlayer: img("shotPlayer"),
    shotBuddy: img("shotBuddy"),
    shotEnemy: img("shotEnemy"),
    shotFlak: img("shotFlak"),
    shotCarrier: img("shotCarrier"),
    puShield: img("shield", 40, 20),
    puBomb: img("bomb"),
    puBuddy: img("pubuddy"),
    puLightning: img("bolt"),
    puSalvage: img("crate"),
    puHull: img("plate"),
    rockLarge1: img("rockLarge1", 144, 144),
    rockLarge1Veins: img("rockLarge1Veins", 144, 144),
    rockLarge2: img("rockLarge2", 144, 144),
    rockLarge2Veins: img("rockLarge2Veins", 144, 144),
    rockSmall1: img("rockSmall1", 84, 84),
    rockSmall2: img("rockSmall2", 84, 84),
    ...over,
  } as unknown as DrawImages;
}
const draw = (ops: DrawOp[], imgs = images()) => {
  const r = recorder();
  drawFrame(r.canvas, ops, imgs);
  return r.calls;
};

describe("fitRect", () => {
  const box = { x: 10, y: 20, w: 100, h: 100 };
  it("fill stretches to the rect", () => {
    expect(fitRect(40, 20, box, "fill")).toBe(box);
  });
  it("contain keeps the aspect ratio and centres in the rect (Skia's default)", () => {
    expect(fitRect(40, 20, box, "contain")).toEqual({ x: 10, y: 45, w: 100, h: 50 });
    expect(fitRect(20, 40, box, "contain")).toEqual({ x: 35, y: 20, w: 50, h: 100 });
  });
  it("a zero-size image falls back to the rect", () => {
    expect(fitRect(0, 0, box, "contain")).toBe(box);
  });
});

describe("drawFrame — one draw call per op, with the op's paint", () => {
  it("fill clears to the colour", () => {
    expect(draw([{ k: "fill", key: "bg", color: 0xff000010 }])).toEqual([
      { fn: "drawColor", args: [0xff000010] },
    ]);
  });

  it("rects are filled; an op's opacity multiplies the colour's own alpha", () => {
    const calls = draw([
      { k: "rect", key: "a", x: 1, y: 2, w: 3, h: 4, color: 0xffff4422, opacity: 0.35 },
      {
        k: "rect",
        key: "b",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        color: withAlpha(0x000000, 0.5),
        opacity: 0.5,
      },
      { k: "rect", key: "c", x: 0, y: 0, w: 1, h: 1, color: withAlpha(0xffee00, 0.45) },
    ]);
    expect(calls[0]).toMatchObject({
      fn: "drawRect",
      args: [{ x: 1, y: 2, width: 3, height: 4 }],
      paint: { color: 0xffff4422, alpha: 0.35, style: 0, antiAlias: true },
    });
    expect(calls[1]!.paint!.alpha).toBeCloseTo(0.25);
    expect(calls[2]!.paint!.alpha).toBeCloseTo(0.45);
  });

  it("circles: stroke with its width, else filled — and a stroke never leaks into the next op", () => {
    const calls = draw([
      { k: "circle", key: "ring", cx: 5, cy: 6, r: 7, color: 0xffffffff, stroke: 3 },
      { k: "circle", key: "dot", cx: 1, cy: 1, r: 2, color: 0xff000000 },
      { k: "rect", key: "r", x: 0, y: 0, w: 1, h: 1, color: 0xff000000 },
    ]);
    expect(calls[0]).toMatchObject({
      fn: "drawCircle",
      args: [5, 6, 7],
      paint: { style: 1, strokeWidth: 3 },
    });
    expect(calls[1]).toMatchObject({ fn: "drawCircle", paint: { style: 0 } });
    expect(calls[2]).toMatchObject({ fn: "drawRect", paint: { style: 0 } });
  });

  it("an opacity never leaks into the next op either", () => {
    const calls = draw([
      { k: "circle", key: "fade", cx: 0, cy: 0, r: 1, color: 0xffffcc00, opacity: 0.2 },
      { k: "circle", key: "solid", cx: 0, cy: 0, r: 1, color: 0xffffcc00 },
    ]);
    expect(calls[0]!.paint!.alpha).toBeCloseTo(0.2);
    expect(calls[1]!.paint!.alpha).toBe(1);
  });

  it("polygons: move, line to each other vertex, close; stroked or filled", () => {
    const calls = draw([
      { k: "poly", key: "p", points: [1, 2, 3, 4, 5, 6], color: 0xff8b6a47 },
      { k: "poly", key: "e", points: [1, 2, 3, 4, 5, 6], color: 0xffc9a27a, stroke: 1.5 },
    ]);
    expect(calls[0]).toMatchObject({
      fn: "drawPath",
      args: [[["M", 1, 2], ["L", 3, 4], ["L", 5, 6], ["Z"]]],
      paint: { color: 0xff8b6a47, style: 0 },
    });
    expect(calls[1]).toMatchObject({ paint: { style: 1, strokeWidth: 1.5 } });
  });

  it("images: the whole sprite into the fitted rect", () => {
    const calls = draw([
      { k: "image", key: "e", sprite: "enemyGrunt", x: 10, y: 20, w: 30, h: 40, fit: "fill" },
      { k: "image", key: "s", sprite: "puShield", x: 0, y: 0, w: 24, h: 24, fit: "contain" },
    ]);
    expect(calls[0]).toEqual({
      fn: "drawImageRect",
      args: [
        "grunt",
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 10, y: 20, width: 30, height: 40 },
      ],
      // linear, no mipmaps — the declarative <Image> default; nearest would shimmer when scaled
      sampling: { fm: 1, mm: 0 },
    });
    expect(calls.every((c) => c.sampling?.fm === 1 && c.sampling?.mm === 0)).toBe(true);
    // 40×20 sprite contained in 24×24 → 24×12, centred vertically
    expect(calls[1]!.args[2]).toEqual({ x: 0, y: 6, width: 24, height: 12 });
  });

  it("a flipped image mirrors about its own centre, inside save/restore", () => {
    const calls = draw([
      {
        k: "image",
        key: "b",
        sprite: "buddyShip",
        x: 283,
        y: 0,
        w: 34,
        h: 34,
        fit: "fill",
        flipX: true,
      },
    ]);
    expect(calls.map((c) => c.fn)).toEqual([
      "save",
      "translate",
      "scale",
      "translate",
      "drawImageRect",
      "restore",
    ]);
    expect(calls[1]!.args).toEqual([300, 0]);
    expect(calls[2]!.args).toEqual([-1, 1]);
    expect(calls[3]!.args).toEqual([-300, 0]);
  });

  it("a rotated image rotates about its own centre, inside save/restore (#2573)", () => {
    const calls = draw([
      {
        k: "image",
        key: "r",
        sprite: "rockLarge1",
        x: 68,
        y: 68,
        w: 44,
        h: 44,
        fit: "fill",
        rotate: 0.75,
      },
    ]);
    expect(calls.map((c) => c.fn)).toEqual(["save", "rotate", "drawImageRect", "restore"]);
    expect(calls[1]!.args).toEqual([(0.75 * 180) / Math.PI, 90, 90]);
  });

  it("no rotate op is emitted (and no save/restore) when `rotate` is absent or zero", () => {
    const calls = draw([
      { k: "image", key: "a", sprite: "rockLarge1", x: 0, y: 0, w: 10, h: 10, fit: "fill" },
      {
        k: "image",
        key: "b",
        sprite: "rockLarge1",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        fit: "fill",
        rotate: 0,
      },
    ]);
    expect(calls.map((c) => c.fn)).toEqual(["drawImageRect", "drawImageRect"]);
  });

  it("#3596: a tinted rock draws with its palette's cached colour-matrix paint; veins and other images untinted", () => {
    const rockOp = (tint?: number): DrawOp => ({
      k: "image",
      sprite: tint === undefined ? "rockLarge1Veins" : "rockLarge1",
      x: 0,
      y: 0,
      w: 48,
      h: 48,
      fit: "fill",
      rotate: 0.4,
      tint,
    });
    const frame = [rockOp(0), rockOp(1), rockOp(2), rockOp(undefined), rockOp(1)];
    imageFilters.length = 0;
    const before = mockMade.matrices;
    const calls = draw(frame);
    expect(calls.filter((c) => c.fn === "drawImageRect")).toHaveLength(5);
    expect(imageFilters).toEqual([
      { matrix: ROCK_TINT_MATRICES[0] },
      { matrix: ROCK_TINT_MATRICES[1] },
      { matrix: ROCK_TINT_MATRICES[2] },
      undefined,
      { matrix: ROCK_TINT_MATRICES[1] },
    ]);
    // at most one filter per palette, ever: a second frame makes none
    expect(mockMade.matrices - before).toBeLessThanOrEqual(ROCK_TINT_MATRICES.length);
    const made = mockMade.matrices;
    const paints = mockMade.paints;
    draw(frame);
    expect(mockMade.matrices).toBe(made);
    expect(mockMade.paints).toBe(paints);
  });

  it("an image that isn't there is skipped without disturbing the rest", () => {
    const calls = draw(
      [
        { k: "image", key: "p", sprite: "p1Base", x: 0, y: 0, w: 1, h: 1, fit: "fill" },
        { k: "rect", key: "r", x: 0, y: 0, w: 1, h: 1, color: 0xff000000 },
      ],
      images({ p1Base: null })
    );
    expect(calls.map((c) => c.fn)).toEqual(["drawRect"]);
  });

  it("#3597: a line is one drawLine on the stroke paint, with no path made", () => {
    const before = { ...mockMade };
    const calls = draw([
      { k: "line", key: "l", x0: 1, y0: 2, x1: 3, y1: 4, color: 0x80ffd980, stroke: 1 },
    ]);
    expect(calls).toEqual([
      {
        fn: "drawLine",
        args: [1, 2, 3, 4],
        paint: expect.objectContaining({ color: 0x80ffd980, style: 1, strokeWidth: 1 }),
      },
    ]);
    expect(mockMade.paths - before.paths).toBe(0);
  });

  it("#2963: each polygon's path is disposed once drawn", () => {
    const before = { ...mockMade };
    draw([
      { k: "poly", points: [1, 2, 3, 4, 5, 6], color: 0xff8b6a47 },
      { k: "poly", points: [1, 2, 3, 4, 5, 6], color: 0xffc9a27a, stroke: 1.5 },
      { k: "poly", points: [1], color: 0xffc9a27a }, // too short: no path at all
    ]);
    expect(mockMade.paths - before.paths).toBe(2);
    expect(mockMade.disposed - before.disposed).toBe(2);
  });

  it("#2963: paints are made once and each colour converted once, across frames", () => {
    const ops: DrawOp[] = [
      { k: "rect", x: 0, y: 0, w: 1, h: 1, color: 0xff123456 },
      { k: "circle", cx: 0, cy: 0, r: 1, color: 0xff123456 },
      { k: "rect", x: 0, y: 0, w: 1, h: 1, color: 0xff654321 },
    ];
    draw(ops); // warm: whatever earlier tests left, these two colours are now cached
    const before = { ...mockMade };
    for (let i = 0; i < 5; i++) draw(ops);
    expect(mockMade.paints).toBe(before.paints);
    expect(mockMade.colors).toBe(before.colors);
    // a new colour is converted once, then served from the cache
    draw([{ k: "rect", x: 0, y: 0, w: 1, h: 1, color: 0xff0badce }]);
    draw([{ k: "rect", x: 0, y: 0, w: 1, h: 1, color: 0xff0badce }]);
    expect(mockMade.colors).toBe(before.colors + 1);
  });

  it("#2963: the colour cache starts over once it holds 256 colours", () => {
    const fading = (n: number): DrawOp[] =>
      Array.from({ length: n }, (_, i) => ({
        k: "rect" as const,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        color: withAlpha(0xabcdef, i / 1000),
      }));
    draw(fading(300));
    const calls = draw([{ k: "rect", x: 0, y: 0, w: 1, h: 1, color: withAlpha(0xabcdef, 0.2) }]);
    expect(calls[0]!.paint!.alpha).toBeCloseTo(0.2, 2);
  });

  it("replays a busy real frame: exactly one draw call per op, in order", () => {
    const loaded: LoadedSprites = {
      p1Base: true,
      p1Guns2: true,
      p1Guns3: true,
      p1Plating1: true,
      p1Plating2: true,
      p2Base: true,
      p2Guns2: true,
      p2Guns3: true,
      p2Plating1: true,
      p2Plating2: true,
      p3Base: true,
      p3Guns2: true,
      p3Guns3: true,
      p3Plating1: true,
      p3Plating2: true,
      buddyShip: true,
      enemyGrunt: true,
      enemyElite: true,
      enemyGuardian: true,
      enemyCarrier: true,
      enemyEliteAttack: true,
      enemyEliteHurt: true,
      enemyGuardianPlate: true,
      enemyGuardianCracks: true,
      enemyGuardianPlate2: true,
      enemyCarrierCracks: true,
      shotPlayer: true,
      shotBuddy: true,
      shotEnemy: true,
      shotFlak: true,
      shotCarrier: true,
      puShield: true,
      puBomb: true,
      puBuddy: true,
      puLightning: true,
      puSalvage: true,
      puHull: true,
      rockLarge1: true,
      rockLarge1Veins: true,
      rockLarge2: true,
      rockLarge2Veins: true,
      rockSmall1: true,
      rockSmall2: true,
    };
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42);
    const state = {
      ...s,
      phase: "Playing" as const,
      enemies: s.enemies.map((e, i) => ({ ...e, hitFlashTimer: i % 5 === 0 ? 100 : 0 })),
      explosions: [{ id: 1, x: 50, y: 50, frame: 3, frameTimer: 0 }],
      asteroids: [
        {
          id: 2,
          kind: "large" as const,
          x: 90,
          y: 90,
          vx: 0,
          vy: 0,
          radius: 22,
          hp: 6,
          rotation: 0.3,
          spin: 0,
          hitFlashTimer: 0,
          hitEnemyIds: [],
        },
      ],
      bombFlashTimer: 120,
    };
    const ops = buildFrame(state, {
      loaded,
      width: CANVAS_W,
      height: CANVAS_H,
    });
    const calls = draw(ops).filter(
      (c) => !["save", "restore", "translate", "scale", "rotate"].includes(c.fn)
    );
    expect(calls).toHaveLength(ops.length);
    const kindFor: Record<DrawOp["k"], string> = {
      fill: "drawColor",
      rect: "drawRect",
      circle: "drawCircle",
      image: "drawImageRect",
      ship: "drawImageRect", // a gun level 1, hull 0 player is the base layer alone
      poly: "drawPath",
      line: "drawLine",
    };
    expect(calls.map((c) => c.fn)).toEqual(ops.map((o) => kindFor[o.k]));
  });
});

describe("drawFrame: the player ship (#3592)", () => {
  const SHIP = {
    k: "ship" as const,
    key: "player",
    x: 100,
    y: 200,
    w: 42,
    h: 42,
  };
  const layers = (calls: Call[]) =>
    calls.filter((c) => c.fn === "drawImageRect").map((c) => c.args[0]);

  it("draws the layers bottom to top, each into the op's rect", () => {
    const calls = draw([{ ...SHIP, sprites: ["p1Base", "p1Guns2", "p1Plating1"] }]);
    expect(layers(calls)).toEqual(["p1base", "p1guns2", "p1plating1"]);
    for (const c of calls) {
      expect(c.args[1]).toEqual({ x: 0, y: 0, width: 126, height: 126 });
      expect(c.args[2]).toEqual({ x: 100, y: 200, width: 42, height: 42 });
      expect(c.sampling).toEqual({ fm: 1, mm: 0 });
    }
    expect(calls.some((c) => c.fn === "saveLayer")).toBe(false);
  });

  it("skips a layer that has not loaded and draws the rest", () => {
    const calls = draw(
      [{ ...SHIP, sprites: ["p1Base", "p1Guns2", "p1Plating1"] }],
      images({ p1Guns2: null })
    );
    expect(layers(calls)).toEqual(["p1base", "p1plating1"]);
  });

  // The glow cache lives on globalThis; start each test with none
  beforeEach(() => {
    delete (globalThis as { __starswarmDrawCache?: unknown }).__starswarmDrawCache;
    mockSurfaceCalls.length = 0;
    mockSurfaceFails = false;
    mockSnapshotThrows = false;
  });

  const glowShip = (key = 4, sprites: readonly string[] = ["p1Base", "p1Plating1"]) =>
    ({ ...SHIP, sprites, outline: 1, outlineKey: key }) as unknown as DrawOp;
  const chain = (level: 1 | 2) => {
    draw([{ ...glowShip(), outline: level } as DrawOp]);
    const blur = mockSurfaceCalls[0]![0]!.args[1] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { blur, tint: blur.input, dilate: blur.input.input };
  };

  it("an outline draws one cached glow image, then the layers once, on the main canvas", () => {
    const calls = draw([glowShip()]);
    expect(calls.map((c) => c.fn)).toEqual(["drawImageRect", "drawImageRect", "drawImageRect"]);
    expect(layers(calls)).toEqual([expect.stringMatching(/^glow/), "p1base", "p1plating1"]);
    // the glow fills the sprite rect, like the layers
    expect(calls[0]!.args[1]).toEqual({ x: 0, y: 0, width: 126, height: 126 });
    expect(calls[0]!.args[2]).toEqual({ x: 100, y: 200, width: 42, height: 42 });
    expect(calls.some((c) => c.fn === "saveLayer")).toBe(false);
  });

  it("builds the glow on an offscreen surface: the layers in a filtered saved layer, snapshotted", () => {
    draw([glowShip()]);
    expect(mockSurfaceCalls).toHaveLength(1);
    expect(mockSurfaceCalls[0]!.map((c) => c.fn)).toEqual([
      "saveLayer",
      "drawImageRect",
      "drawImageRect",
      "restore",
      "flush",
      "dispose",
    ]);
    expect(mockSurfaceCalls[0]![0]!.args[0]).toEqual({ x: 0, y: 0, width: 126, height: 126 });
    expect(
      mockSurfaceCalls[0]!.filter((c) => c.fn === "drawImageRect").map((c) => c.args[0])
    ).toEqual(["p1base", "p1plating1"]);
  });

  it("the filter is dilate, then tint, then blur, in sprite px, thin at hull 1 and bold at 2", () => {
    const thin = chain(1);
    mockSurfaceCalls.length = 0;
    delete (globalThis as { __starswarmDrawCache?: unknown }).__starswarmDrawCache;
    const bold = chain(2);
    expect(thin.blur).toMatchObject({ kind: "blur", mode: 3 }); // Decal: no edge smear
    expect(thin.tint.kind).toBe("tint");
    expect(thin.dilate).toMatchObject({ kind: "dilate", input: null });
    expect(thin.dilate.rx).toBeCloseTo(2); // 2/3 game px at 3x
    expect(bold.dilate.rx).toBeCloseTo(4);
    expect(thin.tint.cf).toMatchObject({ mode: 6, color: { packed: withAlpha(0x1fb6ff, 0.75) } });
    expect(bold.tint.cf).toMatchObject({ color: { packed: withAlpha(0x1fb6ff, 1) } });
    expect(bold.blur.sx).toBeGreaterThan(thin.blur.sx);
  });

  it("builds once per combination: no surface, filter or saveLayer in later frames", () => {
    const op = glowShip(5);
    draw([op]); // the first use builds
    const before = { ...mockMade };
    for (let i = 0; i < 50; i++) {
      const calls = draw([op, glowShip(5)]);
      expect(calls.some((c) => c.fn === "saveLayer")).toBe(false);
    }
    expect(mockMade).toEqual(before);
    expect(mockSurfaceCalls).toHaveLength(1);
    // another combination is its own glow
    draw([glowShip(8)]);
    expect(mockSurfaceCalls).toHaveLength(2);
  });

  it("waits for every layer: no glow, nothing cached, until the late image arrives", () => {
    const op = glowShip(5);
    const calls = draw([op], images({ p1Plating1: null }));
    expect(layers(calls)).toEqual(["p1base"]);
    expect(mockSurfaceCalls).toHaveLength(0);
    const late = layers(draw([op]));
    expect(late[0]).toMatch(/^glow/);
    expect(late.slice(1)).toEqual(["p1base", "p1plating1"]);
  });

  it("a failed build draws the ship without a glow and is not retried every frame", () => {
    mockSurfaceFails = true;
    const op = glowShip(5);
    expect(layers(draw([op]))).toEqual(["p1base", "p1plating1"]);
    mockSurfaceFails = false;
    expect(layers(draw([op]))).toEqual(["p1base", "p1plating1"]);
    expect(mockSurfaceCalls).toHaveLength(0);
  });

  it("a build that throws draws the ship without a glow, disposes the surface, and is not retried", () => {
    mockSnapshotThrows = true;
    const op = glowShip(5);
    expect(layers(draw([op]))).toEqual(["p1base", "p1plating1"]);
    expect(mockSurfaceCalls).toHaveLength(1);
    expect(mockSurfaceCalls[0]!.map((c) => c.fn)).toContain("dispose");
    mockSnapshotThrows = false;
    expect(layers(draw([op]))).toEqual(["p1base", "p1plating1"]);
    expect(mockSurfaceCalls).toHaveLength(1);
  });

  it("an outline op with no key draws plain layers", () => {
    const calls = draw([{ ...SHIP, sprites: ["p1Base"], outline: 1 }]);
    expect(layers(calls)).toEqual(["p1base"]);
  });

  it("an outline with no layers loaded draws nothing", () => {
    const calls = draw([glowShip(5, ["p1Base"])], images({ p1Base: null }));
    expect(layers(calls)).toEqual([]);
  });
});

describe("drawImagesOf / sameDrawImages", () => {
  const set = (p1Base: unknown = img("p"), puBomb: unknown = null) =>
    ({
      p1Base,
      p1Guns2: null,
      p1Guns3: null,
      p1Plating1: null,
      p1Plating2: null,
      p2Base: null,
      p2Guns2: null,
      p2Guns3: null,
      p2Plating1: null,
      p2Plating2: null,
      p3Base: null,
      p3Guns2: null,
      p3Guns3: null,
      p3Plating1: null,
      p3Plating2: null,
      buddyShip: null,
      enemyGrunt: null,
      enemyElite: null,
      enemyGuardian: null,
      enemyCarrier: null,
      enemyEliteAttack: null,
      enemyEliteHurt: null,
      enemyGuardianPlate: null,
      enemyGuardianCracks: null,
      enemyGuardianPlate2: null,
      enemyCarrierCracks: null,
      shotPlayer: null,
      shotBuddy: null,
      shotEnemy: null,
      shotFlak: null,
      shotCarrier: null,
      puShield: null,
      puBomb,
      puBuddy: null,
      puLightning: null,
      puSalvage: null,
      puHull: null,
    }) as unknown as Parameters<typeof drawImagesOf>[0];

  it("maps the image hook to the display list's sprite keys", () => {
    const d = drawImagesOf(set());
    expect(d.p1Base).toMatchObject({ id: "p" });
    expect("explosion" in d).toBe(false); // #3597: explosions are code-drawn, no image slots
  });

  it("is the same set only when every slot holds the same image", () => {
    const p = img("p");
    const b = img("b");
    expect(sameDrawImages(drawImagesOf(set(p, b)), drawImagesOf(set(p, b)))).toBe(true);
    expect(sameDrawImages(drawImagesOf(set(p, b)), drawImagesOf(set(img("p2"), b)))).toBe(false);
    expect(sameDrawImages(drawImagesOf(set(p, b)), drawImagesOf(set(p, img("b2"))))).toBe(false);
  });
});

describe("drawFrame: banked enemies (#3593)", () => {
  it("replays a diving enemy's lean as a rotation about its sprite's centre, every layer", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 5, 42);
    const g = s.enemies.find((e) => e.tier === "Guardian")!;
    // flying right along a straight path, half way: the full 35° lean
    const path = {
      p0: { x: 0, y: 200 },
      p1: { x: 100, y: 200 },
      p2: { x: 200, y: 200 },
      p3: { x: 300, y: 200 },
    };
    const diver = { ...g, phase: "Diving" as const, path, pathT: 0.5, x: 150, y: 200, hp: 3 };
    const loaded = Object.fromEntries(
      Object.keys(images()).map((k) => [k, true])
    ) as unknown as LoadedSprites;
    const ops = buildFrame(
      { ...s, enemies: [diver], enemyBullets: [], playerBullets: [], asteroids: [] },
      { loaded, width: CANVAS_W, height: CANVAS_H }
    ).filter((o) => o.k === "image" && o.sprite.startsWith("enemy"));
    expect(ops).toHaveLength(2); // the base and the 3 HP plate layer
    const calls = draw(ops);
    const rotates = calls.filter((c) => c.fn === "rotate");
    expect(rotates).toHaveLength(2);
    for (const r of rotates) {
      expect(r.args[0] as number).toBeCloseTo(-35);
      expect(r.args.slice(1)).toEqual([150, 200]);
    }
    expect(calls.filter((c) => c.fn === "drawImageRect").map((c) => c.args[0])).toEqual([
      "guardian",
      "enemyGuardianPlate",
    ]);
  });
});

describe("drawFrame: the Carrier's stage looks (#3625)", () => {
  beforeAll(() => setDebugOpKeys(true));
  afterAll(() => setDebugOpKeys(false));
  const loaded = Object.fromEntries(
    Object.keys(images()).map((k) => [k, true])
  ) as unknown as LoadedSprites;
  const frame = (enemies: StarSwarmState["enemies"]) =>
    buildFrame(
      {
        ...initStarSwarm(CANVAS_W, CANVAS_H, 5, 42),
        enemies,
        enemyBullets: [],
        playerBullets: [],
        asteroids: [],
      },
      { loaded, width: CANVAS_W, height: CANVAS_H }
    );
  /** The boss wave's Carrier and its four Guardians, settled on station. */
  const roster = () => {
    let i = 0;
    return initStarSwarm(CANVAS_W, CANVAS_H, 5, 42).enemies.map((e) =>
      e.tier === "Carrier"
        ? { ...e, phase: "Formation" as const, x: 200, y: 60 }
        : { ...e, phase: "Formation" as const, x: 80 + 60 * i++, y: 150 }
    );
  };

  it("replays an armoured Carrier's bubble and links as one draw call per op", () => {
    const ops = frame(roster());
    const shapes = ops.filter((o) => o.k !== "image");
    expect(shapes.some((o) => o.key?.includes("-bubble-rim"))).toBe(true);
    expect(shapes.filter((o) => /-link-\d+$/.test(o.key ?? ""))).toHaveLength(4);
    const calls = draw(ops);
    const rim = ops.find((o) => o.key?.endsWith("-bubble-rim")) as Extract<DrawOp, { k: "circle" }>;
    const call = calls.find(
      (c) => c.fn === "drawCircle" && c.args[2] === rim.r && c.paint?.strokeWidth === 1.5
    );
    expect(call).toBeDefined();
    expect(call!.paint!.style).toBe(1); // stroked
    // links and hex hints are polygons: a closed path each; and every op is one draw call
    expect(calls.filter((c) => c.fn === "drawPath")).toHaveLength(
      ops.filter((o) => o.k === "poly").length
    );
    expect(calls).toHaveLength(ops.length);
  });

  it("replays the final stand's glow and tint as filled circles in the heat red", () => {
    const carrier = roster().find((e) => e.tier === "Carrier")!;
    const ops = frame([carrier]);
    const heat = ops.filter((o) => o.key?.includes("-heat-")) as Extract<DrawOp, { k: "circle" }>[];
    expect(heat).toHaveLength(3);
    const calls = draw(ops);
    for (const h of heat) {
      const call = calls.find((c) => c.fn === "drawCircle" && c.args[2] === h.r)!;
      expect(call.paint!.style).toBe(0);
      expect(call.paint!.color).toBe(h.color);
    }
  });
});

describe("drawFrame: shots (#3594)", () => {
  const ALL = new Proxy({}, { get: () => true }) as LoadedSprites;
  const shotState = (): StarSwarmState => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    const b = { vx: 0, vy: 0.35, width: 5, height: 10, damage: 1 };
    return {
      ...s,
      enemies: [],
      buddyShips: [],
      powerUps: [],
      asteroids: [],
      explosions: [],
      enemyBullets: [
        { ...b, id: 1, x: 50, y: 100, owner: "enemy" },
        { ...b, id: 2, x: 60, y: 100, owner: "enemy", source: "carrier" },
        { ...b, id: 3, x: 70, y: 100, owner: "enemy", flak: true, vx: -0.2 },
      ],
      playerBullets: [
        { ...b, id: 4, x: 80, y: 400, owner: "player", height: 14, vy: -0.56 },
        { ...b, id: 5, x: 90, y: 400, owner: "player", height: 14, vy: -0.56, vx: 0.14 },
        { ...b, id: 6, x: 100, y: 400, owner: "player", source: "buddy", vx: 0.5, vy: 0 },
      ],
    };
  };
  const shotOpsOf = (s: StarSwarmState) =>
    buildFrame(s, { loaded: ALL, width: CANVAS_W, height: CANVAS_H }).slice(0, 6);

  it("each shot is one image draw of its own sprite; turned ones about their centre", () => {
    const ops = shotOpsOf(shotState());
    const { calls, canvas } = recorder();
    drawFrame(canvas, ops, images());
    expect(calls.map((c) => c.fn)).toEqual([
      "drawImageRect", // enemy orb: never turned
      "drawImageRect", // Carrier orb
      ...["save", "rotate", "drawImageRect", "restore"], // flak, aimed down-left
      "drawImageRect", // a straight-up bolt: no transform
      ...["save", "rotate", "drawImageRect", "restore"], // a spread bolt
      ...["save", "rotate", "drawImageRect", "restore"], // Buddy's bolt, flying right
    ]);
    const drawn = calls.filter((c) => c.fn === "drawImageRect").map((c) => c.args[0]);
    expect(drawn).toEqual([
      "shotEnemy",
      "shotCarrier",
      "shotFlak",
      "shotPlayer",
      "shotPlayer",
      "shotBuddy",
    ]);
    const buddy = ops[5] as Extract<DrawOp, { k: "image" }>;
    const turn = calls.filter((c) => c.fn === "rotate")[2]!;
    expect(turn.args).toEqual([90, buddy.x + buddy.w / 2, buddy.y + buddy.h / 2]);
  });

  it("no per-frame allocation beyond the plain rect a shot used to cost: one rect, no paint", () => {
    delete (globalThis as { __starswarmDrawCache?: unknown }).__starswarmDrawCache;
    const ops = shotOpsOf(shotState());
    const imgs = images();
    const { canvas } = recorder();
    drawFrame(canvas, ops, imgs); // first frame: the paints and each sprite's source rect
    const before = { ...mockMade };
    const rects = mockRects.made;
    for (let i = 0; i < 5; i++) drawFrame(canvas, ops, imgs);
    expect(mockMade).toEqual(before); // no paint, colour, filter, path or surface
    expect(mockRects.made - rects).toBe(5 * ops.length); // the destination rect only
  });

  it("a sprite's source rect is rebuilt when its image changes (a reload), not otherwise", () => {
    delete (globalThis as { __starswarmDrawCache?: unknown }).__starswarmDrawCache;
    const ops = shotOpsOf(shotState()).slice(0, 1); // one enemy orb
    const { calls, canvas } = recorder();
    drawFrame(canvas, ops, images());
    const before = mockRects.made;
    drawFrame(canvas, ops, images({ shotEnemy: img("orb2", 33, 33) }));
    expect(mockRects.made - before).toBe(2); // a new source rect and the destination rect
    expect(calls[1]!.args[1]).toEqual({ x: 0, y: 0, width: 33, height: 33 });
  });

  it("a fallback shot is one plain shape in its colour", () => {
    const none = new Proxy({}, { get: () => false }) as LoadedSprites;
    const ops = buildFrame(shotState(), {
      loaded: none,
      width: CANVAS_W,
      height: CANVAS_H,
    }).slice(0, 6);
    const { calls, canvas } = recorder();
    drawFrame(canvas, ops, images());
    expect(calls.map((c) => c.fn)).toEqual([
      "drawCircle",
      "drawCircle",
      "drawRect",
      "drawRect",
      "drawRect",
      "drawRect",
    ]);
  });
});

describe("drawFrame: pickups (#3595)", () => {
  const ALL = new Proxy({}, { get: () => true }) as LoadedSprites;
  const types = ["shield", "lightning", "buddy", "bomb", "salvage", "hull"] as const;
  const pickupState = (): StarSwarmState => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    return {
      ...s,
      phase: "GameOver", // no ship: the list is the pickups alone
      enemies: [],
      enemyBullets: [],
      playerBullets: [],
      buddyShips: [],
      asteroids: [],
      explosions: [],
      powerUps: types.map((type, i) => ({
        id: i + 1,
        type,
        x: 40 + 40 * i,
        y: 200,
        vy: 0.08,
        width: 24,
        height: 24,
        despawnTimer: 3000,
      })),
    };
  };
  const pickupOpsOf = (loaded: LoadedSprites) =>
    buildFrame(pickupState(), { loaded, width: CANVAS_W, height: CANVAS_H });

  it("each pickup is one image draw of its own sprite; the upgrades over their halo and ring", () => {
    const ops = pickupOpsOf(ALL);
    const { calls, canvas } = recorder();
    drawFrame(canvas, ops, images());
    expect(calls.map((c) => c.fn)).toEqual([
      "drawImageRect", // Shield
      "drawImageRect", // Lightning
      "drawImageRect", // Buddy
      "drawImageRect", // Bomb
      ...["drawCircle", "drawCircle", "drawImageRect"], // salvage: halo, ring, crate
      ...["drawCircle", "drawCircle", "drawImageRect"], // hull: halo, ring, plate
    ]);
    const drawn = calls.filter((c) => c.fn === "drawImageRect");
    expect(drawn.map((c) => c.args[0])).toEqual([
      "shield",
      "bolt",
      "pubuddy",
      "bomb",
      "crate",
      "plate",
    ]);
    // stretched to the op's rect (the art is square), the box plus its margin
    expect(drawn[0]!.args[2]).toEqual({ x: 26, y: 186, width: 28, height: 28 });
  });

  it("no per-frame allocation beyond today's: one destination rect per sprite, no paint", () => {
    delete (globalThis as { __starswarmDrawCache?: unknown }).__starswarmDrawCache;
    const ops = pickupOpsOf(ALL);
    const imgs = images();
    const { canvas } = recorder();
    drawFrame(canvas, ops, imgs); // first frame: the paints, colours and each source rect
    const before = { ...mockMade };
    const rects = mockRects.made;
    for (let i = 0; i < 5; i++) drawFrame(canvas, ops, imgs);
    expect(mockMade).toEqual(before); // no paint, colour, filter, path or surface
    expect(mockRects.made - rects).toBe(5 * 6); // the six sprites' destination rects only
  });

  it("while the art loads: the plain shapes, the same ops web replays", () => {
    const none = new Proxy({}, { get: () => false }) as LoadedSprites;
    const ops = pickupOpsOf(none);
    const { calls, canvas } = recorder();
    drawFrame(canvas, ops, images());
    const fns = calls.map((c) => c.fn);
    expect(fns.slice(0, 8)).toEqual(Array(8).fill("drawPath")); // four hexagons, each rimmed
    expect(fns).not.toContain("drawImageRect");
  });
});
