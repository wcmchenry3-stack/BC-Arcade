/**
 * #3701: the board's motion, against a recording canvas. Pins what each moment draws with motion
 * and under Reduce Motion, and that a board with no motion draws exactly as before.
 */
import { drawFrame } from "../drawFrame";
import { buildBoardStyle } from "../boardStyle";
import { createFramePacker, packFrame, type FramePiece } from "../frame";
import type { BoardMotion, ChainGlyphs } from "../drawMotion";
import { CASCADE_LID_PALETTE, CASCADE_MOTION } from "../../../../theme/theme.cascade";
import { LID_LINE, SPAWNER } from "../../lidVisuals";
import { DANGER_IDLE_PHASE, MOTION, burstAlpha, burstScale } from "../../motion";
import { AIM_STATE } from "../../aim";
import {
  MOTION_KIND,
  createMotionLog,
  emptyStamps,
  pushMotion,
  stampSlots,
  type MotionKind,
} from "../../motionLog";
import { CAPSTONE_TIER, tierDrawnRadius } from "../../tiers";

jest.mock("@shopify/react-native-skia", () => {
  const makePaint = () => {
    const st = { color: "", alpha: 1, style: "fill", width: 0, dash: null as unknown };
    return {
      st,
      reset: () => Object.assign(st, { color: "", alpha: 1, style: "fill", width: 0, dash: null }),
      setAntiAlias: () => undefined,
      setColor: (c: string) => {
        st.color = c;
        st.alpha = 1;
      },
      getAlphaf: () => st.alpha,
      setAlphaf: (a: number) => (st.alpha = a),
      setStyle: (s: number) => (st.style = s === 1 ? "stroke" : "fill"),
      setStrokeWidth: (w: number) => (st.width = w),
      setStrokeCap: () => undefined,
      setStrokeJoin: () => undefined,
      setPathEffect: (d: unknown) => (st.dash = d),
      setMaskFilter: () => undefined,
    };
  };
  return {
    Skia: {
      Paint: makePaint,
      Color: (c: string) => c,
      XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      PathEffect: { MakeDash: (intervals: number[], phase: number) => ({ intervals, phase }) },
      MaskFilter: { MakeBlur: () => ({}) },
      Path: { MakeFromSVGString: (svg: string) => ({ svg, dispose: () => undefined }) },
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    StrokeCap: { Butt: 0, Round: 1, Square: 2 },
    StrokeJoin: { Miter: 0, Round: 1, Bevel: 2 },
    BlurStyle: { Solid: 1 },
    FilterMode: { Linear: 1 },
    MipmapMode: { None: 0 },
  };
});

type P = { color: string; alpha: number; style: string; width: number; dash: unknown };
type Op =
  | { k: "circle"; x: number; y: number; r: number; p: P }
  | { k: "line"; x: number; y: number; y1: number; p: P }
  | { k: "rect"; rect: { x: number; y: number; width: number; height: number }; p: P }
  | { k: "path"; svg: string; p: P }
  | { k: "image" }
  | { k: "translate"; x: number; y: number }
  | { k: "scale"; x: number; y: number }
  | { k: "other" };

function recorder() {
  const ops: Op[] = [];
  const snap = (paint: { st: P }) => ({ ...paint.st });
  const canvas = {
    drawCircle: (x: number, y: number, r: number, p: { st: P }) =>
      ops.push({ k: "circle", x, y, r, p: snap(p) }),
    drawLine: (x: number, y: number, _x1: number, y1: number, p: { st: P }) =>
      ops.push({ k: "line", x, y, y1, p: snap(p) }),
    drawRect: (rect: Extract<Op, { k: "rect" }>["rect"], p: { st: P }) =>
      ops.push({ k: "rect", rect, p: snap(p) }),
    drawPath: (path: { svg: string }, p: { st: P }) =>
      ops.push({ k: "path", svg: path.svg, p: snap(p) }),
    drawImageRectOptions: () => ops.push({ k: "image" }),
    translate: (x: number, y: number) => ops.push({ k: "translate", x, y }),
    scale: (x: number, y: number) => ops.push({ k: "scale", x, y }),
    save: () => ops.push({ k: "other" }),
    restore: () => ops.push({ k: "other" }),
    saveLayer: () => ops.push({ k: "other" }),
    rotate: () => ops.push({ k: "other" }),
  };
  return { ops, canvas: canvas as never };
}

const lid = CASCADE_LID_PALETTE.dark;
const palette = CASCADE_MOTION.themes.dark;
const tones = CASCADE_MOTION.tones.fruits;
const glyphs: ChainGlyphs = {
  times: { svg: "times" } as never,
  digits: Array.from({ length: 10 }, (_, d) => ({ svg: `d${d}` }) as never),
  advance: 0.62,
};

/** A tier's art (3 images), so the squash's transform is visible. */
function spriteOf(tier: number) {
  const r = tierDrawnRadius(tier);
  const img = { width: () => 8, height: () => 8 };
  return {
    body: img,
    light: img,
    top: img,
    rect: [-r, -r, 2 * r, 2 * r],
    lightRect: [-r, -r, 2 * r, 2 * r],
  };
}
const SPRITES = Array.from({ length: 11 }, (_, t) => spriteOf(t));

function frameOf(pieces: FramePiece[], dangerRatio = 0, spawnerTier = 1): Float64Array {
  const packer = createFramePacker();
  packFrame(packer, { pieces, dangerRatio, canDrop: true }, spawnerTier);
  return packer.buf.slice(0, packer.length);
}

type Ev = [MotionKind, number, number, number, number, number];

/** Motion with `events` stamped at clock 0, drawn at `clock`. */
function motionAt(events: Ev[], clock: number, over: Partial<BoardMotion> = {}): BoardMotion {
  const log = createMotionLog();
  for (const e of events) pushMotion(log, ...e);
  const stamps = stampSlots(log.buf, emptyStamps(), 0) ?? emptyStamps();
  return {
    events: log.buf,
    stamps,
    clock,
    dangerPhase: DANGER_IDLE_PHASE,
    danger: 0,
    reduceMotion: false,
    tones,
    palette,
    ptPerUnit: 0.85,
    glyphs,
    ...over,
  };
}

function draw(frame: Float64Array, motion: BoardMotion | null) {
  const { ops, canvas } = recorder();
  drawFrame(canvas, frame, buildBoardStyle(lid), SPRITES as never, -1, motion);
  return ops;
}

const piece = (id: number, tier: number, x: number, y: number): FramePiece => ({
  id,
  tier,
  x,
  y,
  angle: 0,
});
const scales = (ops: Op[]) => ops.filter((o): o is Extract<Op, { k: "scale" }> => o.k === "scale");
const circles = (ops: Op[]) =>
  ops.filter((o): o is Extract<Op, { k: "circle" }> => o.k === "circle");

describe("no motion", () => {
  it("draws the same with null motion and with motion that has nothing to play", () => {
    const frame = frameOf([piece(1, 3, 200, 500)]);
    expect(draw(frame, motionAt([], 1000))).toEqual(draw(frame, null));
  });
});

describe("landing squash", () => {
  const frame = frameOf([piece(7, 5, 200, 500)], 0, -1);
  const land: Ev = [MOTION_KIND.land, 200, 500, 5, 7, 20];

  it("squashes the landed piece about its bottom (wider, shorter)", () => {
    const [sx] = scales(draw(frame, motionAt([land], 0)));
    expect(sx!.x).toBeGreaterThan(1);
    expect(sx!.y).toBeLessThan(1);
    expect(sx!.y).toBeCloseTo(1 - (0.07 + 0.012 * 5), 5);
  });

  it("is gone once the spring settles, and never drawn under Reduce Motion", () => {
    expect(scales(draw(frame, motionAt([land], MOTION.land.durationMs)))).toEqual([]);
    expect(scales(draw(frame, motionAt([land], 0, { reduceMotion: true })))).toEqual([]);
  });

  it("puffs dust either side of the contact (none under Reduce Motion)", () => {
    const dust = (m: BoardMotion) =>
      circles(draw(frame, m)).filter((c) => c.p.color === palette.dust);
    expect(dust(motionAt([land], 50))).toHaveLength(MOTION.dust.count);
    expect(dust(motionAt([land], 50, { reduceMotion: true }))).toHaveLength(0);
  });
});

describe("merge pop", () => {
  const frame = frameOf([], 0, -1);
  const merge: Ev = [MOTION_KIND.merge, 200, 400, 4, 9, 1];
  const tone = tones[4]!;

  it("a white flash, a ring in the piece's colour and 12 confetti", () => {
    const ops = circles(draw(frame, motionAt([merge], 30)));
    expect(
      ops.filter((c) => c.p.color === palette.flash && c.p.style === "fill").length
    ).toBeGreaterThanOrEqual(1);
    const ring = ops.find((c) => c.p.style === "stroke" && c.p.color === tone.b);
    expect(ring!.r).toBeGreaterThan(tierDrawnRadius(4));
    const confetti = ops.filter((c) => c.p.style === "fill" && c.r < 6);
    expect(confetti.length).toBeGreaterThanOrEqual(MOTION.merge.confetti);
  });

  it("Reduce Motion: one in-place flash of the light tone, no ring or confetti", () => {
    const ops = circles(draw(frame, motionAt([merge], 30, { reduceMotion: true })));
    expect(ops).toHaveLength(1 + 2); // the flash, plus the spawner ring and its track
    const flash = ops.find((c) => c.p.color === tone.l)!;
    expect(flash.p.style).toBe("fill");
    expect(flash.r).toBeCloseTo(tierDrawnRadius(4) * MOTION.calm.mergeFlashScale, 5);
  });
});

// #4082: the burst MergeBurst drew as a React view per merge, now drawn with the pop.
describe("merge burst", () => {
  const frame = frameOf([], 0, -1);
  const BURST = "#123456";
  const burstColors = Array.from({ length: CAPSTONE_TIER + 1 }, (_, t) =>
    t === 4 ? BURST : "#000000"
  );
  const merge: Ev = [MOTION_KIND.merge, 200, 400, 4, 9, 1];
  const ptPerUnit = 0.85;
  const discs = (m: BoardMotion) => circles(draw(frame, m)).filter((c) => c.p.color === BURST);

  it("draws one disc in the piece set's colour at the merge, sized in pt and springing out", () => {
    for (const ms of [30, 300, 900]) {
      const d = discs(motionAt([merge], ms, { burstColors, ptPerUnit }));
      expect(d).toHaveLength(1);
      expect(d[0]!.x).toBe(200);
      expect(d[0]!.y).toBe(400);
      expect(d[0]!.p.style).toBe("fill");
      expect(d[0]!.r).toBeCloseTo((MOTION.burst.size / 2 / ptPerUnit) * burstScale(ms), 6);
      expect(d[0]!.p.alpha).toBeCloseTo(burstAlpha(ms), 6);
    }
    const early = discs(motionAt([merge], 30, { burstColors, ptPerUnit }))[0]!;
    const later = discs(motionAt([merge], 300, { burstColors, ptPerUnit }))[0]!;
    expect(later.r).toBeGreaterThan(early.r);
    expect(later.p.alpha).toBeLessThan(early.p.alpha);
  });

  it("is drawn under the pop, and outlives its confetti until the fade ends", () => {
    const ops = circles(draw(frame, motionAt([merge], 30, { burstColors, ptPerUnit })));
    const disc = ops.findIndex((c) => c.p.color === BURST);
    const ring = ops.findIndex((c) => c.p.style === "stroke" && c.p.color === tones[4]!.b);
    expect(disc).toBeGreaterThanOrEqual(0);
    expect(disc).toBeLessThan(ring);
    expect(discs(motionAt([merge], MOTION.merge.confettiMs + 100, { burstColors }))).toHaveLength(
      1
    );
    expect(discs(motionAt([merge], MOTION.burst.fadeMs, { burstColors }))).toHaveLength(0);
  });

  it("one disc per merge: twelve merges in one step are twelve discs", () => {
    const twelve = Array.from({ length: 12 }, (_, i): Ev => [
      MOTION_KIND.merge,
      60 + i * 25,
      400,
      4,
      100 + i,
      i + 1,
    ]);
    expect(discs(motionAt(twelve, 100, { burstColors }))).toHaveLength(12);
  });

  it("none under Reduce Motion", () => {
    expect(discs(motionAt([merge], 30, { burstColors, reduceMotion: true }))).toHaveLength(0);
  });

  it("none for the capstone (the celebration replaces it, #3699)", () => {
    const colors = Array.from({ length: CAPSTONE_TIER + 1 }, () => BURST);
    const capstone: Ev = [MOTION_KIND.merge, 200, 400, CAPSTONE_TIER, 9, 1];
    expect(discs(motionAt([capstone], 30, { burstColors: colors }))).toHaveLength(0);
    const below: Ev = [MOTION_KIND.merge, 200, 400, CAPSTONE_TIER - 1, 9, 1];
    expect(discs(motionAt([below], 30, { burstColors: colors }))).toHaveLength(1);
  });

  it("without the set's colours it takes the tone's base colour", () => {
    // At 700 ms the pop's ring and confetti (also in the base colour) are gone.
    const d = circles(draw(frame, motionAt([merge], 700))).filter(
      (c) => c.p.style === "fill" && c.p.color === tones[4]!.b
    );
    expect(d).toHaveLength(1);
  });
});

describe("chain counter", () => {
  const frame = frameOf([], 0, -1);
  const chain: Ev[] = [
    [MOTION_KIND.drop, 0, 0, 0, 0, 0],
    [MOTION_KIND.merge, 200, 450, 1, 11, 1],
    [MOTION_KIND.merge, 200, 460, 2, 12, 2],
    [MOTION_KIND.merge, 200, 470, 3, 13, 3],
    [MOTION_KIND.merge, 200, 480, 4, 14, 4],
  ];
  const shown = (m: BoardMotion) => {
    const paths = draw(frame, m).filter((o): o is Extract<Op, { k: "path" }> => o.k === "path");
    // Two passes (outline, then fill): the second half is the text.
    return paths.slice(paths.length / 2).map((p) => p.svg);
  };

  it("steps ×2, ×3, ×4 one per 80 ms though the links came at once", () => {
    expect(shown(motionAt(chain, 0))).toEqual(["times", "d2"]);
    expect(shown(motionAt(chain, 80))).toEqual(["times", "d3"]);
    expect(shown(motionAt(chain, 160))).toEqual(["times", "d4"]);
    expect(shown(motionAt(chain, 400))).toEqual(["times", "d4"]);
  });

  it("is outlined in the newest link's dark tone and filled white", () => {
    const paths = draw(frame, motionAt(chain, 200)).filter(
      (o): o is Extract<Op, { k: "path" }> => o.k === "path"
    );
    expect(paths[0]!.p.color).toBe(tones[4]!.d);
    expect(paths[paths.length - 1]!.p.color).toBe(palette.flash);
  });

  it("leaves after its hold, and a plain merge shows none", () => {
    expect(shown(motionAt(chain, 160 + MOTION.chain.holdMs + MOTION.chain.outMs))).toEqual([]);
    expect(shown(motionAt(chain.slice(0, 2), 0))).toEqual([]);
  });

  it("a new drop starts a new chain", () => {
    expect(shown(motionAt([...chain, [MOTION_KIND.drop, 0, 0, 0, 0, 0]], 100))).toEqual([]);
  });

  // Review S1: a 6-chain's steps (80 ms) are shorter than any fade: the number must not flicker.
  it("Reduce Motion: fades in once, then never dims while the steps swap the number", () => {
    const six: Ev[] = [
      [MOTION_KIND.drop, 0, 0, 0, 0, 0],
      ...[1, 2, 3, 4, 5, 6].map((link): Ev => [MOTION_KIND.merge, 200, 450, link, 10 + link, link]),
    ];
    const alphaAt = (clock: number) => {
      const paths = draw(frame, motionAt(six, clock, { reduceMotion: true })).filter(
        (o): o is Extract<Op, { k: "path" }> => o.k === "path"
      );
      return paths.length ? paths[paths.length - 1]!.p.alpha : 0;
    };
    let peak = 0;
    for (let t = 0; t <= 4 * MOTION.chain.stepMs + MOTION.chain.holdMs - 1; t += 5) {
      const a = alphaAt(t);
      if (t >= MOTION.calm.chainFadeMs) expect(a).toBe(1);
      expect(a).toBeGreaterThanOrEqual(peak);
      peak = Math.max(peak, a);
    }
  });

  it("Reduce Motion: no pop scale, it fades in place", () => {
    const m = motionAt(chain, 0, { reduceMotion: true });
    const paths = draw(frame, m).filter((o): o is Extract<Op, { k: "path" }> => o.k === "path");
    expect(paths.every((p) => p.p.alpha === 0)).toBe(true); // 0 ms into a 150 ms fade
    const later = draw(frame, motionAt(chain, 400, { reduceMotion: true })).filter(
      (o): o is Extract<Op, { k: "path" }> => o.k === "path"
    );
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((p) => p.p.alpha === 1)).toBe(true);
  });
});

describe("danger blink (C)", () => {
  const frame = frameOf([], 0.5, 1);
  const blinkRing = (ops: Op[]) =>
    circles(ops).filter((c) => c.r === SPAWNER.ringRadius + MOTION.danger.ringGap);
  const dashed = (ops: Op[]) =>
    ops.filter((o): o is Extract<Op, { k: "line" }> => o.k === "line" && o.p.dash !== null);

  it("on-beat: an outline ring and marching dashes on the lid", () => {
    const ops = draw(frame, motionAt([], 0, { danger: 0.5, dangerPhase: 0.1 }));
    expect(blinkRing(ops)).toHaveLength(1);
    expect(dashed(ops)).toHaveLength(1);
    expect(dashed(ops)[0]!.y).toBe(LID_LINE.y);
  });

  it("off-beat, with no count, and under Reduce Motion: neither", () => {
    for (const m of [
      motionAt([], 0, { danger: 0.5, dangerPhase: 0.6 }),
      motionAt([], 0, { danger: 0, dangerPhase: DANGER_IDLE_PHASE }),
      motionAt([], 0, { danger: 0.5, dangerPhase: 0.1, reduceMotion: true }),
    ]) {
      const ops = draw(frame, m);
      expect(blinkRing(ops)).toHaveLength(0);
      expect(dashed(ops)).toHaveLength(0);
    }
  });
});

describe("game over (C)", () => {
  const frame = frameOf([piece(1, 3, 200, 500)], 1, -1);
  const over: Ev = [MOTION_KIND.gameOver, 0, 0, 0, 0, 0];
  const dim = (ops: Op[]) => ops.filter((o): o is Extract<Op, { k: "rect" }> => o.k === "rect");
  const flash = (ops: Op[]) =>
    ops.filter(
      (o): o is Extract<Op, { k: "line" }> =>
        o.k === "line" && o.p.width === MOTION.gameOver.flashWidth
    );

  it("dims the pile at once, under the lid, and flashes the lid twice", () => {
    const ops = draw(frame, motionAt([over], 0));
    expect(dim(ops)[0]!.p).toMatchObject({ color: palette.dim, alpha: MOTION.gameOver.dim });
    expect(ops.indexOf(dim(ops)[0]!)).toBeLessThan(ops.findIndex((o) => o.k === "line"));
    expect(flash(ops)).toHaveLength(1);
    expect(flash(draw(frame, motionAt([over], 200)))).toHaveLength(0);
    expect(flash(draw(frame, motionAt([over], 270)))).toHaveLength(1);
    expect(flash(draw(frame, motionAt([over], 600)))).toHaveLength(0);
    expect(dim(draw(frame, motionAt([over], 5000)))[0]!.p.alpha).toBe(MOTION.gameOver.dim);
  });

  it("Reduce Motion: the dim fades in and the lid stays a steady red", () => {
    const ops = draw(frame, motionAt([over], 150, { reduceMotion: true }));
    expect(dim(ops)[0]!.p.alpha).toBeCloseTo(0.3, 5);
    expect(flash(ops)).toHaveLength(0);
    const lines = ops.filter((o): o is Extract<Op, { k: "line" }> => o.k === "line");
    expect(lines[lines.length - 1]!.p.color).toBe(lid.danger);
  });
});

describe("next piece in the spawner (B)", () => {
  it("drops in from above after a drop; fades in place under Reduce Motion", () => {
    const frame = frameOf([], 0, 1);
    const drop: Ev = [MOTION_KIND.drop, 0, 0, 0, 0, 0];
    const at = (m: BoardMotion) =>
      draw(frame, m).filter((o): o is Extract<Op, { k: "translate" }> => o.k === "translate")[0]!;
    expect(at(motionAt([drop], 0)).y).toBeCloseTo(SPAWNER.cy - MOTION.next.spawnerDrop, 5);
    expect(at(motionAt([drop], MOTION.next.ms)).y).toBe(SPAWNER.cy);
    const calm = motionAt([drop], 75, { reduceMotion: true });
    expect(at(calm).y).toBe(SPAWNER.cy);
    const layers = draw(frame, calm).filter((o) => o.k === "other").length;
    expect(layers).toBeGreaterThan(0); // drawn through an opacity layer (half faded in)
    expect(
      draw(frame, motionAt([drop], 0, { reduceMotion: true })).some((o) => o.k === "image")
    ).toBe(false);
  });
});

// #3928: the aim guide (owner pick A): a dashed plumb line and a dashed ghost where it lands.
describe("aim guide (#3928)", () => {
  const tier = 1;
  const R = tierDrawnRadius(tier);
  const pile = [piece(1, 4, 200, 520)];
  const frame = frameOf(pile, 0, tier);
  const aimAt = (state: number, ms: number, x = 200, over: Partial<BoardMotion> = {}) =>
    motionAt([], 1000, { aim: { state, x, ms, fromX: x }, ...over });
  const guideLine = (ops: Op[]) =>
    ops.find(
      (o): o is Extract<Op, { k: "line" }> =>
        o.k === "line" && o.p.width === MOTION.aim.lineWidth && o.p.dash !== null
    );
  const ghost = (ops: Op[]) =>
    circles(ops).filter((c) => c.r === R && c.y < 520 && c.y > LID_LINE.y);

  it("aiming: a dashed line from under the piece to a ghost resting on the pile", () => {
    const ops = draw(frame, aimAt(AIM_STATE.aiming, MOTION.aim.inMs));
    const landY = 520 - (tierDrawnRadius(4) + R);
    const line = guideLine(ops)!;
    expect(line.x).toBe(200);
    expect(line.y1).toBeCloseTo(landY - R, 5);
    expect(line.p.color).toBe(lid.ink);
    expect(line.p.alpha).toBeCloseTo(MOTION.aim.lineAlpha, 5);
    const g = ghost(ops);
    expect(g.map((c) => c.y)).toEqual([expect.closeTo(landY, 5), expect.closeTo(landY, 5)]);
    expect(g[0]!.p.color).toBe(tones[tier]!.l); // the faint fill
    expect(g[1]!.p).toMatchObject({ color: lid.ink, style: "stroke" }); // the dashed outline
  });

  it("the spawner piece leaves the ring for the finger; the ring stays centred", () => {
    const ops = draw(frame, aimAt(AIM_STATE.aiming, MOTION.aim.inMs, 300));
    const t = ops.filter((o): o is Extract<Op, { k: "translate" }> => o.k === "translate");
    expect(t[t.length - 1]!.x).toBe(300);
    expect(circles(ops).some((c) => c.x === SPAWNER.cx && c.r === SPAWNER.ringRadius)).toBe(true);
  });

  it("a press that is not yet a drag (a tap) draws no guide and the piece at the finger (#4081)", () => {
    const ops = draw(frame, aimAt(AIM_STATE.pressed, 50, 320));
    expect(guideLine(ops)).toBeUndefined();
    const t = ops.filter((o): o is Extract<Op, { k: "translate" }> => o.k === "translate");
    expect(t[t.length - 1]!.x).toBe(320);
  });

  it("the dashes march with the clock; under Reduce Motion they stand still and show at once", () => {
    const a = guideLine(
      draw(frame, motionAt([], 0, { aim: { state: AIM_STATE.aiming, x: 200, ms: 500, fromX: 0 } }))
    )!;
    const b = guideLine(
      draw(
        frame,
        motionAt([], 100, { aim: { state: AIM_STATE.aiming, x: 200, ms: 500, fromX: 0 } })
      )
    )!;
    expect(a.p.dash).not.toEqual(b.p.dash);
    const calm = (clock: number) =>
      guideLine(
        draw(
          frame,
          motionAt([], clock, {
            reduceMotion: true,
            aim: { state: AIM_STATE.aiming, x: 200, ms: 0, fromX: 0 },
          })
        )
      )!;
    expect(calm(0).p.dash).toEqual(calm(100).p.dash);
    expect(calm(0).p.alpha).toBeCloseTo(MOTION.aim.lineAlpha, 5); // no fade in
  });

  it("after a release only the line fades; Reduce Motion hides it at once", () => {
    const ops = draw(frame, aimAt(AIM_STATE.released, MOTION.aim.outMs / 2));
    expect(guideLine(ops)!.p.alpha).toBeCloseTo(MOTION.aim.lineAlpha / 2, 5);
    expect(ghost(ops)).toHaveLength(0);
    expect(
      guideLine(draw(frame, aimAt(AIM_STATE.released, 0, 200, { reduceMotion: true })))
    ).toBeUndefined();
  });

  it("over the open floor the ghost rests on the floor", () => {
    const ops = draw(frame, aimAt(AIM_STATE.aiming, MOTION.aim.inMs, 330));
    const floorY = 600 - 20 - R;
    expect(circles(ops).some((c) => c.r === R && Math.abs(c.y - floorY) < 1e-6)).toBe(true);
  });
});
