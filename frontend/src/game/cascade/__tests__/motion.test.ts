/**
 * #3701: the motion timings (owner pick B for land / merge / chain / next, C for danger and game
 * over) and the pure functions every motion reads them through.
 */
import {
  BURST_SPRING_MASS,
  DANGER_IDLE_PHASE,
  MOTION,
  burstAlpha,
  burstScale,
  chainPt,
  chainStep,
  chipAnimationMs,
  dangerBlinkOn,
  dangerDashOffset,
  dangerPeriodMs,
  dropChipPose,
  easeOutBack,
  gameOverDim,
  gameOverFlashOn,
  gameOverLifetimeMs,
  hash01,
  landSquash,
  mergeLifetimeMs,
  nextChipPose,
  spawnerArrival,
  stepDangerPhase,
} from "../motion";

const arrival = () => ({ dy: 0, scale: 1, alpha: 1 });

describe("the picked numbers", () => {
  it("chain steps every 80 ms; the loss card comes at 1000 ms (C)", () => {
    expect(MOTION.chain.stepMs).toBe(80);
    expect(MOTION.gameOver.cardAtMs).toBe(1000);
    expect(MOTION.gameOver.flashes).toBe(2);
  });

  it("MergeBurst keeps its built spring and fade", () => {
    expect(MOTION.burst).toEqual({
      size: 40,
      fromScale: 0.1,
      toScale: 2.2,
      damping: 9,
      stiffness: 25,
      opacity: 0.75,
      fadeMs: 1100,
    });
  });
});

describe("landing squash (B: a damped spring, scaled by tier and speed)", () => {
  it("squashes at contact, more for a bigger tier", () => {
    expect(landSquash(0, 20, 0)).toBeCloseTo(0.07, 5);
    expect(landSquash(9, 20, 0)).toBeCloseTo(0.07 + 0.012 * 9, 5);
    expect(landSquash(9, 20, 0)).toBeGreaterThan(landSquash(0, 20, 0));
  });

  it("overshoots into a stretch, then settles to nothing", () => {
    const half = MOTION.land.periodMs / 2;
    expect(landSquash(4, 20, half)).toBeLessThan(0);
    expect(landSquash(4, 20, MOTION.land.durationMs)).toBe(0);
    expect(landSquash(4, 20, -1)).toBe(0);
  });

  it("a slow touch-down squashes less, never below the floor factor", () => {
    expect(landSquash(4, 5, 0)).toBeLessThan(landSquash(4, 20, 0));
    expect(landSquash(4, 0, 0)).toBeCloseTo(landSquash(4, 20, 0) * MOTION.land.minSpeedFactor, 6);
    expect(landSquash(4, 200, 0)).toBeCloseTo(landSquash(4, 20, 0), 6);
  });
});

describe("chain pacing (one step per chainStepMs, never ahead of the engine)", () => {
  it("a 4-chain whose links all arrived at once shows ×2, ×3, ×4 80 ms apart", () => {
    expect(chainStep(4, 0)).toBe(0);
    expect(chainStep(4, 79)).toBe(0);
    expect(chainStep(4, 80)).toBe(1);
    expect(chainStep(4, 160)).toBe(2);
    expect(chainStep(4, 10_000)).toBe(2);
  });

  it("never shows more links than the engine made; nothing below ×2", () => {
    expect(chainStep(2, 500)).toBe(0);
    expect(chainStep(1, 500)).toBe(-1);
  });

  it("grows with the chain, to a cap", () => {
    expect(chainPt(2)).toBe(24);
    expect(chainPt(4)).toBe(38);
    expect(chainPt(50)).toBe(MOTION.chain.maxPt);
  });

  it("a chain link keeps the clock running for its counter", () => {
    expect(mergeLifetimeMs(1, false)).toBe(MOTION.burst.fadeMs); // the burst outlasts the pop (#4082)
    expect(mergeLifetimeMs(4, false)).toBe(80 * 2 + 280 + 800 + 200);
    expect(mergeLifetimeMs(1, true)).toBe(MOTION.calm.mergeFlashMs);
  });
});

describe("danger blink (C: square wave, at most 3 Hz)", () => {
  it("speeds up as the count runs, and never passes 3 flashes a second", () => {
    expect(dangerPeriodMs(0)).toBe(1000);
    expect(dangerPeriodMs(1)).toBe(340);
    for (let r = 0; r <= 1.0001; r += 0.05) {
      expect(1000 / dangerPeriodMs(r)).toBeLessThanOrEqual(MOTION.danger.maxHz);
    }
    expect(1000 / dangerPeriodMs(5)).toBeLessThanOrEqual(3);
  });

  it("integrates its phase frame by frame (no jump when the ratio rises)", () => {
    let phase = 0;
    for (let i = 0; i < 30; i++) phase = stepDangerPhase(phase, 1000 / 60, 0.5);
    expect(phase).toBeCloseTo(((30 * 1000) / 60 / dangerPeriodMs(0.5)) % 1, 6);
    const before = phase;
    const after = stepDangerPhase(before, 1000 / 60, 1);
    expect(after - before).toBeCloseTo(1000 / 60 / 340, 6);
  });

  it("never resets: an off-beat waits when the count stops, a latched on-beat finishes", () => {
    expect(DANGER_IDLE_PHASE).toBe(MOTION.danger.duty);
    expect(dangerBlinkOn(DANGER_IDLE_PHASE)).toBe(false);
    expect(stepDangerPhase(0.7, 16, 0)).toBe(0.7);
    expect(stepDangerPhase(0.1, 17, 0)).toBeCloseTo(0.15, 6); // at the fastest rate
    expect(stepDangerPhase(0.49, 100, 0)).toBe(MOTION.danger.duty);
  });

  // Review S2: toggling the count on and off (a merge in the danger band pauses it) must not
  // restart the blink each time.
  it("keeps onsets at most 3 in any 1 s window when the ratio toggles at 5 Hz, 10 Hz or 30 Hz", () => {
    for (const toggleHz of [5, 10, 30]) {
      for (const ratio of [0.2, 1]) {
        let phase = DANGER_IDLE_PHASE;
        let wasOn = false;
        const onsets: number[] = [];
        const dt = 1000 / 60;
        for (let t = 0; t < 5000; t += dt) {
          const counting = Math.floor((t * toggleHz * 2) / 1000) % 2 === 0;
          phase = stepDangerPhase(phase, dt, counting ? ratio : 0);
          const on = dangerBlinkOn(phase);
          if (on && !wasOn) onsets.push(t);
          wasOn = on;
        }
        expect(onsets.length).toBeGreaterThan(1);
        for (let i = 0; i + 3 < onsets.length; i++) {
          expect(onsets[i + 3]! - onsets[i]!).toBeGreaterThan(1000);
        }
        for (let i = 1; i < onsets.length; i++) {
          expect(onsets[i]! - onsets[i - 1]!).toBeGreaterThanOrEqual(MOTION.danger.fastMs - dt);
        }
      }
    }
  });

  it("a full period at the fastest ratio has one on-beat and one off-beat", () => {
    const beats: boolean[] = [];
    let phase = 0;
    for (let t = 0; t < 340; t += 10) {
      beats.push(dangerBlinkOn(phase));
      phase = stepDangerPhase(phase, 10, 1);
    }
    const edges = beats.filter((b, i) => i > 0 && b !== beats[i - 1]).length;
    expect(edges).toBe(1);
  });

  it("the dashes march faster with the ratio, within one dash period", () => {
    const period = MOTION.danger.dashOn + MOTION.danger.dashOff;
    for (const t of [0, 123, 9999]) {
      const off = dangerDashOffset(t, 0.5);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(period);
    }
    expect(dangerDashOffset(100, 1)).toBeGreaterThan(dangerDashOffset(100, 0));
  });
});

describe("game over (C)", () => {
  it("two hard lid flashes, 140 on / 120 off, then none", () => {
    expect(gameOverFlashOn(0)).toBe(true);
    expect(gameOverFlashOn(139)).toBe(true);
    expect(gameOverFlashOn(140)).toBe(false);
    expect(gameOverFlashOn(260)).toBe(true);
    expect(gameOverFlashOn(400)).toBe(false);
    expect(gameOverFlashOn(520)).toBe(false);
    expect(gameOverFlashOn(-1)).toBe(false);
  });

  it("dims at once with motion; fades over 300 ms under Reduce Motion", () => {
    expect(gameOverDim(0, false)).toBe(0.6);
    expect(gameOverDim(0, true)).toBe(0);
    expect(gameOverDim(150, true)).toBeCloseTo(0.3, 6);
    expect(gameOverDim(300, true)).toBe(0.6);
    expect(gameOverDim(-1, false)).toBe(0);
    expect(gameOverLifetimeMs(false)).toBe(520);
    expect(gameOverLifetimeMs(true)).toBe(300);
  });
});

describe("next piece (B)", () => {
  it("the spawner piece drops in from above with an overshoot, and rests at the end", () => {
    const start = spawnerArrival(0, false, arrival());
    expect(start.dy).toBe(-MOTION.next.spawnerDrop);
    expect(start.scale).toBeCloseTo(MOTION.next.spawnerFromScale, 6);
    expect(spawnerArrival(MOTION.next.ms, false, arrival())).toEqual({ dy: 0, scale: 1, alpha: 1 });
    // easeOutBack overshoots past rest on the way.
    const peak = Math.max(
      ...Array.from({ length: 32 }, (_, i) => spawnerArrival(i * 10, false, arrival()).dy)
    );
    expect(peak).toBeGreaterThan(0);
  });

  it("under Reduce Motion it only fades in, in place", () => {
    const mid = spawnerArrival(75, true, arrival());
    expect(mid).toEqual({ dy: 0, scale: 1, alpha: 0.5 });
    expect(spawnerArrival(-1, true, arrival())).toEqual({ dy: 0, scale: 1, alpha: 1 });
  });

  it("the DROP glyph hops over from NEXT in an arc; the new NEXT pops in after 80 ms", () => {
    const start = dropChipPose(0, 70, 16 / 22, false);
    expect(start.translateX).toBe(70);
    expect(start.scale).toBeCloseTo(16 / 22, 6);
    expect(dropChipPose(MOTION.next.ms / 2, 70, 16 / 22, false).translateY).toBeCloseTo(-16, 1);
    const end = dropChipPose(MOTION.next.ms, 70, 16 / 22, false);
    expect(end.translateX).toBeCloseTo(0, 6);
    expect(end.translateY).toBeCloseTo(0, 6);
    expect(end.scale).toBeCloseTo(1, 6);
    expect(nextChipPose(79, false).opacity).toBe(0);
    expect(nextChipPose(80 + 280, false).scale).toBeCloseTo(1, 6);
    expect(chipAnimationMs(false)).toBe(360);
  });

  it("under Reduce Motion the chips cross-fade without moving", () => {
    const p = dropChipPose(75, 70, 16 / 22, true);
    expect(p).toEqual({ translateX: 0, translateY: 0, scale: 1, opacity: 0.5 });
    expect(nextChipPose(150, true)).toEqual({ translateX: 0, translateY: 0, scale: 1, opacity: 1 });
    expect(chipAnimationMs(true)).toBe(MOTION.calm.nextFadeMs);
  });
});

describe("helpers", () => {
  it("easeOutBack starts at 0, ends at 1 and overshoots", () => {
    expect(easeOutBack(0, 2)).toBeCloseTo(0, 6);
    expect(easeOutBack(1, 2)).toBeCloseTo(1, 6);
    expect(easeOutBack(0.6, 2)).toBeGreaterThan(1);
  });

  it("hash01 is stable and in 0..1", () => {
    expect(hash01(7, 3)).toBe(hash01(7, 3));
    expect(hash01(7, 3)).not.toBe(hash01(7, 4));
    for (let i = 0; i < 50; i++) {
      const v = hash01(i, i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// #4082: the merge burst, drawn on the board, follows the Reanimated spring and fade it ran as a view.
describe("merge burst (MergeBurst's spring and fade, worked out from the clock)", () => {
  const B = MOTION.burst;

  /** Reanimated's withSpring as a physical spring: m·x'' = -k·(x - to) - c·x', from rest. */
  function integrated(ms: number): number {
    const dt = 0.0001;
    let x = B.fromScale;
    let v = 0;
    for (let t = 0; t < ms / 1000 - 1e-9; t += dt) {
      const a = (-B.stiffness * (x - B.toScale) - B.damping * v) / BURST_SPRING_MASS;
      v += a * dt;
      x += v * dt;
    }
    return x;
  }

  it("uses Reanimated 4's default spring mass (MergeBurst set only damping and stiffness)", () => {
    expect(BURST_SPRING_MASS).toBe(4);
  });

  it("springs from fromScale towards toScale with the spring's shape", () => {
    expect(burstScale(0)).toBe(B.fromScale);
    expect(burstScale(-5)).toBe(B.fromScale);
    for (const ms of [50, 200, 500, 800, 1100, 2000]) {
      expect(burstScale(ms)).toBeCloseTo(integrated(ms), 2);
    }
    // Under-damped: it overshoots toScale before it settles, and it ends there.
    let peak = 0;
    for (let ms = 0; ms <= 3000; ms += 10) peak = Math.max(peak, burstScale(ms));
    expect(peak).toBeGreaterThan(B.toScale);
    expect(burstScale(10_000)).toBeCloseTo(B.toScale, 3);
  });

  it("fades from its opacity to nothing over fadeMs (in-out quad, withTiming's default)", () => {
    expect(burstAlpha(0)).toBe(B.opacity);
    expect(burstAlpha(B.fadeMs / 2)).toBeCloseTo(B.opacity / 2, 6);
    expect(burstAlpha(B.fadeMs / 4)).toBeCloseTo(B.opacity * (1 - 2 * 0.25 ** 2), 6);
    expect(burstAlpha(B.fadeMs)).toBe(0);
    expect(burstAlpha(-1)).toBe(0);
    let prev = Infinity;
    for (let ms = 0; ms < B.fadeMs; ms += 25) {
      expect(burstAlpha(ms)).toBeLessThanOrEqual(prev);
      prev = burstAlpha(ms);
    }
  });
});
