/**
 * Launching an action's motion (#3572, #3573): the flights, and what it does to the earlier
 * actions it calls off. Shared by the card games' screens and their motion fuzz tests, so all
 * run the same rules.
 */
import type { CardFlightStore } from "./cardFlights";
import { PLACE_LEAD_MS, type MotionPlan } from "./cardMotion";
import type { CueClock } from "./useCueClock";

export interface LaunchInput {
  readonly plan: MotionPlan;
  readonly now: number;
  /** This action's id (its flights' and cues' group). */
  readonly action: number;
  readonly store: CardFlightStore;
  readonly clock: CueClock;
  /** Plays card place for the cards of called-off action `calledOff` that still land. */
  readonly playPlace: (calledOff: number) => void;
  /** When every flight of this action has landed. */
  readonly onLanded?: () => void;
}

/**
 * Cancels the pending cues of every action this one calls off, and launches its flights.
 *
 * - A called-off action whose landing sound (card place or the multi-card move) was still
 *   pending, and which still has cards in flight that this action does not take over, gets one
 *   card place on their last contact. A landing sound already played is never played again,
 *   and an action that never had one (a draw) never gets one.
 * - Returns whether this action owes a flip: it takes over a turn face up (`plan.owesFlip`)
 *   whose flip or fan was still pending when it was cancelled. One already played is not
 *   played again.
 */
export function launchMotion(input: LaunchInput): { owesFlip: boolean } {
  const { plan, now, action, store, clock, playPlace, onLanded } = input;
  const taken = new Set([...plan.flights.map((f) => f.key), ...plan.settled]);
  let flipDropped = false;
  for (const a of plan.cancelled) {
    const dropped = clock.cancelGroup(a);
    if (dropped.includes("flip") || dropped.includes("fan")) flipDropped = true;
    if (!dropped.includes("place") && !dropped.includes("multi")) continue;
    const last = store.lastContactOf(a, taken);
    if (last !== null) clock.schedule(() => playPlace(a), last - PLACE_LEAD_MS - now, a, "place");
  }
  store.landKeys(plan.settled);
  store.launch(plan.flights, now, action, onLanded);
  return { owesFlip: plan.owesFlip && flipDropped };
}
