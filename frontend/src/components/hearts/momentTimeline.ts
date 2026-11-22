/**
 * Timelines for the three Hearts moments (#3588): the Queen of Spades, hearts broken and the
 * moon shot. Each moment is one linear clock, a shared value that runs from 0 to the moment's
 * `end` (ms) on the UI thread; every element reads its opacity, scale or offset from the clock
 * through `seg`, so nothing is computed per frame on the JS thread. The keyframes are the
 * owner-approved mockup's (#3574), timed against the sounds of #3563.
 */

/** An easing curve: maps progress 0..1 to eased progress. Must be a worklet. */
export type Ease = (t: number) => number;

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` curve, solved for x by Newton's method with a bisection
 * fallback, as browsers do.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  return (t: number): number => {
    "worklet";
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * s + bx) * s + cx) * s - t;
      if (Math.abs(x) < 1e-5) break;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(d) < 1e-6) break;
      s -= x / d;
    }
    if (s < 0 || s > 1 || Math.abs(((ax * s + bx) * s + cx) * s - t) > 1e-3) {
      let lo = 0;
      let hi = 1;
      s = t;
      for (let i = 0; i < 30; i++) {
        const x = ((ax * s + bx) * s + cx) * s;
        if (Math.abs(x - t) < 1e-5) break;
        if (x < t) lo = s;
        else hi = s;
        s = (lo + hi) / 2;
      }
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

/** The mockup's default motion curve. */
export const EASE_OUT: Ease = cubicBezier(0.2, 0.8, 0.2, 1);
/** CSS `ease-out`. */
export const CSS_EASE_OUT: Ease = cubicBezier(0, 0, 0.58, 1);
/** The gong rings' spread. */
export const RING_EASE: Ease = cubicBezier(0.1, 0.6, 0.3, 1);
/** The broken heart's halves falling away. */
export const FALL_EASE: Ease = cubicBezier(0.3, 0.6, 0.4, 1);
/** No easing. */
export const LINEAR: Ease = (t: number): number => {
  "worklet";
  return t;
};

/**
 * One keyframed animation on the clock, as the Web Animations API plays it: `start` and
 * `duration` in ms, the whole run eased by `ease`, then the eased progress mapped linearly
 * through `values` at `offsets` (0..1, ascending). Before `start` it holds the first value,
 * after the end the last (fill: both).
 */
export function seg(
  t: number,
  start: number,
  duration: number,
  offsets: readonly number[],
  values: readonly number[],
  ease: Ease
): number {
  "worklet";
  const raw = duration > 0 ? (t - start) / duration : t >= start ? 1 : 0;
  const p = ease(raw < 0 ? 0 : raw > 1 ? 1 : raw);
  const last = offsets.length - 1;
  if (p <= offsets[0]!) return values[0]!;
  for (let i = 1; i <= last; i++) {
    const o = offsets[i]!;
    if (p <= o) {
      const o0 = offsets[i - 1]!;
      const span = o - o0;
      const k = span > 0 ? (p - o0) / span : 1;
      return values[i - 1]! + (values[i]! - values[i - 1]!) * k;
    }
  }
  return values[last]!;
}

/**
 * The Queen of Spades (ms after the Q♠ is played, which is when its gong starts). The gong
 * strikes at 230 ms (`queen-of-spades-gong.ogg`'s attack peaks at 230–240 ms): the scrim, the
 * lift and the first ring start there, the second ring 260 ms later. The moment holds 1.7 s
 * from the strike, then everything returns.
 */
export const QUEEN_TIMING = {
  strike: 230,
  ringGap: 260,
  ringDuration: 1100,
  /** The other trick cards nudge outward once, from here, for `nudgeDuration`. */
  nudgeAt: 270,
  nudgeDuration: 500,
  caption: 580,
  /** Everything starts to return: strike + 1700. */
  settle: 1930,
  end: 2330,
  /** Reduce Motion: the caption alone, shown at once and held this long. */
  reducedEnd: 1200,
} as const;

/** Hearts broken (ms after the heartbeat starts: "lub" at 0, "dub" at 160). */
export const BROKEN_TIMING = {
  lub: 0,
  dub: 160,
  caption: 200,
  /** The crack fades and the halves fall apart. */
  split: 540,
  end: 1700,
  reducedEnd: 1000,
} as const;

/**
 * The moon shot (ms after the howl starts). The first wolf appears with the swell of the
 * first howl, the second with the answering howl at +1.45 s; the scene fades at 3.3 s and the
 * moment is over (Hand Complete may open) at 3.7 s.
 */
export const MOON_TIMING = {
  wolf: 700,
  title: 1200,
  answer: 1450,
  penalty: 1600,
  fade: 3300,
  end: 3700,
  reducedEnd: 1200,
} as const;
