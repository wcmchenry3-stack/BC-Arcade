/**
 * Cascade sound pacing (#3702): what plays when, timed to the motion (`motion.ts`) and paced the
 * way the haptics are (`haptics.ts`).
 *
 *   - drop: as the piece leaves the spawner;
 *   - land: the light file for tiers 0-4, the heavy one for 5-10, louder with the tier;
 *     landings closer than `MOTION.sound.landGapMs` are dropped;
 *   - merge: the pre-pitched file of the tier it made. A chain link (2, 3, …) plays its merge and
 *     its chain step together on the counter's paced steps (`MOTION.chain.stepMs`), as the chain
 *     haptics do; at most `maxQueued` wait, more are dropped;
 *   - danger: one tick on each on-beat of the lid's blink. The pacer steps the same phase as the
 *     board (`stepDangerPhase`, from the same ratio, each frame moving at most
 *     `MOTION.maxFrameStepMs`), so the ticks are locked to the blink and, like its onsets, at
 *     least `MOTION.danger.fastMs` apart: never more than 3 a second. Louder as the count runs;
 *   - win: at the winning merge, its chord as the celebration's card shows (2.1 s);
 *   - game over: at the game over, its chord as the loss card shows (`gameOver.cardAtMs`).
 *     Merges and chain steps still waiting are dropped.
 *
 * Every sound is played from a timer, never from inside the frame that found the event, and
 * nothing plays while `quiet` (a restored game settling, a test fast-forward): the screen passes
 * the same flag its haptics use. Mute is the player's concern (`useCascadeSounds`).
 */
import { MOTION, DANGER_IDLE_PHASE, stepDangerPhase } from "./motion";
import { chainSound, dangerVolume, landSound, mergeSound, type CascadeSoundName } from "./sounds";

export interface SoundPacerDeps {
  now(): number;
  schedule(run: () => void, delayMs: number): void;
  play(name: CascadeSoundName, volume: number): void;
}

export interface SoundPacer {
  drop(): void;
  land(tier: number): void;
  /** A merge that made `tier`; `link` is its place in the drop's chain (1 = a plain merge). */
  merge(tier: number, link: number): void;
  /** The lid count after a frame of `frameMs`; `quiet` steps the blink's phase but plays nothing. */
  danger(ratio: number, frameMs: number, quiet: boolean): void;
  win(): void;
  gameOver(): void;
  /** A new game: forget the chain, the blink's phase and the landing gap; drop what is waiting. */
  reset(): void;
}

/** The shortest gap between two danger ticks, ms (the blink's 3 Hz ceiling, WCAG 2.3.1). */
export const DANGER_TICK_MIN_GAP_MS = 1000 / MOTION.danger.maxHz;

export function createSoundPacer(deps: SoundPacerDeps): SoundPacer {
  const S = MOTION.sound;
  let generation = 0;
  let queued = 0;
  let lastLand = -Infinity;
  let chainStart = 0;
  let phase: number = DANGER_IDLE_PHASE;
  let lastTick = -Infinity;

  /** Plays `name` from a timer, `delayMs` from now; dropped by a reset before it is due. */
  function at(name: CascadeSoundName, volume: number, delayMs: number, counted: boolean): void {
    if (counted) {
      if (queued >= S.maxQueued) return;
      queued++;
    }
    const gen = generation;
    deps.schedule(
      () => {
        if (gen !== generation) return;
        if (counted) queued--;
        deps.play(name, volume);
      },
      Math.max(0, delayMs)
    );
  }

  return {
    drop() {
      at("drop", 1, 0, false);
    },
    land(tier) {
      const now = deps.now();
      if (now - lastLand < S.landGapMs) return;
      lastLand = now;
      const { name, volume } = landSound(tier);
      at(name, volume, 0, false);
    },
    merge(tier, link) {
      const now = deps.now();
      const chain = chainSound(link);
      if (chain === null) {
        at(mergeSound(tier), 1, 0, true);
        return;
      }
      if (link === 2) chainStart = now;
      const delay = chainStart + (link - 2) * MOTION.chain.stepMs - now;
      at(mergeSound(tier), 1, delay, true);
      at(chain, 1, delay, true);
    },
    danger(ratio, frameMs, quiet) {
      const dt = Math.min(Math.max(0, frameMs), MOTION.maxFrameStepMs);
      const next = stepDangerPhase(phase, dt, ratio);
      const onset = ratio > 0 && next < phase; // the phase wrapped: an on-beat starts
      phase = next;
      if (!onset || quiet) return;
      const now = deps.now();
      if (now - lastTick < DANGER_TICK_MIN_GAP_MS) return;
      lastTick = now;
      at("danger", dangerVolume(ratio), 0, false);
    },
    win() {
      at("win", 1, 0, false);
    },
    gameOver() {
      generation++;
      queued = 0;
      at("game-over", 1, 0, false);
    },
    reset() {
      generation++;
      queued = 0;
      lastLand = -Infinity;
      lastTick = -Infinity;
      phase = DANGER_IDLE_PHASE;
    },
  };
}
