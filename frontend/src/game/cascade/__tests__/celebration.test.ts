/**
 * #3699: the win celebration's timeline (`celebration.ts`), owner pick A "Spotlight" with C's
 * cheering face. The board draws whatever these numbers say (`render/drawCelebration.ts`).
 */
import {
  CELEBRATION_CARD_MS,
  CELEBRATION_CARD_MS_REDUCED,
  CELEBRATION_START_MS,
  CELEBRATION_TARGET,
  DIM_MAX,
  LIFT_SCALE,
  PULSE_AMPLITUDE,
  SWIRL_COUNT,
  SWIRL_STRIDE,
  TWINKLE_COUNT,
  TWINKLE_STRIDE,
  celebrationCardMs,
  celebrationPose,
  celebrationRemainingMs,
  createCelebrationPose,
  swirlTable,
  twinkleAlpha,
  twinkleTable,
  type CelebrationPose,
} from "../celebration";
import { CAPSTONE_RASTER_SCALE } from "../art/sprites";
import { FLOOR_THICKNESS, OVERFLOW_LINE_Y, WORLD_HEIGHT, WORLD_WIDTH } from "../constants";

jest.mock("@shopify/react-native-skia", () => ({}));

function poseAt(t: number, reduced = false): CelebrationPose | null {
  const out = createCelebrationPose();
  return celebrationPose(t, reduced, out) ? out : null;
}

describe("timings", () => {
  it("the card comes at 2.1 s, or 1.6 s under Reduce Motion", () => {
    expect(celebrationCardMs(false)).toBe(2100);
    expect(celebrationCardMs(true)).toBe(1600);
    expect(CELEBRATION_CARD_MS).toBe(2100);
    expect(CELEBRATION_CARD_MS_REDUCED).toBe(1600);
  });

  it("time left carries over when Reduce Motion changes mid-way, never below 0", () => {
    expect(celebrationRemainingMs(0, false)).toBe(2100);
    expect(celebrationRemainingMs(1000, false)).toBe(1100);
    expect(celebrationRemainingMs(1000, true)).toBe(600);
    expect(celebrationRemainingMs(1800, true)).toBe(0);
    expect(celebrationRemainingMs(-50, true)).toBe(1600);
  });

  it("draws nothing before the capstone has grown in (400 ms), or with no win", () => {
    expect(poseAt(-1)).toBeNull();
    expect(poseAt(0)).toBeNull();
    expect(poseAt(CELEBRATION_START_MS - 1)).toBeNull();
    expect(poseAt(Number.NaN)).toBeNull();
    expect(poseAt(CELEBRATION_START_MS)).not.toBeNull();
  });
});

describe("with motion", () => {
  it("dims the pile to 68 % by 700 ms", () => {
    expect(poseAt(400)!.dim).toBe(0);
    expect(poseAt(550)!.dim).toBeCloseTo(DIM_MAX / 2);
    expect(poseAt(700)!.dim).toBeCloseTo(DIM_MAX);
    expect(poseAt(2000)!.dim).toBeCloseTo(DIM_MAX);
  });

  it("lifts the capstone to the centre at 1.32x by 850 ms, upright", () => {
    const start = poseAt(400)!;
    expect(start.lift).toBeCloseTo(0);
    expect(start.scale).toBeCloseTo(1);
    expect(start.upright).toBeCloseTo(0);
    // easeOutBack overshoots a little on the way.
    const mid = poseAt(700)!;
    expect(mid.lift).toBeGreaterThan(1);
    const end = poseAt(850)!;
    expect(end.lift).toBeCloseTo(1);
    expect(end.scale).toBeCloseTo(LIFT_SCALE);
    expect(end.upright).toBe(1);
    expect(CELEBRATION_TARGET).toEqual({
      x: WORLD_WIDTH / 2,
      y: (OVERFLOW_LINE_Y + WORLD_HEIGHT - FLOOR_THICKNESS) / 2,
    });
  });

  it("pulses twice (+-5 %) then settles at 1.32x for the card", () => {
    const scales: number[] = [];
    for (let t = 850; t <= 2100; t += 5) scales.push(poseAt(t)!.scale);
    // Two full pulses; the third swing is damped to almost nothing as it settles.
    const peaks = scales.filter(
      (s, i) => i > 0 && i < scales.length - 1 && s > scales[i - 1]! && s >= scales[i + 1]!
    );
    expect(peaks.filter((s) => s > LIFT_SCALE + PULSE_AMPLITUDE / 2)).toHaveLength(2);
    expect(peaks.every((s) => s <= LIFT_SCALE + PULSE_AMPLITUDE + 1e-9)).toBe(true);
    expect(Math.max(...scales)).toBeLessThanOrEqual(LIFT_SCALE + PULSE_AMPLITUDE + 1e-9);
    expect(poseAt(2100)!.scale).toBeCloseTo(LIFT_SCALE);
  });

  it("never draws the capstone bigger than its celebration raster (sharp, never scaled up)", () => {
    for (let t = 400; t <= 2500; t += 1) {
      expect(poseAt(t)!.scale).toBeLessThan(CAPSTONE_RASTER_SCALE);
    }
  });

  it("fades in the glow, ring and rays from 450 ms, and the turn keeps going", () => {
    expect(poseAt(450)!.glow).toBe(0);
    expect(poseAt(800)!.glow).toBe(1);
    expect(poseAt(800)!.rays).toBe(1);
    expect(poseAt(1500)!.spin).toBeGreaterThan(poseAt(1000)!.spin);
  });

  it("swaps in the cheering face as the capstone arrives (700-850 ms)", () => {
    expect(poseAt(700)!.cheer).toBe(0);
    expect(poseAt(775)!.cheer).toBeCloseTo(0.5);
    expect(poseAt(850)!.cheer).toBe(1);
    expect(poseAt(2100)!.cheer).toBe(1);
  });

  it("twinkles over the pile, each a 700 ms fade in and out", () => {
    expect(poseAt(1000)!.twinkle).toBe(1);
    expect(twinkleAlpha(1000, 1000, 1)).toBe(0);
    expect(twinkleAlpha(1350, 1000, 1)).toBeCloseTo(1);
    expect(twinkleAlpha(1700, 1000, 1)).toBe(0);
    expect(twinkleAlpha(1350, 1000, 0.5)).toBeCloseTo(0.5);
  });
});

describe("Reduce Motion: the calm version", () => {
  it("no rise, rotation, pulse, rays or twinkles at any time", () => {
    for (let t = 400; t <= 2500; t += 10) {
      const p = poseAt(t, true)!;
      expect(p).toMatchObject({ lift: 0, scale: 1, upright: 0, rays: 0, spin: 0, twinkle: 0 });
    }
  });

  it("the dim, glow, ring and cheering face fade in where the capstone lies (400-600 ms)", () => {
    expect(poseAt(400, true)).toMatchObject({ dim: 0, glow: 0, cheer: 0 });
    const end = poseAt(600, true)!;
    expect(end.dim).toBeCloseTo(DIM_MAX);
    expect(end).toMatchObject({ glow: 1, cheer: 1, ring: 1.35 });
  });
});

describe("tables", () => {
  it("are the same every win, inside the bin, timed inside the celebration", () => {
    const tw = twinkleTable();
    expect(tw).toEqual(twinkleTable());
    expect(tw).toHaveLength(TWINKLE_COUNT * TWINKLE_STRIDE);
    for (let i = 0; i < TWINKLE_COUNT; i++) {
      const [x, y, t0, size] = tw.slice(i * TWINKLE_STRIDE, (i + 1) * TWINKLE_STRIDE);
      expect(x).toBeGreaterThanOrEqual(30);
      expect(x).toBeLessThanOrEqual(370);
      expect(y).toBeGreaterThanOrEqual(100);
      expect(y).toBeLessThanOrEqual(570);
      expect(t0! + 700).toBeLessThanOrEqual(CELEBRATION_CARD_MS + 300);
      expect(size).toBeGreaterThan(0);
    }
    const sw = swirlTable();
    expect(sw).toEqual(swirlTable());
    expect(sw).toHaveLength(SWIRL_COUNT * SWIRL_STRIDE);
    for (let i = 0; i < SWIRL_COUNT; i++) {
      expect([0, 1, 2]).toContain(sw[i * SWIRL_STRIDE]);
      expect(sw[i * SWIRL_STRIDE + 1]).toBeGreaterThanOrEqual(0);
      expect(sw[i * SWIRL_STRIDE + 1]).toBeLessThan(1);
    }
  });
});
