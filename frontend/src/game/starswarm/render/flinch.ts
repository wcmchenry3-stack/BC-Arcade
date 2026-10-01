/**
 * #2881: the flinch wobble — a short lateral jitter and tilt on a ship that just reacted to a
 * rock. A pure function of the ship's `flinchMs`, shared by the native display list (frame.ts) and
 * the web canvas so the two cannot drift.
 */
import {
  FLINCH_MS,
  FLINCH_WOBBLE_PERIOD_MS,
  FLINCH_WOBBLE_PX,
  FLINCH_WOBBLE_TILT,
} from "../engine";

export interface FlinchWobble {
  /** Lateral offset, px. */
  readonly dx: number;
  /** Tilt, radians. */
  readonly rotate: number;
}

const NONE: FlinchWobble = { dx: 0, rotate: 0 };

/** Wobble for a ship with `flinchMs` left: a decaying sine, zero when not flinching. */
export function flinchWobble(flinchMs: number): FlinchWobble {
  if (flinchMs <= 0) return NONE;
  const elapsed = FLINCH_MS - flinchMs;
  const decay = Math.min(1, flinchMs / FLINCH_MS);
  const w = Math.sin((2 * Math.PI * elapsed) / FLINCH_WOBBLE_PERIOD_MS) * decay;
  return { dx: w * FLINCH_WOBBLE_PX, rotate: w * FLINCH_WOBBLE_TILT };
}
