/**
 * Cascade motion (#3701): every duration, easing and size of the game's motion, in one place.
 *
 * Owner pick (2026-11-16): proposal B "Juicy bounce" for the landing, the merge, the chain and the
 * next piece; proposal C "Crisp graphic" for the danger blink and the game over. Reduce Motion
 * follows the same split (the `calm` block). The #3702 sounds are cut to these numbers.
 *
 * What reads it:
 *   - `render/drawMotion.ts` (the board's Picture, UI thread): squash, pop, dust, chain counter,
 *     spawner arrival, danger blink, game-over dim and flash;
 *   - `components/cascade/useBoardMotion.ts`: the UI-thread motion clock (lifetimes, phase);
 *   - `components/cascade/NextFruitPreview.tsx`: the DROP / NEXT chips;
 *   - `components/cascade/MergeBurst.tsx`: its spring and fade (as built, now named here);
 *   - `game/cascade/haptics.ts`: the haptic pacing;
 *   - `components/cascade/useLossCard.ts`: when the loss card comes.
 * Not here: the grow-in (#3697) is physics (`GROW_IN_STEPS`, constants.ts) and the win
 * celebration's timeline is `celebration.ts` (#3924, owner-approved, unchanged).
 *
 * Every function is a worklet: the board calls them while it records its Picture.
 */

export const MOTION = {
  /** Landing squash: a damped spring, squash then a little stretch, scaled by tier and speed. */
  land: {
    /** Squash at tier 0 and per tier: 7 % for a Cherry, 18 % for a Watermelon. */
    squash0: 0.07,
    squashPerTier: 0.012,
    /** Width grows by this much of the height's squash (area roughly kept). */
    stretchRatio: 0.8,
    periodMs: 230,
    decayMs: 95,
    durationMs: 380,
    /** A drop from the spawner lands at about this speed (px per fixed step): full squash. */
    refSpeed: 20,
    /** A slow touch-down still squashes this much of the full amount. */
    minSpeedFactor: 0.4,
  },
  /** Landing dust: puffs either side of the contact. */
  dust: { durationMs: 300, count: 6, alpha: 0.45 },
  /** The merge pop, on top of the grow-in (#3697) and MergeBurst. */
  merge: {
    flashMs: 120,
    flashAlpha: 0.45,
    ringMs: 320,
    /** The ring grows from the new piece's radius to this multiple of it. */
    ringTo: 2,
    /** Ring width at the start, as a share of the radius. */
    ringWidth: 0.24,
    confettiMs: 620,
    confetti: 12,
    /** Confetti speed, px per ms, and its spread (both scaled by the piece's size). */
    confettiSpeed: 0.12,
    confettiSpeedSpread: 0.12,
    /** px per ms². */
    gravity: 0.00035,
  },
  /** MergeBurst (#2960), as built: a 40 pt disc springing out and fading. */
  burst: {
    size: 40,
    fromScale: 0.1,
    toScale: 2.2,
    damping: 9,
    stiffness: 25,
    opacity: 0.75,
    fadeMs: 1100,
  },
  /** The chain counter, ×2 ×3 ×4… near the chain's first link. */
  chain: {
    /**
     * The counter steps one link per `stepMs`, catching up with the engine (a 4-chain's links come
     * 17-50 ms apart, too fast to read or feel). The chain haptics use the same steps.
     */
    stepMs: 80,
    /** Text height, pt: ×2 is 24 pt, each further link 7 pt more, at most `maxPt`. */
    pt0: 24,
    ptPerLink: 7,
    maxPt: 52,
    popMs: 280,
    /** easeOutBack overshoot of the pop (0.5 → 1.3 → 1). */
    overshoot: 2.6,
    fromScale: 0.5,
    holdMs: 800,
    outMs: 200,
    wobbleDeg: 8,
    wobbleDecayMs: 160,
    /** How far above the first link the counter sits, pt. */
    raisePt: 56,
    sparkleMs: 500,
  },
  /** The next piece: the chips (NextFruitPreview) and the spawner piece. */
  next: {
    ms: 320,
    overshoot: 2,
    /** The DROP glyph's arc as it hops over from NEXT, pt. */
    hopPt: 16,
    nextDelayMs: 80,
    nextPopMs: 280,
    nextOvershoot: 3,
    /** The spawner piece drops in from this far above (world px), and from this scale. */
    spawnerDrop: 70,
    spawnerFromScale: 0.8,
    spawnerOvershoot: 2.2,
  },
  /** Danger (proposal C): a square-wave blink of the ring and marching dashes on the lid. */
  danger: {
    /** Blink period at the start of the count and at its end (≤ 3 Hz: WCAG 2.3.1). */
    slowMs: 1000,
    fastMs: 340,
    maxHz: 3,
    duty: 0.5,
    ringGap: 6,
    ringWidth: 2,
    ringAlpha: 0.85,
    dashOn: 12,
    dashOff: 9,
    /** Dash march, world px per second, at the start and the end of the count. */
    marchSlow: 40,
    marchFast: 120,
  },
  /** Game over (proposal C): the pile dims at once, the lid flashes twice, then the card. */
  gameOver: {
    dim: 0.6,
    flashes: 2,
    flashOnMs: 140,
    flashOffMs: 120,
    flashWidth: 5,
    cardAtMs: 1000,
  },
  /** Reduce Motion: no squash, spring, drift, wobble, blink or flash; short fades in place. */
  calm: {
    mergeFlashMs: 200,
    mergeFlashAlpha: 0.45,
    mergeFlashScale: 1.08,
    chainFadeMs: 150,
    nextFadeMs: 150,
    gameOverDimMs: 300,
  },
  /** Haptic pacing (`haptics.ts`). */
  haptics: {
    /** No two haptics closer than this; later ones wait their turn. */
    minGapMs: 40,
    /** Landings closer than this are dropped, not queued. */
    landGapMs: 60,
    /** The second pulse of a big merge's double Heavy. */
    doubleGapMs: 50,
    /** At most this many haptics wait in the queue; more are dropped. */
    maxQueued: 6,
    /** The danger warning fires once when the count passes this ratio. */
    dangerAt: 0.5,
  },
  /** The motion clock never moves more than this per frame (a stalled frame only delays it). */
  maxFrameStepMs: 34,
} as const;

// ---- easing ---------------------------------------------------------------------------------

export function clamp01(v: number): number {
  "worklet";
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function lerp(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

/** Progress of `t` through [a, b], clamped to 0..1. */
export function progress(t: number, a: number, b: number): number {
  "worklet";
  return b > a ? clamp01((t - a) / (b - a)) : t >= b ? 1 : 0;
}

export function easeOutBack(x: number, overshoot: number): number {
  "worklet";
  const c3 = overshoot + 1;
  return 1 + c3 * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
}

export function easeOutCubic(x: number): number {
  "worklet";
  return 1 - (1 - x) ** 3;
}

export function easeOutQuart(x: number): number {
  "worklet";
  return 1 - (1 - x) ** 4;
}

export function easeInOutQuad(x: number): number {
  "worklet";
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

/** A stable pseudo-random 0..1 for (seed, i): the confetti and dust spread, no RNG state. */
export function hash01(seed: number, i: number): number {
  "worklet";
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ---- moments --------------------------------------------------------------------------------

/**
 * The landing squash at `ms` after the contact: positive squashes (height × (1 - a), width ×
 * (1 + stretchRatio × a)), negative stretches. 0 once the spring has settled.
 */
export function landSquash(tier: number, speed: number, ms: number): number {
  "worklet";
  const L = MOTION.land;
  if (!(ms >= 0) || ms >= L.durationMs) return 0;
  const speedFactor = Math.max(L.minSpeedFactor, clamp01(speed / L.refSpeed));
  const amount = (L.squash0 + L.squashPerTier * Math.max(0, tier)) * speedFactor;
  return amount * Math.exp(-ms / L.decayMs) * Math.cos((2 * Math.PI * ms) / L.periodMs);
}

/**
 * Which chain step the counter shows: links 2, 3… one per `stepMs` from the first counted link,
 * never ahead of the engine. Returns the step index (0 shows ×2).
 */
export function chainStep(links: number, msSinceFirst: number): number {
  "worklet";
  if (links < 2) return -1;
  const paced = Math.floor(Math.max(0, msSinceFirst) / MOTION.chain.stepMs);
  return Math.min(links - 2, paced);
}

/** The counter's text height, pt, for a chain of `n` (n ≥ 2). */
export function chainPt(n: number): number {
  "worklet";
  const C = MOTION.chain;
  return Math.min(C.maxPt, C.pt0 + C.ptPerLink * Math.max(0, n - 2));
}

/** How long a merge with chain link `link` keeps the motion clock running, ms. */
export function mergeLifetimeMs(link: number, reduceMotion: boolean): number {
  "worklet";
  const C = MOTION.chain;
  const pop = reduceMotion ? MOTION.calm.mergeFlashMs : MOTION.merge.confettiMs;
  if (link < 2) return pop;
  return Math.max(pop, C.stepMs * (link - 2) + C.popMs + C.holdMs + C.outMs);
}

/** The danger blink's period for a `dangerRatio`: slow at the start of the count, fast at its end. */
export function dangerPeriodMs(ratio: number): number {
  "worklet";
  return lerp(MOTION.danger.slowMs, MOTION.danger.fastMs, clamp01(ratio));
}

/** The blink's phase at rest: the start of an off-beat, so the first count starts off. */
export const DANGER_IDLE_PHASE = MOTION.danger.duty;

/**
 * Moves the blink's phase (0..1) on by one frame. Integrated, not computed from the clock, so a
 * rising ratio speeds the blink up without a jump. It never jumps or resets:
 *   - while the count runs it advances at 1 / `dangerPeriodMs(ratio)`;
 *   - when the count stops during an on-beat, that beat is latched: it finishes at the fastest
 *     rate (`fastMs`), then the phase stays where the off-beat began;
 *   - when the count stops during an off-beat, the phase waits there.
 * So an on-beat only ever starts when the phase wraps, after a whole period of advance at no more
 * than 1 / `fastMs` per ms: onsets are at least `fastMs` (340 ms) apart however the ratio toggles,
 * never more than 3 a second (WCAG 2.3.1).
 */
export function stepDangerPhase(phase: number, dtMs: number, ratio: number): number {
  "worklet";
  const D = MOTION.danger;
  const dt = Math.max(0, dtMs);
  if (ratio > 0) {
    const next = phase + dt / dangerPeriodMs(ratio);
    return next - Math.floor(next);
  }
  if (phase < D.duty) return Math.min(D.duty, phase + dt / D.fastMs);
  return phase;
}

/** The blink is on for the first `duty` of each period. */
export function dangerBlinkOn(phase: number): boolean {
  "worklet";
  return phase < MOTION.danger.duty;
}

/** The marching dashes' offset along the lid, world px, `clockMs` into the count. */
export function dangerDashOffset(clockMs: number, ratio: number): number {
  "worklet";
  const D = MOTION.danger;
  const pxPerMs = lerp(D.marchSlow, D.marchFast, clamp01(ratio)) / 1000;
  const period = D.dashOn + D.dashOff;
  const off = (clockMs * pxPerMs) % period;
  return off < 0 ? off + period : off;
}

/** True while the lid flashes, `ms` after the game over. */
export function gameOverFlashOn(ms: number): boolean {
  "worklet";
  const G = MOTION.gameOver;
  const cycle = G.flashOnMs + G.flashOffMs;
  if (!(ms >= 0) || ms >= G.flashes * cycle) return false;
  return ms % cycle < G.flashOnMs;
}

/** How opaque the game-over dim is, `ms` after the game over. */
export function gameOverDim(ms: number, reduceMotion: boolean): number {
  "worklet";
  if (!(ms >= 0)) return 0;
  const G = MOTION.gameOver;
  return reduceMotion ? G.dim * progress(ms, 0, MOTION.calm.gameOverDimMs) : G.dim;
}

/** How long the game-over sequence keeps the motion clock running, ms. */
export function gameOverLifetimeMs(reduceMotion: boolean): number {
  "worklet";
  const G = MOTION.gameOver;
  return reduceMotion ? MOTION.calm.gameOverDimMs : G.flashes * (G.flashOnMs + G.flashOffMs);
}

/** The spawner piece's arrival, `ms` after a drop: its offset (world px, up), scale and opacity. */
export interface SpawnerArrival {
  dy: number;
  scale: number;
  alpha: number;
}

export function spawnerArrival(
  ms: number,
  reduceMotion: boolean,
  out: SpawnerArrival
): SpawnerArrival {
  "worklet";
  out.dy = 0;
  out.scale = 1;
  out.alpha = 1;
  if (!(ms >= 0)) return out;
  if (reduceMotion) {
    out.alpha = progress(ms, 0, MOTION.calm.nextFadeMs);
    return out;
  }
  const N = MOTION.next;
  if (ms >= N.ms) return out;
  const k = easeOutBack(progress(ms, 0, N.ms), N.spawnerOvershoot);
  out.dy = lerp(-N.spawnerDrop, 0, k);
  out.scale = lerp(N.spawnerFromScale, 1, k);
  return out;
}

/** How long a drop keeps the motion clock running (the spawner piece's arrival), ms. */
export function dropLifetimeMs(reduceMotion: boolean): number {
  "worklet";
  return reduceMotion ? MOTION.calm.nextFadeMs : MOTION.next.ms;
}

/** How long a landing keeps the motion clock running (squash and dust), ms. */
export function landLifetimeMs(reduceMotion: boolean): number {
  "worklet";
  return reduceMotion ? 0 : Math.max(MOTION.land.durationMs, MOTION.dust.durationMs);
}

/** A chip glyph's pose (`NextFruitPreview`). */
export interface ChipPose {
  translateX: number;
  translateY: number;
  scale: number;
  opacity: number;
}

/** How long the chips' animation runs after the queue moves on, ms. */
export function chipAnimationMs(reduceMotion: boolean): number {
  "worklet";
  const N = MOTION.next;
  return reduceMotion ? MOTION.calm.nextFadeMs : Math.max(N.ms, N.nextDelayMs + N.nextPopMs);
}

/**
 * The DROP chip's glyph, `ms` after the queue moved on: the piece that was NEXT hops over from
 * `fromX` (px to the right) in an arc, growing from the NEXT size, with an overshoot.
 */
export function dropChipPose(
  ms: number,
  fromX: number,
  sizeRatio: number,
  reduceMotion: boolean
): ChipPose {
  "worklet";
  if (reduceMotion) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      opacity: progress(ms, 0, MOTION.calm.nextFadeMs),
    };
  }
  const N = MOTION.next;
  const k = progress(ms, 0, N.ms);
  const kb = easeOutBack(k, N.overshoot);
  return {
    translateX: lerp(fromX, 0, kb),
    translateY: -N.hopPt * Math.sin(Math.PI * k),
    scale: lerp(sizeRatio, 1, kb),
    opacity: 1,
  };
}

/** The NEXT chip's new glyph, `ms` after the queue moved on: it pops in with an overshoot. */
export function nextChipPose(ms: number, reduceMotion: boolean): ChipPose {
  "worklet";
  if (reduceMotion) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      opacity: progress(ms, 0, MOTION.calm.nextFadeMs),
    };
  }
  const N = MOTION.next;
  const k = progress(ms, N.nextDelayMs, N.nextDelayMs + N.nextPopMs);
  return {
    translateX: 0,
    translateY: 0,
    scale: Math.max(0, easeOutBack(k, N.nextOvershoot)),
    opacity: k > 0 ? 1 : 0,
  };
}
