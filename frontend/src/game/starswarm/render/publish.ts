/**
 * #2563 (epic #2562): when the native canvas's RAF loop publishes a new frame to the Picture.
 *
 * Every published frame costs work — recording the Skia Picture on the UI thread (#2565), and
 * checking the HUD for changes (#2566) — so the loop publishes only when something drawn has
 * actually changed. The engine returns the
 * same state object on a tick that changes nothing (paused is never ticked; GameOver short-
 * circuits) — so identity comparison of the inputs is exact, and a paused or finished game stops
 * re-rendering entirely.
 *
 * #2963: the starfield is no longer part of the published frame. It is recorded once and
 * scrolled on the UI thread by a shared clock, so a frame where only the stars moved (the
 * pre-wave countdown) publishes nothing.
 *
 * Pure and React-free so the gate is unit-tested.
 */
import type { StarSwarmState } from "../types";

/** Everything the native canvas's scene Picture and HUD read that changes during play. */
export interface FrameInputs {
  readonly game: StarSwarmState;
  /** Pre-wave countdown digit (3, 2, 1), or null when no countdown is showing. */
  readonly countdownDigit: number | null;
  /** True when the active countdown follows a wave clear (shows the "— WAVE N —" banner). */
  readonly waveBannerCountdown: boolean;
  /** True while the 1UP flash is on screen — part of the frame so its expiry publishes too. */
  readonly bonusFlash: boolean;
}

/** True when `next` would draw exactly what `prev` already did — skip the publish. */
export function sameFrame(prev: FrameInputs, next: FrameInputs): boolean {
  return (
    prev.game === next.game &&
    prev.countdownDigit === next.countdownDigit &&
    prev.waveBannerCountdown === next.waveBannerCountdown &&
    prev.bonusFlash === next.bonusFlash
  );
}

/**
 * The starfield scrolls only while the game is live. Paused, the frame holds still under the
 * pause overlay; at game over it holds the #2334 freeze frame behind the game-over overlay.
 * Either way nothing on screen moves.
 */
export function starfieldRuns(phase: StarSwarmState["phase"], paused: boolean): boolean {
  return !paused && phase !== "GameOver";
}
