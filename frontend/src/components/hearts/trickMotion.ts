/**
 * Hearts card play and trick motion, tuned against the sounds (#3574, owner decision
 * "A. Brisk", 2026-11-09). Every value the trick's motion and its sound cues use lives here,
 * so the screen, the trick and the tests agree. See docs/games/hearts.md (Motion and sound
 * timing) and the design log, docs/games/arcade-sound-design.md.
 */
import { Easing } from "react-native-reanimated";

/** A played card's flight from its seat to its trick slot, to contact. */
export const FLIGHT_MS = 280;
export const FLIGHT_EASING = Easing.out(Easing.cubic);

/**
 * Card place (`hearts.cardPlay`) is played this long before the flight's contact: the
 * card-place file's transient peaks at about 45 ms, so it lands on the contact.
 */
export const SOUND_LEAD_MS = 40;

/** The rest after the trick's last card lands, before the sweep. */
export const TRICK_HOLD_MS = 300;

/** The sweep of all four cards together to the winner's plate. */
export const SWEEP_MS = 200;
export const SWEEP_EASING = Easing.in(Easing.quad);
/** Sweep progress (0..1) at which the cards start to fade out. */
export const SWEEP_FADE_FROM = 0.6;

/** A swept card's opacity at sweep progress `p` (0..1): whole until SWEEP_FADE_FROM, then to 0. */
export function sweepOpacity(p: number): number {
  "worklet";
  return p <= SWEEP_FADE_FROM ? 1 : Math.max(0, 1 - (p - SWEEP_FADE_FROM) / (1 - SWEEP_FADE_FROM));
}

/**
 * The sweep reports its end from the UI thread (its timing's end callback, through runOnJS).
 * If that never arrives (an animation the system cut short reports `finished: false`), a JS
 * backstop this long after the sweep's start completes the trick instead: the AI loop waits
 * on that completion with no timeout of its own, so a lost one would freeze the game. The
 * margin is wide (250 ms) so a janky first UI frame never lets the backstop clear the trick
 * before the cards have arrived.
 */
export const SWEEP_BACKSTOP_MS = SWEEP_MS + 250;

/**
 * trick-gathered-*.ogg rises to its thump at 193 ms. Played at the sweep's start, the thump
 * lands about when the cards reach the winner (200 ms). For the docs and tests; nothing waits on it.
 */
export const TRICK_GATHER_PEAK_MS = 193;

/** The CPU players' pace: at least a card's flight plus about 100 ms. */
export const AI_PACE_MS = 450;

/**
 * If a Q♠'s flight never reports its landing (the trick remounted mid-flight), the queen's
 * moment starts anyway this long after the throw, so the table it holds is never left waiting.
 */
export const QUEEN_LANDING_FALLBACK_MS = FLIGHT_MS + 120;
