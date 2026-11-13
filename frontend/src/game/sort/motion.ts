/**
 * Sort motion (#3660): how long each board animation takes, and its shape. One module, so the
 * sounds (#3661) and the haptics are timed to the same numbers, as Mahjong's are
 * (`game/mahjong/motion.ts`, #3613).
 *
 * Every duration stays under the story's ceiling (checked in `motion.test.ts`). The helpers
 * marked "worklet" run on the UI thread inside Reanimated styles, so they take and return
 * plain numbers and touch nothing else.
 *
 * Reduce Motion: no animation is started at all; each change is instant (`BottleView`,
 * `SortBoard`, `SortScreen`). A Reduce Motion pour lands at once (`REDUCE_MOTION_POUR_MS`).
 *
 * Nothing here blocks input except the pour itself, which keeps the replay recorder's
 * commit-on-landing contract (#3385, `usePourAnimation`).
 */

// ---------------------------------------------------------------------------
// Durations (ms) and their ceilings
// ---------------------------------------------------------------------------

/** A bottle lifts when selected, and holds. */
export const SELECT_LIFT_MS = 160;
/** A deselected bottle settles back. */
export const SELECT_SETTLE_MS = 120;
/** The tapped destination of a refused pour shakes "no". */
export const REFUSED_SHAKE_MS = 240;
/** A bottle a pour just completed pulses. */
export const COMPLETE_PULSE_MS = 420;
/** Its check badge pops in, inside the pulse. */
export const COMPLETE_BADGE_MS = 300;
/** An undo fades the new board in. */
export const UNDO_FADE_MS = 280;
/** A new level's bottles drop in, one after another, all done by this time. */
export const LEVEL_IN_TOTAL_MS = 560;
/** One bottle's own drop-in. */
export const LEVEL_IN_ITEM_MS = 200;
/** The gap between bottles, at most (a level with few bottles is not stretched to 600 ms). */
export const LEVEL_IN_STAGGER_MAX_MS = 60;

/**
 * The ceilings the owner set (2026-11-13), ms. The tests hold every duration to them.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export const CEILINGS_MS = {
  select: 200,
  pourOneUnit: 900,
  pourPerExtraUnit: 300,
  refusedShake: 250,
  complete: 450,
  undo: 300,
  levelIn: 600,
  winCascade: 1500,
} as const;

// ---------------------------------------------------------------------------
// The pour: lift to the destination, tilt, stream one unit at a time, return
// ---------------------------------------------------------------------------

/** The bottle lifts and travels to just above the destination's neck. */
export const POUR_LIFT_MS = 170;
/** It tilts from upright to `TILT_START_DEG`; the stream fades in. */
export const POUR_TILT_MS = 130;
/** Each unit's share of the progressive tilt and the stream. */
export const POUR_UNIT_MS = 300;
/** It untilts and returns, together. */
export const POUR_RETURN_MS = 180;
/** How long a unit takes from the spout to settle in the destination. */
export const POUR_TRAVEL_MS = 120;
/** Where in its slot a unit leaves the spout (the source drains by one). */
export const POUR_UNIT_LEAVE_AT = 0.6;
/**
 * What a pour spends before and after its animation, outside `pourTimeline`: the tap, the
 * state change and the render that start it (about a frame), and the end-of-animation hop
 * to React before the move counter changes (about a frame). Measured on web (tap to move counter
 * minus the animation): 50 to 70 ms. The pour is designed to `pourTotalMs(1) + this <= 900` so that, from the
 * player's tap to the move landing, one unit still takes 900 ms or less. The sounds (#3661)
 * add it to each glug's time, which is measured from the tap.
 */
export const POUR_START_LATENCY_BUDGET_MS = 50;

/** Reduce Motion: no ghost, no tilt; the move lands at once. */
export const REDUCE_MOTION_POUR_MS = 0;

/** The tilt, in degrees, when the stream starts and when the source is empty. */
export const TILT_START_DEG = 50;
export const TILT_PEAK_DEG = 95;

/** The stream's widths (px): the glow behind it, the stream, and its inner highlight. */
export const STREAM_GLOW_WIDTH = 14;
export const STREAM_WIDTH = 6;
export const STREAM_HIGHLIGHT_WIDTH = 1.4;

/** The splash at the landing point, per unit (ms and px). */
export const SPLASH_GROW_MS = 160;
export const SPLASH_FADE_MS = 220;
export const SPLASH_RX_FROM = 4;
export const SPLASH_RX_TO = 14;

/** How long the stream runs for `units` units (SortBoard's `pourHoldMs`). */
export function pourFlowMs(units: number): number {
  return Math.max(1, units) * POUR_UNIT_MS;
}

/** One pour's moments, in ms from the start of its animation (add the latency budget for the tap). */
export interface PourTimeline {
  /** The lift ends and the tilt begins. */
  readonly liftEndMs: number;
  /** The tilt reaches `TILT_START_DEG` and the stream starts to run. */
  readonly flowStartMs: number;
  /** Each unit leaves the spout (the source drains) and lands (the destination fills). */
  readonly units: readonly { readonly leaveMs: number; readonly landMs: number }[];
  /** The last unit has landed and the stream stops. */
  readonly flowEndMs: number;
  /** The bottle is back and the move commits (`usePourAnimation`). */
  readonly endMs: number;
}

/**
 * When everything in a pour of `units` units happens. SortBoard schedules its animation from
 * this, and the sounds (#3661) cut to it, so nobody recomputes the numbers.
 */
export function pourTimeline(units: number): PourTimeline {
  const n = Math.max(1, Math.round(units));
  const flowStartMs = POUR_LIFT_MS + POUR_TILT_MS;
  const list = Array.from({ length: n }, (_, i) => {
    const leaveMs = flowStartMs + i * POUR_UNIT_MS + POUR_UNIT_MS * POUR_UNIT_LEAVE_AT;
    return { leaveMs, landMs: leaveMs + POUR_TRAVEL_MS };
  });
  const flowEndMs = flowStartMs + pourFlowMs(n);
  return {
    liftEndMs: POUR_LIFT_MS,
    flowStartMs,
    units: list,
    flowEndMs,
    endMs: flowEndMs + POUR_RETURN_MS,
  };
}

/**
 * A pour's animation length: 780 ms for one unit, 300 ms more for each extra one. From the
 * tap add `POUR_START_LATENCY_BUDGET_MS`: 830 ms, under the 900 ms ceiling.
 * @internal Exported for tests, and for the sounds (#3661) to come; no production caller yet.
 */
export function pourTotalMs(units: number): number {
  return pourTimeline(units).endMs;
}

// ---------------------------------------------------------------------------
// The win cascade: liquid-coloured pieces across the board, then the result card
// ---------------------------------------------------------------------------

/** Pieces in the cascade (ConfettiFall draws up to six). */
export const WIN_CASCADE_PIECES = 6;
export const WIN_CASCADE_STAGGER_MS = 60;
/** ConfettiFall's own fade-in, per piece. */
export const WIN_CASCADE_FADE_IN_MS = 80;
export const WIN_CASCADE_HOLD_MS = 700;
export const WIN_CASCADE_FADE_OUT_MS = 300;
/** From the win to the result card: the last piece's start, fade-in, hold and fade-out. */
export const WIN_CASCADE_MS =
  (WIN_CASCADE_PIECES - 1) * WIN_CASCADE_STAGGER_MS +
  WIN_CASCADE_FADE_IN_MS +
  WIN_CASCADE_HOLD_MS +
  WIN_CASCADE_FADE_OUT_MS;
/** A cascade piece's size (px). */
export const WIN_CASCADE_PIECE_PX = 20;

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** The selected bottle's lift, as a share of its height, and never more than a row gap. */
export const SELECT_LIFT_FRAC = 0.05;
/** The refused shake's reach, as a share of the bottle's width, and its swings. */
export const SHAKE_AMPLITUDE_FRAC = 0.1;
export const SHAKE_SWINGS = 2;
/** The completed bottle's largest scale. */
export const COMPLETE_PULSE_SCALE = 1.08;
/** An undo fades the board in from this opacity. */
export const UNDO_FADE_FROM = 0.4;
/** A level-in bottle drops from this share of its height above its place. */
export const LEVEL_IN_DROP_FRAC = 0.12;

// ---------------------------------------------------------------------------
// Worklets
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

/**
 * The selected bottle's translateY (px, up is negative) at select progress `p` (0 at rest, 1
 * lifted): a share of its height, capped at `maxPx` (the gap to the row above) so a bigger
 * bottle never lifts into it.
 */
export function selectLiftPx(p: number, bottleH: number, maxPx: number): number {
  "worklet";
  return -p * Math.min(bottleH * SELECT_LIFT_FRAC, maxPx);
}

/** The refused shake's translateX (px) at progress `p` (0..1): a damped side-to-side swing. */
export function shakeOffsetPx(p: number, bottleW: number): number {
  "worklet";
  if (p <= 0 || p >= 1) return 0;
  return Math.sin(p * SHAKE_SWINGS * 2 * Math.PI) * (1 - p) * bottleW * SHAKE_AMPLITUDE_FRAC;
}

/** The completed bottle's scale at progress `p` (0..1): up and back to 1. */
export function pulseScale(p: number): number {
  "worklet";
  if (p <= 0 || p >= 1) return 1;
  return 1 + (COMPLETE_PULSE_SCALE - 1) * Math.sin(p * Math.PI);
}

/** The check badge's scale at progress `p` (0..1): pops in with a small overshoot. */
export function badgePopScale(p: number): number {
  "worklet";
  return p <= 0 ? 0 : p >= 1 ? 1 : easeOutBack(p);
}

/** When bottle `index` of `count` starts dropping in (ms from the level's start). */
export function levelInDelayMs(index: number, count: number): number {
  "worklet";
  if (count <= 1) return 0;
  const step = Math.min(
    LEVEL_IN_STAGGER_MAX_MS,
    (LEVEL_IN_TOTAL_MS - LEVEL_IN_ITEM_MS) / (count - 1)
  );
  return index * step;
}

/**
 * A bottle's drop-in at the level clock's progress `clock` (0..1 over `LEVEL_IN_TOTAL_MS`):
 * its opacity, and how far above its place it still is (a share of 1, times `dropPx`).
 */
export function levelInLook(
  clock: number,
  delayMs: number
): { readonly opacity: number; readonly drop: number } {
  "worklet";
  const p = clamp01((clock * LEVEL_IN_TOTAL_MS - delayMs) / LEVEL_IN_ITEM_MS);
  return { opacity: p, drop: 1 - easeOutCubic(p) };
}
