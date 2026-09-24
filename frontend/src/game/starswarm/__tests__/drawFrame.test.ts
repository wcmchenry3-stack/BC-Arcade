/**
 * #2565: the UI-thread renderer replays a display list onto a Skia canvas. These tests drive it
 * against a recording fake of the Skia API and pin, per op kind, the draw call and the paint
 * state it is made with — the port of the phase-2 declarative `renderOp` must draw the same.
 */
jest.mock("@shopify/react-native-skia", () => {
  const alphaOf = (c: string) => {
    const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c);
    return m ? Number(m[1]) : 1;
  };
  const Paint = () => {
    const st = { color: "", alpha: 1, style: 0, strokeWidth: 0, antiAlias: false };
    return {
      st,
      setColor: (c: { str: string }) => {
        st.color = c.str;
        st.alpha = alphaOf(c.str);
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
    };
  };
  return {
    PaintStyle: { Fill: 0, Stroke: 1 },
    Skia: {
      Paint,
      Color: (str: string) => ({ str }),
      XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      Path: {
        Make: () => {
          const cmds: (string | number)[][] = [];
          const p = {
            cmds,
            moveTo: (x: number, y: number) => (cmds.push(["M", x, y]), p),
            lineTo: (x: number, y: number) => (cmds.push(["L", x, y]), p),
            close: () => (cmds.push(["Z"]), p),
          };
          return p;
        },
      },
    },
    useImage: () => null,
  };
});

import { drawFrame, fitRect, type DrawImages } from "../render/drawFrame";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { drawImagesOf, sameDrawImages } from "../assets";
import { initStarSwarm, CANVAS_W, CANVAS_H } from "../engine";
import { initStarfield } from "../starfield";
import type { SkCanvas } from "@shopify/react-native-skia";

type Call = { fn: string; args: unknown[]; paint?: Record<string, unknown> };

function recorder() {
  const calls: Call[] = [];
  const snap = (p: unknown) => ({ ...(p as { st: Record<string, unknown> }).st });
  const canvas = {
    drawColor: (c: { str: string }) => calls.push({ fn: "drawColor", args: [c.str] }),
    drawRect: (r: unknown, p: unknown) => calls.push({ fn: "drawRect", args: [r], paint: snap(p) }),
    drawCircle: (cx: number, cy: number, r: number, p: unknown) =>
      calls.push({ fn: "drawCircle", args: [cx, cy, r], paint: snap(p) }),
    drawPath: (path: { cmds: unknown[] }, p: unknown) =>
      calls.push({ fn: "drawPath", args: [path.cmds], paint: snap(p) }),
    drawImageRect: (img: { id: string }, src: unknown, dst: unknown) =>
      calls.push({ fn: "drawImageRect", args: [img.id, src, dst] }),
    save: () => calls.push({ fn: "save", args: [] }),
    restore: () => calls.push({ fn: "restore", args: [] }),
    translate: (x: number, y: number) => calls.push({ fn: "translate", args: [x, y] }),
    scale: (x: number, y: number) => calls.push({ fn: "scale", args: [x, y] }),
  };
  return { calls, canvas: canvas as unknown as SkCanvas };
}

const img = (id: string, w = 100, h = 50) => ({ id, width: () => w, height: () => h });
function images(over: Partial<Record<string, unknown>> = {}): DrawImages {
  return {
    playerShip: img("player"),
    buddyShip: img("buddy", 34, 34),
    enemyGrunt: img("grunt"),
    enemyElite: img("elite"),
    enemyBoss: img("boss"),
    enemyCarrier: img("carrier"),
    bulletPlayer: img("bullet"),
    puShield: img("shield", 40, 20),
    puBomb: img("bomb"),
    puBuddy: img("pubuddy"),
    puLightning: img("bolt"),
    explosion: Array.from({ length: 20 }, (_, i) => img(`ex${i}`, 48, 48)),
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
    expect(draw([{ k: "fill", key: "bg", color: "#000010" }])).toEqual([
      { fn: "drawColor", args: ["#000010"] },
    ]);
  });

  it("rects are filled; an op's opacity multiplies the colour's own alpha", () => {
    const calls = draw([
      { k: "rect", key: "a", x: 1, y: 2, w: 3, h: 4, color: "#ff4422", opacity: 0.35 },
      { k: "rect", key: "b", x: 0, y: 0, w: 1, h: 1, color: "rgba(0,0,0,0.5)", opacity: 0.5 },
      { k: "rect", key: "c", x: 0, y: 0, w: 1, h: 1, color: "rgba(255,238,0,0.45)" },
    ]);
    expect(calls[0]).toMatchObject({
      fn: "drawRect",
      args: [{ x: 1, y: 2, width: 3, height: 4 }],
      paint: { color: "#ff4422", alpha: 0.35, style: 0, antiAlias: true },
    });
    expect(calls[1]!.paint!.alpha).toBeCloseTo(0.25);
    expect(calls[2]!.paint!.alpha).toBeCloseTo(0.45);
  });

  it("circles: stroke with its width, else filled — and a stroke never leaks into the next op", () => {
    const calls = draw([
      { k: "circle", key: "ring", cx: 5, cy: 6, r: 7, color: "#fff", stroke: 3 },
      { k: "circle", key: "dot", cx: 1, cy: 1, r: 2, color: "#000" },
      { k: "rect", key: "r", x: 0, y: 0, w: 1, h: 1, color: "#000" },
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
      { k: "circle", key: "fade", cx: 0, cy: 0, r: 1, color: "#ffcc00", opacity: 0.2 },
      { k: "circle", key: "solid", cx: 0, cy: 0, r: 1, color: "#ffcc00" },
    ]);
    expect(calls[0]!.paint!.alpha).toBeCloseTo(0.2);
    expect(calls[1]!.paint!.alpha).toBe(1);
  });

  it("polygons: move, line to each other vertex, close; stroked or filled", () => {
    const calls = draw([
      { k: "poly", key: "p", points: [1, 2, 3, 4, 5, 6], color: "#8b6a47" },
      { k: "poly", key: "e", points: [1, 2, 3, 4, 5, 6], color: "#c9a27a", stroke: 1.5 },
    ]);
    expect(calls[0]).toMatchObject({
      fn: "drawPath",
      args: [[["M", 1, 2], ["L", 3, 4], ["L", 5, 6], ["Z"]]],
      paint: { color: "#8b6a47", style: 0 },
    });
    expect(calls[1]).toMatchObject({ paint: { style: 1, strokeWidth: 1.5 } });
  });

  it("images: the whole sprite into the fitted rect", () => {
    const calls = draw([
      { k: "image", key: "e", sprite: "enemyGrunt", x: 10, y: 20, w: 30, h: 40, fit: "fill" },
      { k: "image", key: "s", sprite: "puShield", x: 0, y: 0, w: 24, h: 24, fit: "contain" },
      {
        k: "image",
        key: "x",
        sprite: "explosion",
        frame: 7,
        x: 0,
        y: 0,
        w: 48,
        h: 48,
        fit: "fill",
      },
    ]);
    expect(calls[0]).toEqual({
      fn: "drawImageRect",
      args: [
        "grunt",
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 10, y: 20, width: 30, height: 40 },
      ],
    });
    // 40×20 sprite contained in 24×24 → 24×12, centred vertically
    expect(calls[1]!.args[2]).toEqual({ x: 0, y: 6, width: 24, height: 12 });
    expect(calls[2]!.args[0]).toBe("ex7");
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

  it("an image that isn't there is skipped without disturbing the rest", () => {
    const calls = draw(
      [
        { k: "image", key: "p", sprite: "playerShip", x: 0, y: 0, w: 1, h: 1, fit: "fill" },
        { k: "rect", key: "r", x: 0, y: 0, w: 1, h: 1, color: "#000" },
      ],
      images({ playerShip: null })
    );
    expect(calls.map((c) => c.fn)).toEqual(["drawRect"]);
  });

  it("replays a busy real frame: exactly one draw call per op, in order", () => {
    const loaded: LoadedSprites = {
      playerShip: true,
      buddyShip: true,
      enemyGrunt: true,
      enemyElite: true,
      enemyBoss: true,
      enemyCarrier: true,
      bulletPlayer: true,
      puShield: true,
      puBomb: true,
      puBuddy: true,
      puLightning: true,
      explosion: Array.from({ length: 20 }, () => true),
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
    const ops = buildFrame(state, initStarfield(CANVAS_W, CANVAS_H), {
      loaded,
      width: CANVAS_W,
      height: CANVAS_H,
    });
    const calls = draw(ops).filter(
      (c) => !["save", "restore", "translate", "scale"].includes(c.fn)
    );
    expect(calls).toHaveLength(ops.length);
    const kindFor: Record<DrawOp["k"], string> = {
      fill: "drawColor",
      rect: "drawRect",
      circle: "drawCircle",
      image: "drawImageRect",
      poly: "drawPath",
    };
    expect(calls.map((c) => c.fn)).toEqual(ops.map((o) => kindFor[o.k]));
  });
});

describe("drawImagesOf / sameDrawImages", () => {
  const set = (explosionFrames: unknown[], playerShip: unknown = img("p")) =>
    ({
      playerShip,
      buddyShip: null,
      enemyGrunt: null,
      enemyElite: null,
      enemyBoss: null,
      enemyCarrier: null,
      bulletPlayer: null,
      bulletEnemy: null,
      bulletCharge: null,
      puShield: null,
      puBomb: null,
      puBuddy: null,
      puLightning: null,
      explosionFrames,
    }) as unknown as Parameters<typeof drawImagesOf>[0];

  it("maps the image hook to the display list's sprite keys", () => {
    const frames = [img("f0")];
    const d = drawImagesOf(set(frames));
    expect(d.explosion).toBe(frames);
    expect(d.playerShip).toMatchObject({ id: "p" });
  });

  it("is the same set only when every slot holds the same image", () => {
    const p = img("p");
    const f = [img("f0"), null];
    expect(sameDrawImages(drawImagesOf(set(f, p)), drawImagesOf(set([...f], p)))).toBe(true);
    expect(sameDrawImages(drawImagesOf(set(f, p)), drawImagesOf(set(f, img("p2"))))).toBe(false);
    expect(sameDrawImages(drawImagesOf(set(f, p)), drawImagesOf(set([f[0], img("f1")], p)))).toBe(
      false
    );
    expect(sameDrawImages(drawImagesOf(set(f, p)), drawImagesOf(set([f[0]], p)))).toBe(false);
  });
});
