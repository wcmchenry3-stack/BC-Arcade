/**
 * #2960: the board's UI-thread renderer, against a recording canvas. Ported from the #3694 tests
 * of the declarative `LidLine` / `OverLidWash` / `Spawner` components it replaces, with the same
 * expectations, plus the pieces `PieceRenderer` drew. Pixel parity with the old renderer was
 * checked headlessly (see the PR); these pin what is drawn, in what order, with which paint.
 */
import { drawFrame, containRect, type BoardStyle } from "../drawFrame";
import { buildBoardStyle } from "../boardStyle";
import { createFramePacker, packFrame, type FramePiece } from "../frame";
import { CASCADE_LID_PALETTE } from "../../../../theme/theme.cascade";
import { LID_LINE, SPAWNER } from "../../lidVisuals";
import { tierRadius } from "../../tiers";

interface PaintState {
  color: string;
  alpha: number;
  style: "fill" | "stroke";
  strokeWidth: number;
  strokeCap: string;
  dash: unknown;
  mask: unknown;
  antiAlias: boolean;
}

jest.mock("@shopify/react-native-skia", () => {
  const fresh = () => ({
    color: "black",
    alpha: 1,
    style: "fill",
    strokeWidth: 0,
    strokeCap: "butt",
    dash: null,
    mask: null,
    antiAlias: false,
  });
  const makePaint = () => {
    const st = fresh();
    return {
      st,
      reset: () => Object.assign(st, fresh()),
      setAntiAlias: (v: boolean) => (st.antiAlias = v),
      setColor: (c: string) => {
        st.color = c;
        st.alpha = 1;
      },
      getAlphaf: () => st.alpha,
      setAlphaf: (a: number) => (st.alpha = a),
      setStyle: (s: number) => (st.style = s === 1 ? "stroke" : "fill"),
      setStrokeWidth: (w: number) => (st.strokeWidth = w),
      setStrokeCap: (c: number) => (st.strokeCap = c === 1 ? "round" : "other"),
      setPathEffect: (e: unknown) => (st.dash = e),
      setMaskFilter: (m: unknown) => (st.mask = m),
    };
  };
  return {
    Skia: {
      Paint: makePaint,
      Color: (c: string) => c,
      XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      PathEffect: {
        MakeDash: (intervals: number[], phase: number) => ({ dash: intervals, phase }),
      },
      MaskFilter: {
        MakeBlur: (style: number, sigma: number, ctm: boolean) => ({ blur: sigma, style, ctm }),
      },
      Path: { MakeFromSVGString: (svg: string) => ({ svg, dispose: jest.fn() }) },
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    StrokeCap: { Butt: 0, Round: 1, Square: 2 },
    BlurStyle: { Normal: 0, Solid: 1, Outer: 2, Inner: 3 },
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0 },
  };
});

type Op =
  | { k: "circle"; cx: number; cy: number; r: number; p: PaintState }
  | { k: "line"; x0: number; y0: number; x1: number; y1: number; p: PaintState }
  | { k: "path"; svg: string; p: PaintState }
  | {
      k: "image";
      img: unknown;
      dst: { x: number; y: number; width: number; height: number };
      p: PaintState;
    };

function recorder() {
  const ops: Op[] = [];
  const snap = (paint: { st: PaintState }) => ({ ...paint.st });
  const canvas = {
    drawCircle: (cx: number, cy: number, r: number, paint: { st: PaintState }) =>
      ops.push({ k: "circle", cx, cy, r, p: snap(paint) }),
    drawLine: (x0: number, y0: number, x1: number, y1: number, paint: { st: PaintState }) =>
      ops.push({ k: "line", x0, y0, x1, y1, p: snap(paint) }),
    drawPath: (path: { svg: string }, paint: { st: PaintState }) =>
      ops.push({ k: "path", svg: path.svg, p: snap(paint) }),
    drawImageRectOptions: (
      img: unknown,
      _src: unknown,
      dst: { x: number; y: number; width: number; height: number },
      _f: unknown,
      _m: unknown,
      paint: { st: PaintState }
    ) => ops.push({ k: "image", img, dst, p: snap(paint) }),
  };
  return { ops, canvas: canvas as never };
}

const palette = CASCADE_LID_PALETTE.light;
const NONE: null[] = [];

function frameOf(
  pieces: FramePiece[],
  { dangerRatio = 0, canDrop = true, spawnerTier = 0 } = {}
): Float64Array {
  const packer = createFramePacker();
  packFrame(packer, { pieces, dangerRatio, canDrop }, spawnerTier);
  return packer.buf.slice(0, packer.length);
}

function draw(frame: Float64Array, images: readonly unknown[] = NONE, style?: BoardStyle) {
  const { ops, canvas } = recorder();
  drawFrame(canvas, frame, style ?? buildBoardStyle([], palette), images as never);
  return ops;
}

const piece = (id: number, tier: number, x: number, y: number): FramePiece => ({
  id,
  tier,
  x,
  y,
  angle: 0,
  isSleeping: false,
});

const atSpawner = (ops: Op[]) =>
  ops.filter(
    (o): o is Extract<Op, { k: "circle" }> =>
      o.k === "circle" && o.cx === SPAWNER.cx && o.cy === SPAWNER.cy
  );
const ringCircles = (ops: Op[]) => atSpawner(ops).filter((c) => c.r === SPAWNER.ringRadius);
const ghostOutline = (ops: Op[]) =>
  atSpawner(ops).find((c) => c.p.style === "stroke" && c.r !== SPAWNER.ringRadius);
const lines = (ops: Op[]) => ops.filter((o): o is Extract<Op, { k: "line" }> => o.k === "line");
const paths = (ops: Op[]) => ops.filter((o): o is Extract<Op, { k: "path" }> => o.k === "path");

describe("pieces", () => {
  it("draws a placeholder circle at exactly the ladder radius, anti-aliased", () => {
    const ops = draw(frameOf([piece(1, 3, 120, 400)]));
    expect(ops[0]).toMatchObject({ k: "circle", cx: 120, cy: 400, r: tierRadius(3) });
    expect(ops[0]!.p).toMatchObject({ style: "fill", alpha: 1, antiAlias: true });
  });

  it("draws a decoded sprite into radius x bakedClipR, centred on the piece", () => {
    const img = { width: () => 512, height: () => 512 };
    const images = [null, null, img];
    const style = buildBoardStyle([undefined, undefined, { bakedClipR: 1.5 }], palette);
    const ops = draw(frameOf([piece(1, 2, 200, 300)]), images, style);
    const half = tierRadius(2) * 1.5;
    expect(ops[0]).toMatchObject({
      k: "image",
      img,
      dst: { x: 200 - half, y: 300 - half, width: half * 2, height: half * 2 },
    });
  });

  it("skips a tier the ladder does not have", () => {
    const ops = draw(frameOf([piece(1, 42, 120, 400)]));
    expect(ops.filter((o) => o.k === "circle" && o.cx === 120)).toHaveLength(0);
  });

  it("draws the pieces first, then the lid line, then the spawner", () => {
    const ops = draw(frameOf([piece(1, 0, 120, 400)]));
    const kinds = ops.map((o) => o.k);
    expect(kinds.indexOf("circle")).toBe(0);
    expect(kinds.indexOf("line")).toBe(1);
    expect(ops.slice(2).every((o) => o.k === "circle" || o.k === "path" || o.k === "image")).toBe(
      true
    );
  });
});

describe("over-lid wash", () => {
  const washOf = (ops: Op[]) =>
    ops.filter((o) => o.k === "circle" && o.cx === 100 && o.p.color === palette.danger);

  // Every circle at the piece, whatever its colour: only the piece's own body may be there.
  const bodyOnly = (ops: Op[], y: number) => {
    const circles = ops.filter(
      (o): o is Extract<Op, { k: "circle" }> => o.k === "circle" && o.cx === 100 && o.cy === y
    );
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({ r: tierRadius(0), p: { style: "fill", alpha: 1 } });
    expect(circles[0]!.p.color).not.toBe(palette.danger);
  };

  it("draws nothing while calm", () => {
    bodyOnly(draw(frameOf([piece(1, 0, 100, 40)])), 40);
  });

  it("draws a red wash and outline on a piece over the lid while the count runs", () => {
    const wash = washOf(draw(frameOf([piece(1, 0, 100, 40)], { dangerRatio: 0.5 })));
    expect(wash).toHaveLength(2);
    expect(wash.some((c) => c.p.style === "stroke")).toBe(true);
  });

  it("draws nothing on a piece under the lid", () => {
    bodyOnly(draw(frameOf([piece(1, 0, 100, 400)], { dangerRatio: 0.9 })), 400);
  });
});

describe("lid line", () => {
  it("is a solid line across the bin at the lid, calm colour when safe", () => {
    const [line] = lines(draw(frameOf([])));
    expect(line).toMatchObject({
      x0: LID_LINE.x1,
      y0: LID_LINE.y,
      x1: LID_LINE.x2,
      y1: LID_LINE.y,
    });
    expect(line!.p.color).toBe(palette.lid);
    expect(line!.p.strokeWidth).toBeGreaterThanOrEqual(2);
    expect(line!.p.strokeCap).toBe("round");
    expect(line!.p.alpha).toBe(1);
  });

  it("is red at the end of the countdown", () => {
    expect(lines(draw(frameOf([], { dangerRatio: 1 })))[0]!.p.color).toBe(palette.danger);
  });
});

describe("spawner", () => {
  const color = buildBoardStyle([], palette).color[0];

  it("calm and ready: the piece at full opacity inside a full cyan ring, no ghost", () => {
    const ops = draw(frameOf([]));
    const fill = atSpawner(ops).find((c) => c.p.color === color)!;
    expect(fill.p.alpha).toBe(1);
    expect(ghostOutline(ops)).toBeUndefined();
    expect(ringCircles(ops).map((c) => c.p.color)).toEqual([palette.ink, palette.ringSafe]);
    expect(paths(ops)).toHaveLength(0);
  });

  it("waiting (canDrop false): a dashed, faded ghost", () => {
    const ops = draw(frameOf([], { canDrop: false }));
    const fill = atSpawner(ops).find((c) => c.p.color === color)!;
    expect(fill.p.alpha).toBeLessThan(0.5);
    expect(ghostOutline(ops)!.p.dash).toEqual({ dash: [4, 4], phase: 0 });
  });

  it("danger 0.5: half the ring left as a clockwise arc, no glow", () => {
    const ops = draw(frameOf([], { dangerRatio: 0.5 }));
    const [arc] = paths(ops);
    expect(arc!.svg).toMatch(/^M /);
    expect(arc!.p.strokeCap).toBe("round");
    expect(arc!.p.mask).toBeNull();
    expect(ringCircles(ops)).toHaveLength(1); // only the track
  });

  it("danger 0.9: a short red arc with a glow", () => {
    const [arc] = paths(draw(frameOf([], { dangerRatio: 0.9, canDrop: false })));
    expect(arc!.p.color).toBe(palette.danger);
    expect(arc!.p.mask).toEqual({ blur: 4, style: 1, ctm: true });
  });

  it("game over: only the empty track", () => {
    const ops = draw(frameOf([], { dangerRatio: 1, canDrop: false }));
    expect(paths(ops)).toHaveLength(0);
    expect(ringCircles(ops)).toHaveLength(1);
  });

  it("draws a decoded sprite instead of the plain circle, sized by bakedClipR", () => {
    const img = { width: () => 1, height: () => 1 };
    const style = buildBoardStyle([{ bakedClipR: 1.5 }], palette);
    const ops = draw(frameOf([]), [img], style);
    const sprite = ops.find((o) => o.k === "image") as Extract<Op, { k: "image" }>;
    expect(sprite.dst.width).toBe(22 * 1.5 * 2);
    expect(atSpawner(ops).find((c) => c.p.color === color)).toBeUndefined();
  });

  it("no spawner piece (tier -1): the ring only", () => {
    const ops = draw(frameOf([], { spawnerTier: -1 }));
    expect(atSpawner(ops).every((c) => c.r === SPAWNER.ringRadius)).toBe(true);
  });
});

describe("containRect", () => {
  it("fits a wide image into the square, centred", () => {
    expect(containRect(200, 100, 0, 0, 50, 50)).toEqual({ x: 0, y: 12.5, width: 50, height: 25 });
  });

  it("fills the box for an image with no size", () => {
    expect(containRect(0, 0, 1, 2, 3, 4)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
