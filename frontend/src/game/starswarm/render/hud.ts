/**
 * #2566 (epic #2562, phase 4): the native canvas's HUD, split by how often it changes.
 *
 * `deriveHud` is everything the React Native HUD shows that changes on events — score, wave,
 * ladders, lives, banners, the countdown. The canvas pushes it to React only when `sameHud` says
 * it changed, so steady play commits a few times a second (score ticks) and a paused game never.
 *
 * `hudCues` is the two values that move every frame — the mission-complete fade and the power-up
 * bar. They go to Reanimated shared values driving animated styles, never through React state.
 *
 * Pure and React-free, so the split is unit-tested.
 */
import {
  POWERUP_DURATION,
  MISSION_COMPLETE_FADE_MS,
  showMissionCompleteBanner,
  isBossWave,
  fleeingCount,
} from "../engine";
import type { DifficultyTier, StarSwarmState } from "../types";

export interface HudState {
  readonly score: number;
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly guns: number;
  readonly hull: number;
  readonly lives: number;
  /** Pre-wave countdown digit (3, 2, 1), or null. */
  readonly countdownDigit: number | null;
  /** The countdown follows a wave clear — show "— WAVE N —" above the digit. */
  readonly waveBannerCountdown: boolean;
  readonly bonusFlash: boolean;
  /** The cosmetic MISSION COMPLETE banner is mounted (its fade is a cue, not state). */
  readonly missionComplete: boolean;
  /** #2489 ROUT! banner — grunts are fleeing. */
  readonly rout: boolean;
  /** #2490 CARRIER SIGHTED banner — a boss wave is swooping in. */
  readonly bossWave: boolean;
  readonly gameOver: boolean;
  /** The active duration power-up, for the indicator label and colour (its bar is a cue). */
  readonly powerUp: "shield" | "lightning" | null;
}

export interface HudExtras {
  readonly countdownDigit: number | null;
  readonly waveBannerCountdown: boolean;
  readonly bonusFlash: boolean;
}

/** The event-driven half of the HUD — the exact conditions the render used to evaluate inline. */
export function deriveHud(state: StarSwarmState, extras: HudExtras): HudState {
  const countdown = extras.countdownDigit !== null;
  const pu = state.activePowerUp?.type;
  return {
    score: state.score,
    wave: state.wave,
    difficulty: state.difficulty,
    guns: state.player.guns,
    hull: state.player.hull,
    lives: state.player.lives,
    countdownDigit: extras.countdownDigit,
    waveBannerCountdown: extras.waveBannerCountdown,
    bonusFlash: extras.bonusFlash,
    missionComplete: showMissionCompleteBanner(state, countdown),
    rout: fleeingCount(state) > 0 && !countdown,
    bossWave: isBossWave(state.wave) && state.phase === "SwoopIn" && !countdown,
    gameOver: state.phase === "GameOver",
    powerUp: pu === "shield" || pu === "lightning" ? pu : null,
  };
}

/** True when `b` would render exactly what `a` did — skip the React commit. */
export function sameHud(a: HudState, b: HudState): boolean {
  const keys = Object.keys(a) as (keyof HudState)[];
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export interface HudCues {
  /** MISSION COMPLETE opacity: 1 until its last MISSION_COMPLETE_FADE_MS, then down to 0. */
  readonly missionOpacity: number;
  /** Power-up bar fill, 0–1; 0 with no duration power-up active. */
  readonly powerUpFraction: number;
}

/** The per-frame half of the HUD, for shared values. */
export function hudCues(state: StarSwarmState): HudCues {
  return {
    missionOpacity: Math.max(0, Math.min(1, state.missionCompleteTimer / MISSION_COMPLETE_FADE_MS)),
    powerUpFraction: state.activePowerUp
      ? Math.max(0, Math.min(1, state.activePowerUp.remainingMs / POWERUP_DURATION))
      : 0,
  };
}
