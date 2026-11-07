/**
 * #3526: the three looping sounds and the conditions that run them. Pure and React-free: the
 * canvas calls `updateLoops` with each ticked state and a flags object it keeps in a ref; a loop
 * is reported only when its flag CHANGES, so it costs one callback per transition. The check
 * itself allocates nothing (no filter, no new object) — it runs on the tick, never per render.
 */
import type { StarSwarmState } from "./types";

export type StarSwarmLoop = "shield" | "buddy" | "rout";

/** What each loop was last reported as; mutated in place by `updateLoops`. */
export type LoopFlags = Record<StarSwarmLoop, boolean>;

export const newLoopFlags = (): LoopFlags => ({ shield: false, buddy: false, rout: false });

/** The ROUT! banner's condition (`fleeingCount(state) > 0`), without building an array. */
function anyFleeing(state: StarSwarmState): boolean {
  for (const e of state.enemies) if (e.isAlive && e.phase === "Fleeing") return true;
  return false;
}

/**
 * Shield active, Buddy on screen, any grunt Fleeing. Calls `emit(loop, on)` for each condition
 * that changed since the last call and records it in `flags`.
 */
export function updateLoops(
  state: StarSwarmState,
  flags: LoopFlags,
  emit: (loop: StarSwarmLoop, on: boolean) => void
): void {
  const shield = state.activePowerUp?.type === "shield";
  if (shield !== flags.shield) {
    flags.shield = shield;
    emit("shield", shield);
  }
  const buddy = state.buddyShips.length > 0;
  if (buddy !== flags.buddy) {
    flags.buddy = buddy;
    emit("buddy", buddy);
  }
  const rout = anyFleeing(state);
  if (rout !== flags.rout) {
    flags.rout = rout;
    emit("rout", rout);
  }
}
