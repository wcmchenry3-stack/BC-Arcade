/**
 * #3560: the one-shot Shield and Buddy sound cues, detected from two consecutive states. Pure and
 * React-free like `soundLoops.ts`: the canvas calls `emitSoundCues(prev, next, emit)` on each
 * ticked state (and around a dev-panel injection) and gets one callback per edge. Every check is
 * a comparison or a loop over the (at most a handful of) Buddy ships — nothing allocates.
 *
 * The explosion-family sounds (Smart Bomb blast, Buddy down, rock break, generic explosion) are
 * dispatched together by `emitTickSounds`, which both canvases call, because they share one
 * priority rule.
 */
import { bombJustDetonated, buddyJustLost } from "./engine";
import type { Asteroid, StarSwarmState } from "./types";

export type StarSwarmCue = "shieldOn" | "shieldWarn" | "shieldOff" | "buddyIn" | "buddyOut";

/** The Shield's warning sound plays when this many ms (of POWERUP_DURATION) are left. */
export const SHIELD_WARN_MS = 1000;

/** The tick the Shield becomes active: collected, applied from the bank, injected, or replacing Lightning. */
export function shieldJustOn(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.activePowerUp?.type === "shield" && prev.activePowerUp?.type !== "shield";
}

/**
 * The tick an active Shield's remaining time crosses down through `SHIELD_WARN_MS`. Needs the
 * Shield active on both ticks, so it never fires for a Shield that ended or was replaced first,
 * and it fires once per activation (the time only counts down; re-collecting a Shield restarts it).
 */
export function shieldWarnCrossed(prev: StarSwarmState, next: StarSwarmState): boolean {
  const a = prev.activePowerUp;
  const b = next.activePowerUp;
  return (
    a?.type === "shield" &&
    b?.type === "shield" &&
    a.remainingMs > SHIELD_WARN_MS &&
    b.remainingMs <= SHIELD_WARN_MS
  );
}

/**
 * The tick an active Shield stops for an in-run reason (expiry, replaced by Lightning, cleared at
 * a wave boundary). Not at game over; a new run replaces the state outside the tick, so it never
 * reaches here.
 */
export function shieldJustOff(prev: StarSwarmState, next: StarSwarmState): boolean {
  return (
    prev.activePowerUp?.type === "shield" &&
    next.activePowerUp?.type !== "shield" &&
    next.phase !== "GameOver"
  );
}

/** The tick a Buddy is launched (a pickup, a banked one applied, or the dev panel); it starts Entering. */
export function buddyJustEntered(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.runStats.buddyLaunched > prev.runStats.buddyLaunched;
}

/** The tick any Buddy goes from flying/on station to Leaving (peels off). Not a Buddy shot down. */
export function buddyJustLeft(prev: StarSwarmState, next: StarSwarmState): boolean {
  for (const b of next.buddyShips) {
    if (b.phase !== "Leaving") continue;
    for (const p of prev.buddyShips) if (p.id === b.id && p.phase !== "Leaving") return true;
  }
  return false;
}

/** Longest frame step the canvas feeds the engine (`DT_CAP_MS`); used to tell a culled rock from a broken one. */
const ROCK_STEP_MS = 33;

/** Total rocks broken this wave, over all breakers (`waveStats.rocks.broken`). */
function rocksBrokenTotal(s: StarSwarmState): number {
  const b = s.waveStats.rocks.broken;
  return b.player + b.enemy + b.bomb + b.contact;
}

/**
 * How many rocks broke on the tick between `prev` and `next` (0 for none). Every break bumps one
 * of the wave's `rocks.broken` counters exactly once (#3247), so the rise of their sum is the
 * count. It is only comparable inside one wave: when the wave changed, the counters restarted at
 * 0 and nothing is reported (a rock broken on the very tick of the boundary is not sounded).
 */
export function rockBreakCount(prev: StarSwarmState, next: StarSwarmState): number {
  if (prev.wave !== next.wave) return 0;
  const d = rocksBrokenTotal(next) - rocksBrokenTotal(prev);
  return d > 0 ? d : 0;
}

/**
 * Whether a rock that vanished from the list was culled off-screen rather than broken. The engine
 * (`tickAsteroids`) drops a rock once it is past the canvas by a margin (bottom `+40`, sides
 * `+-60 + radius`); we project the rock one frame step (`ROCK_STEP_MS`) and apply the same test.
 */
function rockLeftScreen(a: Asteroid, w: number, h: number): boolean {
  const x = a.x + a.vx * ROCK_STEP_MS;
  const y = a.y + a.vy * ROCK_STEP_MS;
  return !(y - a.radius < h + 40 && x > -60 - a.radius && x < w + 60 + a.radius);
}

/**
 * Which rock sound the tick between `prev` and `next` calls for: "large" if a large rock broke
 * (shot, bomb or contact), "small" if only small rocks did, null if none broke. One sound per
 * tick, the bigger event wins. Rule: nothing unless `rockBreakCount` > 0; then "large" when a
 * large rock of `prev.asteroids` is gone from `next.asteroids` (matched by id) and was not
 * leaving the screen (`rockLeftScreen`, so a culled rock is not mistaken for a break). A rise in
 * the counter that cannot be attributed (a rock spawned and broken within the tick, ...) is "small".
 * A loop over the handful of rocks; nothing allocates.
 */
export function rockBreakKind(
  prev: StarSwarmState,
  next: StarSwarmState
): "large" | "small" | null {
  if (rockBreakCount(prev, next) === 0) return null;
  const rocks = next.asteroids;
  for (const a of prev.asteroids) {
    if (a.kind !== "large") continue;
    let found = false;
    for (const b of rocks) {
      if (b.id === a.id) {
        found = true;
        break;
      }
    }
    if (!found && !rockLeftScreen(a, next.canvasW, next.canvasH)) return "large";
  }
  return "small";
}

/** Calls `emit(cue)` for each Shield / Buddy edge between `prev` and `next`. */
export function emitSoundCues(
  prev: StarSwarmState,
  next: StarSwarmState,
  emit: (cue: StarSwarmCue) => void
): void {
  if (shieldJustOn(prev, next)) emit("shieldOn");
  if (shieldWarnCrossed(prev, next)) emit("shieldWarn");
  if (shieldJustOff(prev, next)) emit("shieldOff");
  if (buddyJustEntered(prev, next)) emit("buddyIn");
  if (buddyJustLeft(prev, next)) emit("buddyOut");
}

/** Explosions in `next` that were not in `prev` (matched by id): the ones spawned this tick. */
export function explosionsSpawned(prev: StarSwarmState, next: StarSwarmState): number {
  let n = 0;
  for (const e of next.explosions) {
    let old = false;
    for (const p of prev.explosions) {
      if (p.id === e.id) {
        old = true;
        break;
      }
    }
    if (!old) n++;
  }
  return n;
}

/** Where `emitTickSounds` sends each explosion-family sound. Build it once (no per-tick allocation). */
export interface TickSoundSinks {
  bombBlast(): void;
  buddyLost(): void;
  explosion(): void;
  rockBreak(kind: "large" | "small"): void;
}

/**
 * #3560: the explosion-family sounds for the tick between `prev` and `next`, shared by the native
 * and web canvases so the rule lives in one place.
 * - A Smart Bomb blast has its own sound and replaces every other explosion sound that tick.
 * - A Buddy shot down plays its own sound; its own explosion does not also play the generic one.
 * - A rock break plays the stone sound (one per tick, "large" wins); its explosions are not
 *   doubled by the generic one.
 * - The generic explosion plays when explosions spawned this tick (counted by id, so explosions
 *   expiring on the same tick do not hide a new one) exceed those of the Buddies and rocks.
 */
export function emitTickSounds(
  prev: StarSwarmState,
  next: StarSwarmState,
  sinks: TickSoundSinks
): void {
  // Buddies lost this tick (each leaves one explosion); at least 1 when the edge fires.
  const buddies = buddyJustLost(prev, next)
    ? Math.max(1, next.runStats.buddyLost - prev.runStats.buddyLost)
    : 0;
  if (buddies > 0) sinks.buddyLost();
  if (bombJustDetonated(prev, next)) {
    sinks.bombBlast();
    return;
  }
  const rocks = rockBreakCount(prev, next);
  if (explosionsSpawned(prev, next) > rocks + buddies) sinks.explosion();
  if (rocks > 0) {
    const kind = rockBreakKind(prev, next);
    if (kind) sinks.rockBreak(kind);
  }
}
