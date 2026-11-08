/**
 * Mahjong motion (#3613): how long each board animation takes, and where a tile is at each
 * moment of one. One module, so the sounds (#3578) can be timed to the same numbers.
 *
 * Every animation is a progress value running from 0 to 1 over its duration (a Reanimated
 * shared value on native, the clock on web). The functions here turn a progress into a tile's
 * look; they are worklets, so the native canvas runs them on the UI thread, and the web canvas
 * calls the same code on its own frames.
 *
 * Reduce Motion: no animation is started at all; each change is instant (`useBoardMotion`).
 */

// ---------------------------------------------------------------------------
// Durations (ms). Each stays under its story ceiling (#3613; checked in motion.test.ts).
// ---------------------------------------------------------------------------

/** A tile lifts when selected. */
export const SELECT_LIFT_MS = 180;
/** A deselected tile settles back. */
export const DESELECT_SETTLE_MS = 140;
/** The second tile of a wrong pair shakes "no". */
export const MISMATCH_SHAKE_MS = 240;
/** A matched pair lifts, flies together, meets and bursts. */
export const MATCH_MS = 440;
/** A hinted pair breathes. */
export const HINT_BREATHE_MS = 2000;
/** A new deal drops in, layer by layer. */
export const DEAL_IN_MS = 780;
/** A shuffle swirls the tiles to their new places. */
export const SHUFFLE_MS = 880;
/** The win cascade, from the last match to the result card. */
export const WIN_CASCADE_MS = 1450;
/** Locked tiles dim at a deadlock. */
export const DEADLOCK_DIM_MS = 700;

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** The selected tile's scale. */
export const LIFT_SCALE = 1.06;
/** Where in the match the pair meets (and the burst starts). */
export const MATCH_MEET_AT = 0.6;
/** How many hint breaths fit in HINT_BREATHE_MS. */
const HINT_BREATHS = 2;
/** The deal: how much of it the top layer waits for the bottom one. */
const DEAL_STAGGER = 0.45;
/** The shuffle: how much of it the last tile waits for the first. */
const SHUFFLE_STAGGER = 0.35;

// ---------------------------------------------------------------------------
// Easing (worklets)
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  "worklet";
  const u = 1 - t;
  return 1 - u * u * u;
}

/** A spring-like ease: a small overshoot, then rest at 1. */
function easeOutBack(t: number): number {
  "worklet";
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Progress `p` of the whole, as the progress of a part that runs from `start` for `span`. */
function part(p: number, start: number, span: number): number {
  "worklet";
  return span <= 0 ? (p >= start ? 1 : 0) : clamp01((p - start) / span);
}

// ---------------------------------------------------------------------------
// One tile's motion
// ---------------------------------------------------------------------------

/** One running animation: its progress (0..1) and its start time and length (for web). */
export interface MotionClock {
  /** Native: a Reanimated shared value. Web reads `t0` and `duration` instead. */
  readonly progress: { value: number };
  readonly t0: number;
  readonly duration: number;
}

/** The animations a tile is in. Each channel is optional; a tile with none is at rest. */
export interface TileMotion {
  /** Selecting (0 → 1) or deselecting (1 → 0). */
  readonly lift?: MotionClock & { readonly from: number; readonly to: number };
  /** A wrong pair's second tile shakes. */
  readonly shake?: MotionClock;
  /** The hint breathes. */
  readonly hint?: MotionClock;
  /** The deal: `delay` is this tile's start (0..DEAL_STAGGER), by its layer. */
  readonly deal?: MotionClock & { readonly delay: number };
  /** The shuffle: from (`fromX`, `fromY`) board units away, starting at `delay`. */
  readonly shuffle?: MotionClock & {
    readonly delay: number;
    readonly fromX: number;
    readonly fromY: number;
  };
  /** The deadlock: a locked tile dims briefly. */
  readonly dim?: MotionClock;
}

/** A tile's look at one moment: offsets in board units, lift 0..1, glows and alpha 0..1. */
export interface TileLook {
  readonly dx: number;
  readonly dy: number;
  readonly lift: number;
  readonly scale: number;
  readonly alpha: number;
  readonly hintGlow: number;
  readonly dim: number;
}

const REST: TileLook = { dx: 0, dy: 0, lift: 0, scale: 1, alpha: 1, hintGlow: 0, dim: 0 };

/** The look of a tile at rest: lifted if selected. */
export function restLook(selected: boolean): TileLook {
  "worklet";
  return selected ? { ...REST, lift: 1, scale: LIFT_SCALE } : REST;
}

/** A tile's look from its motion channels' progress values (`p*`), in board units. */
export function tileLook(
  m: TileMotion,
  selected: boolean,
  p: {
    readonly lift: number;
    readonly shake: number;
    readonly hint: number;
    readonly deal: number;
    readonly shuffle: number;
    readonly dim: number;
  },
  tileWidth: number,
  tileHeight: number
): TileLook {
  "worklet";
  let lift = selected ? 1 : 0;
  if (m.lift) {
    const e = m.lift.to > m.lift.from ? easeOutBack(p.lift) : easeOutCubic(p.lift);
    lift = m.lift.from + (m.lift.to - m.lift.from) * e;
  }
  let dx = 0;
  let dy = 0;
  let alpha = 1;
  if (m.shake && p.shake < 1) {
    // Three fading swings, "no".
    dx += Math.sin(p.shake * Math.PI * 6) * (1 - p.shake) * tileWidth * 0.14;
  }
  if (m.deal) {
    const t = part(p.deal, m.deal.delay, 1 - DEAL_STAGGER);
    dy -= (1 - easeOutCubic(t)) * tileHeight * 1.2;
    alpha = Math.min(alpha, clamp01(t * 2.5));
  }
  if (m.shuffle) {
    const t = part(p.shuffle, m.shuffle.delay, 1 - SHUFFLE_STAGGER);
    const e = easeOutCubic(t);
    // From the old place to the new one, bowed into a swirl: the path's turn is greatest in
    // mid-flight and nothing at either end.
    const angle = Math.sin(e * Math.PI) * Math.PI * 0.35;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const fx = m.shuffle.fromX * (1 - e);
    const fy = m.shuffle.fromY * (1 - e);
    dx += fx * c - fy * s;
    dy += fx * s + fy * c;
    lift = Math.max(lift, Math.sin(t * Math.PI) * 0.8);
  }
  const hintGlow = m.hint ? 0.5 - 0.5 * Math.cos(p.hint * Math.PI * 2 * HINT_BREATHS) : 0;
  const dim = m.dim ? Math.sin(p.dim * Math.PI) : 0;
  return { dx, dy, lift, scale: 1 + (LIFT_SCALE - 1) * lift, alpha, hintGlow, dim };
}

/** The deal's start for a tile on `layer` of a board `layers` high. */
export function dealDelay(layer: number, layers: number): number {
  "worklet";
  return layers <= 1 ? 0 : (layer / (layers - 1)) * DEAL_STAGGER;
}

/** The shuffle's start for the `index`-th of `count` tiles (a wave across the board). */
export function shuffleDelay(index: number, count: number): number {
  "worklet";
  return count <= 1 ? 0 : (index / (count - 1)) * SHUFFLE_STAGGER;
}

// ---------------------------------------------------------------------------
// A matched pair, and sparks
// ---------------------------------------------------------------------------

/** Where one tile of a matched pair is: `side` -1 for the first, +1 for the second. */
export function matchTileLook(
  p: number,
  fromX: number,
  fromY: number,
  meetX: number,
  meetY: number,
  side: number,
  faceWidth: number
): { x: number; y: number; lift: number; scale: number; alpha: number } {
  "worklet";
  // Lift (0–0.2), fly together face to face (0.2–MATCH_MEET_AT), then burst and fade.
  const lift = Math.min(1, p / 0.2);
  const fly = easeOutCubic(part(p, 0.2, MATCH_MEET_AT - 0.2));
  const tx = meetX + side * faceWidth * 0.5;
  const burst = part(p, MATCH_MEET_AT, 1 - MATCH_MEET_AT);
  return {
    x: fromX + (tx - fromX) * fly,
    y: fromY + (meetY - fromY) * fly,
    lift,
    scale: 1 + (LIFT_SCALE - 1) * lift - burst * 0.35,
    alpha: 1 - burst,
  };
}

/** A spark: its centre, radius and alpha. */
export interface Spark {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly alpha: number;
}

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * The match burst's sparks at progress `p` of the match, around (`x`, `y`): `count` of them
 * fly out to `reach` and fade.
 */
export function burstSparks(
  p: number,
  x: number,
  y: number,
  reach: number,
  count: number
): Spark[] {
  "worklet";
  const t = part(p, MATCH_MEET_AT, 1 - MATCH_MEET_AT);
  const out: Spark[] = [];
  if (t <= 0 || t >= 1) return out;
  const e = easeOutCubic(t);
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE;
    const d = reach * e * (0.6 + 0.4 * ((i * 7) % 5) * 0.25);
    out.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      r: Math.max(0.5, reach * 0.07 * (1 - t)),
      alpha: 1 - t,
    });
  }
  return out;
}

/**
 * The win cascade at progress `p`: sparks burst from (`x`, `y`) out across the board
 * (`width` × `height`), falling and fading, in two waves.
 */
export function cascadeSparks(
  p: number,
  x: number,
  y: number,
  width: number,
  height: number,
  count: number
): Spark[] {
  "worklet";
  const out: Spark[] = [];
  const reach = Math.max(width, height) * 0.6;
  for (let i = 0; i < count; i++) {
    const delay = (i % 2) * 0.25 + ((i * 3) % 7) * 0.02;
    // Each spark is gone just before the cascade ends.
    const t = part(p, delay, 0.97 - delay);
    if (t <= 0 || t >= 1) continue;
    const a = i * GOLDEN_ANGLE;
    const d = reach * easeOutCubic(t) * (0.35 + 0.65 * (((i * 13) % 11) / 10));
    out.push({
      x: x + Math.cos(a) * d,
      // A little gravity as they fade.
      y: y + Math.sin(a) * d + t * t * height * 0.25,
      r: Math.max(0.75, (2 + (i % 3)) * (1 - t * 0.6)),
      alpha: 1 - t,
    });
  }
  return out;
}
