/**
 * Cascade motion events (#3701): the engine's land / merge / drop / game-over moments, as a small
 * fixed ring buffer the JS loop writes and the board reads on the UI thread.
 *
 * The loop pushes the events of a step (`pushMotion`), then publishes a copy of the buffer to a
 * shared value once (`useBoardMotion`). Times are not stored: the UI thread stamps each new slot
 * with its own motion clock the first frame it sees it, so the JS and UI clocks never have to agree.
 * `seq` counts up for the life of the screen (never reset), so a slot from an earlier game is never
 * mistaken for a new one.
 */
import { dropLifetimeMs, gameOverLifetimeMs, landLifetimeMs, mergeLifetimeMs } from "./motion";

export const MOTION_KIND = { land: 1, merge: 2, drop: 3, gameOver: 4 } as const;
export type MotionKind = (typeof MOTION_KIND)[keyof typeof MOTION_KIND];

/** Slots in the ring: a 4-chain with its landings uses about 10. */
export const MOTION_SLOTS = 32;
/** Fields per slot. */
export const MOTION_STRIDE = 7;
export const MOTION_FIELD = {
  /** The event's sequence number (1, 2, …); 0 = empty slot. */
  seq: 0,
  kind: 1,
  /** World px. */
  x: 2,
  y: 3,
  tier: 4,
  /** The piece's id (land: the piece that landed; merge: the piece it made). */
  id: 5,
  /** land: speed (px per fixed step); merge: the chain link (1 for a plain merge). */
  aux: 6,
} as const;

export interface MotionLog {
  readonly buf: Float64Array;
  /** The last sequence number written. */
  seq: number;
  /** True when `buf` changed since the last publish. */
  dirty: boolean;
}

export function createMotionLog(): MotionLog {
  return { buf: new Float64Array(MOTION_SLOTS * MOTION_STRIDE), seq: 0, dirty: false };
}

export function pushMotion(
  log: MotionLog,
  kind: MotionKind,
  x: number,
  y: number,
  tier: number,
  id: number,
  aux: number
): void {
  log.seq++;
  const o = ((log.seq - 1) % MOTION_SLOTS) * MOTION_STRIDE;
  const b = log.buf;
  b[o + MOTION_FIELD.seq] = log.seq;
  b[o + MOTION_FIELD.kind] = kind;
  b[o + MOTION_FIELD.x] = x;
  b[o + MOTION_FIELD.y] = y;
  b[o + MOTION_FIELD.tier] = tier;
  b[o + MOTION_FIELD.id] = id;
  b[o + MOTION_FIELD.aux] = aux;
  log.dirty = true;
}

/** Empties every slot (a new game); `seq` carries on. */
export function clearMotion(log: MotionLog): void {
  log.buf.fill(0);
  log.dirty = true;
}

/** Stamps: per slot, the seq it was stamped for and the motion clock then. */
export const STAMP_STRIDE = 2;

export function emptyStamps(): Float64Array {
  return new Float64Array(MOTION_SLOTS * STAMP_STRIDE);
}

/**
 * The age (ms of the motion clock) of slot `i`, or -1 when it is empty or not stamped yet.
 * Worklet: the board reads it while it records its Picture.
 */
export function slotAge(
  events: Float64Array,
  stamps: Float64Array,
  i: number,
  clock: number
): number {
  "worklet";
  const seq = events[i * MOTION_STRIDE + MOTION_FIELD.seq] ?? 0;
  if (!(seq > 0) || stamps[i * STAMP_STRIDE] !== seq) return -1;
  return clock - (stamps[i * STAMP_STRIDE + 1] ?? clock);
}

/** How long slot `i`'s moment keeps the motion clock running, ms (0 for an empty slot). */
export function slotLifetimeMs(events: Float64Array, i: number, reduceMotion: boolean): number {
  "worklet";
  const o = i * MOTION_STRIDE;
  switch (events[o + MOTION_FIELD.kind]) {
    case MOTION_KIND.land:
      return landLifetimeMs(reduceMotion);
    case MOTION_KIND.merge:
      return mergeLifetimeMs(events[o + MOTION_FIELD.aux] ?? 1, reduceMotion);
    case MOTION_KIND.drop:
      return dropLifetimeMs(reduceMotion);
    case MOTION_KIND.gameOver:
      return gameOverLifetimeMs(reduceMotion);
    default:
      return 0;
  }
}

/**
 * Stamps every slot the UI thread has not seen yet with the motion clock `now`. Returns the new
 * stamps, or null when nothing was new (no allocation on an ordinary frame).
 */
export function stampSlots(
  events: Float64Array,
  stamps: Float64Array,
  now: number
): Float64Array | null {
  "worklet";
  let fresh: Float64Array | null = null;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const seq = events[i * MOTION_STRIDE + MOTION_FIELD.seq] ?? 0;
    if (!(seq > 0) || stamps[i * STAMP_STRIDE] === seq) continue;
    if (fresh === null) fresh = new Float64Array(stamps);
    fresh[i * STAMP_STRIDE] = seq;
    fresh[i * STAMP_STRIDE + 1] = now;
  }
  return fresh;
}

/** True while any stamped moment is still playing at `now` (an unstamped one counts too). */
export function motionLive(
  events: Float64Array,
  stamps: Float64Array,
  now: number,
  reduceMotion: boolean
): boolean {
  "worklet";
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const seq = events[i * MOTION_STRIDE + MOTION_FIELD.seq] ?? 0;
    if (!(seq > 0)) continue;
    if (stamps[i * STAMP_STRIDE] !== seq) return true;
    if (now - (stamps[i * STAMP_STRIDE + 1] ?? now) < slotLifetimeMs(events, i, reduceMotion))
      return true;
  }
  return false;
}

/** The highest sequence number in the buffer (0 when empty). */
export function lastSeq(events: Float64Array): number {
  "worklet";
  let max = 0;
  for (let i = 0; i < MOTION_SLOTS; i++) max = Math.max(max, events[i * MOTION_STRIDE] ?? 0);
  return max;
}
