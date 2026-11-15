/**
 * #3699: the win celebration over the board (`drawCelebration.ts`), against a recording canvas.
 * Pins what is drawn, where, and how much: the per-frame draw budget (about 40 extra draws on
 * Fruits, about 120 on Cosmos), and the calm Reduce Motion version.
 */
import { drawCelebration, type CelebrationStyle } from "../drawCelebration";
import { drawFrame } from "../drawFrame";
import { buildBoardStyle } from "../boardStyle";
import { createFramePacker, packFrame, type FramePiece } from "../frame";
import {
  CELEBRATION_TARGET,
  LIFT_SCALE,
  RAY_COUNT,
  SWIRL_COUNT,
  swirlTable,
  twinkleTable,
} from "../../celebration";
import { CAPSTONE_TIER, tierDrawnRadius } from "../../tiers";
import { CASCADE_CELEBRATION, CASCADE_LID_PALETTE } from "../../../../theme/theme.cascade";

interface PaintState {
  color: string;
  alpha: number;
  style: "fill" | "stroke";
  shader: unknown;
}

jest.mock("@shopify/react-native-skia", () => {
  const fresh = () => ({ color: "black", alpha: 1, style: "fill", shader: null });
  return {
    Skia: {
      Paint: () => {
        const st = fresh();
        return {
          st,
          reset: () => Object.assign(st, fresh()),
          setAntiAlias: () => undefined,
          setColor: (c: string) => (st.color = c),
          setAlphaf: (a: number) => (st.alpha = a),
          getAlphaf: () => st.alpha,
          setStyle: (s: number) => (st.style = s === 1 ? "stroke" : "fill"),
          setStrokeWidth: () => undefined,
          setStrokeCap: () => undefined,
          setShader: (s: unknown) => (st.shader = s),
          setPathEffect: () => undefined,
          setMaskFilter: () => undefined,
        };
      },
      Color: (c: string) => c,
      XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      Path: { MakeFromSVGString: () => null },
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    ClipOp: { Difference: 0, Intersect: 1 },
    StrokeCap: { Butt: 0, Round: 1 },
    BlurStyle: { Solid: 1 },
    FilterMode: { Linear: 1 },
    MipmapMode: { None: 0 },
  };
});

type Op =
  | { k: "circle"; cx: number; cy: number; r: number; p: PaintState }
  | { k: "rect"; p: PaintState }
  | { k: "path"; path: unknown; p: PaintState }
  | { k: "image"; img: unknown; p: PaintState }
  | { k: "line" }
  | { k: "save" | "restore" | "clip" }
  | { k: "translate"; x: number; y: number }
  | { k: "scale"; x: number; y: number }
  | { k: "rotate"; deg: number };

function recorder() {
  const ops: Op[] = [];
  const snap = (paint: { st: PaintState }) => ({ ...paint.st });
  const canvas = {
    drawCircle: (cx: number, cy: number, r: number, paint: { st: PaintState }) =>
      ops.push({ k: "circle", cx, cy, r, p: snap(paint) }),
    drawRect: (_r: unknown, paint: { st: PaintState }) => ops.push({ k: "rect", p: snap(paint) }),
    drawPath: (path: unknown, paint: { st: PaintState }) =>
      ops.push({ k: "path", path, p: snap(paint) }),
    drawLine: () => ops.push({ k: "line" }),
    drawImageRectOptions: (
      img: unknown,
      _s: unknown,
      _d: unknown,
      _f: unknown,
      _m: unknown,
      paint: { st: PaintState }
    ) => ops.push({ k: "image", img, p: snap(paint) }),
    save: () => ops.push({ k: "save" }),
    clipRect: () => ops.push({ k: "clip" }),
    restore: () => ops.push({ k: "restore" }),
    saveLayer: () => ops.push({ k: "save" }),
    translate: (x: number, y: number) => ops.push({ k: "translate", x, y }),
    scale: (x: number, y: number) => ops.push({ k: "scale", x, y }),
    rotate: (deg: number) => ops.push({ k: "rotate", deg }),
  };
  return { ops, canvas: canvas as never };
}

const img = (name: string) => ({ image: { name }, src: {}, dst: {} });
const RAY_PATH = { name: "ray" };
const SPARKLE_PATH = { name: "sparkle" };
const GLOW = { name: "glowShader" };
const RAYS = { name: "rayShader" };

function styleOf(
  kind: "rays" | "swirl",
  reduceMotion = false,
  layers = true
): CelebrationStyle & { body: ReturnType<typeof img> } {
  const set = CASCADE_CELEBRATION.sets[kind === "rays" ? "fruits" : "cosmos"];
  const theme = CASCADE_CELEBRATION.themes.light;
  return {
    kind,
    reduceMotion,
    tier: CAPSTONE_TIER,
    radius: tierDrawnRadius(CAPSTONE_TIER),
    body: layers ? img("body") : null,
    light: layers ? img("light") : null,
    top: layers ? img("top") : null,
    cheer: layers ? img("cheer") : null,
    placeholder: "#e76f00",
    dim: theme.dim,
    ring: theme.ring,
    rays: set.rays,
    glow: set.glow,
    sparkle: set.sparkle,
    dimRect: {} as never,
    glowShader: GLOW as never,
    rayShader: RAYS as never,
    rayPath: RAY_PATH as never,
    sparklePath: SPARKLE_PATH as never,
    twinkles: twinkleTable(),
    swirl: swirlTable(),
  } as never;
}

const CAP = { id: 9, tier: CAPSTONE_TIER, x: 130, y: 470, angle: 0.6 };
const OTHER = { id: 2, tier: 4, x: 300, y: 520, angle: 0 };

function frameOf(pieces: FramePiece[]): Float64Array {
  const packer = createFramePacker();
  packFrame(packer, { pieces }, -1);
  return packer.buf.slice(0, packer.length);
}
const FRAME = frameOf([OTHER, CAP]);

function draw(t: number, style: CelebrationStyle, frame = FRAME) {
  const { ops, canvas } = recorder();
  drawCelebration(canvas, frame, style, t);
  return ops;
}
const DRAWS = new Set(["circle", "rect", "path", "image"]);
const draws = (ops: Op[]) => ops.filter((o) => DRAWS.has(o.k));
const imagesOf = (ops: Op[]) =>
  ops.filter((o): o is Extract<Op, { k: "image" }> => o.k === "image");

describe("drawCelebration", () => {
  it("draws nothing before 400 ms (the capstone is still growing in) or with no win", () => {
    expect(draw(0, styleOf("rays"))).toEqual([]);
    expect(draw(399, styleOf("rays"))).toEqual([]);
    expect(draw(-1, styleOf("rays"))).toEqual([]);
  });

  it("clips to the bin's cavity, then dims the pile first, in the theme's page colour", () => {
    const ops = draw(1000, styleOf("rays"));
    expect(ops.slice(0, 2)).toEqual([{ k: "save" }, { k: "clip" }]);
    expect(ops.at(-1)).toEqual({ k: "restore" });
    expect(ops[2]).toMatchObject({ k: "rect", p: { color: "#f5ecd7" } });
    expect((ops[2] as { p: PaintState }).p.alpha).toBeCloseTo(0.68);
  });

  it("raises the capstone to the board centre at 1.32x, upright, with the cheering face", () => {
    const style = styleOf("rays");
    const ops = draw(900, style);
    const at = ops.findIndex((o) => o.k === "image") - 3; // save, translate, scale, rotate
    expect(ops[at - 1]).toEqual({ k: "save" });
    expect(ops[at]).toMatchObject({ k: "translate" });
    const tr = ops[at] as { x: number; y: number };
    expect(tr.x).toBeCloseTo(CELEBRATION_TARGET.x, 0);
    expect(tr.y).toBeCloseTo(CELEBRATION_TARGET.y, 0);
    const sc = ops[at + 1] as { x: number };
    expect(sc.x).toBeGreaterThan(LIFT_SCALE - 0.06);
    expect(ops[at + 2]).toEqual({ k: "rotate", deg: 0 });
    // Body and light, then the cheering face fully in (the capstone's own face is gone).
    expect(imagesOf(ops).map((o) => (o.img as { name: string }).name)).toEqual([
      "body",
      "light",
      "cheer",
    ]);
  });

  it("cross-fades the face: both faces mid-way, alphas adding to 1", () => {
    const faces = imagesOf(draw(775, styleOf("rays"))).slice(2);
    expect(faces.map((o) => (o.img as { name: string }).name)).toEqual(["top", "cheer"]);
    expect(faces[0]!.p.alpha + faces[1]!.p.alpha).toBeCloseTo(1);
  });

  it("Fruits: 12 sun rays with the fading shader, the glow, and the gold ring", () => {
    const ops = draw(1000, styleOf("rays"));
    const rays = ops.filter((o) => o.k === "path" && o.path === RAY_PATH);
    expect(rays).toHaveLength(RAY_COUNT);
    expect((rays[0] as { p: PaintState }).p.shader).toBe(RAYS);
    const glow = ops.filter((o) => o.k === "circle" && o.p.shader === GLOW);
    expect(glow).toHaveLength(1);
    const ring = ops.filter((o) => o.k === "circle" && o.p.style === "stroke");
    expect(ring).toHaveLength(1);
    expect((ring[0] as { p: PaintState }).p.color).toBe("#8a6100");
  });

  it("Cosmos: the galaxy swirl's 90 stars around the capstone", () => {
    const ops = draw(1000, styleOf("swirl"));
    expect(ops.filter((o) => o.k === "path" && o.path === RAY_PATH)).toHaveLength(0);
    const stars = ops.filter(
      (o) => o.k === "circle" && o.p.shader === null && o.p.style === "fill" && o.r > 0.5
    );
    expect(stars.length).toBeGreaterThanOrEqual(SWIRL_COUNT);
  });

  it("twinkles light up over the pile while they run", () => {
    const sparkles = (t: number) =>
      draw(t, styleOf("rays")).filter((o) => o.k === "path" && o.path === SPARKLE_PATH).length;
    expect(sparkles(650)).toBe(0);
    expect(sparkles(1300)).toBeGreaterThan(3);
  });

  // The per-frame cost the owner's notes estimated: ~40 extra draws on Fruits, ~120 on Cosmos.
  it("stays inside its draw budget at every frame", () => {
    let maxRays = 0;
    let maxSwirl = 0;
    for (let t = 400; t <= 2100; t += 1000 / 60) {
      maxRays = Math.max(maxRays, draws(draw(t, styleOf("rays"))).length);
      maxSwirl = Math.max(maxSwirl, draws(draw(t, styleOf("swirl"))).length);
    }
    // The peak frame measures 39 (Fruits) and 117 (Cosmos) draws.
    expect(maxRays).toBeLessThanOrEqual(42);
    expect(maxSwirl).toBeLessThanOrEqual(120);
  });

  it("Reduce Motion: no rise, rays, swirl, twinkles or turn; the face and halo fade in in place", () => {
    for (const kind of ["rays", "swirl"] as const) {
      const ops = draw(1000, styleOf(kind, true));
      expect(ops.filter((o) => o.k === "path")).toHaveLength(0);
      const tr = ops.find((o) => o.k === "translate" && (o as { x: number }).x === CAP.x);
      expect(tr).toMatchObject({ x: CAP.x, y: CAP.y });
      expect(ops.find((o) => o.k === "scale" && (o as { x: number }).x === 1)).toBeTruthy();
      // The capstone keeps the angle it came to rest at.
      expect(ops.filter((o) => o.k === "rotate")[0]).toEqual({
        k: "rotate",
        deg: (CAP.angle * 180) / Math.PI,
      });
      expect(imagesOf(ops).map((o) => (o.img as { name: string }).name)).toEqual([
        "body",
        "light",
        "cheer",
      ]);
      expect(draws(ops).length).toBeLessThanOrEqual(8);
    }
  });

  it("a capstone that could not be drawn is a placeholder circle", () => {
    const ops = draw(1000, styleOf("rays", false, false));
    expect(ops.at(-2)).toMatchObject({ k: "circle", p: { color: "#e76f00" } });
  });

  it("draws only the dim and twinkles when the frame has no capstone", () => {
    const ops = draw(1000, styleOf("rays"), frameOf([OTHER]));
    expect(ops.filter((o) => o.k === "image")).toHaveLength(0);
  });
});

describe("drawFrame's hideTier (#3699)", () => {
  it("leaves the capstone out for the celebration to draw above its dim", () => {
    const style = buildBoardStyle(CASCADE_LID_PALETTE.light);
    const circlesAt = (hide?: number) => {
      const { ops, canvas } = recorder();
      drawFrame(canvas, FRAME, style, [] as never, hide);
      return ops.filter((o) => o.k === "circle" && (o.cx === CAP.x || o.cx === OTHER.x));
    };
    expect(circlesAt()).toHaveLength(2);
    expect(circlesAt(CAPSTONE_TIER)).toHaveLength(1);
    expect(circlesAt(CAPSTONE_TIER)[0]).toMatchObject({ cx: OTHER.x });
  });
});
