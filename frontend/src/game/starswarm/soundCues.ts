/**
 * #3560: the one-shot Shield and Buddy sound cues, detected from two consecutive states. Pure and
 * React-free like `soundLoops.ts`: the canvas calls `emitSoundCues(prev, next, emit)` on each
 * ticked state (and around a dev-panel injection) and gets one callback per edge. Every check is
 * a comparison or a loop over the (at most a handful of) Buddy ships — nothing allocates.
 *
 * Buddy-shot-down (`buddyJustLost`) and the Smart Bomb blast (`bombJustDetonated`) live in the
 * engine and are handled by the canvas directly, because they also silence the generic explosion.
 */
import type { StarSwarmState } from "./types";

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
