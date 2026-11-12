/**
 * Yacht motion (#3749): how long each animation and pause takes, in one module, so the sounds
 * (#3750) can be timed to the same numbers. Each stays under its story ceiling (checked in
 * `__tests__/motion.test.ts`).
 *
 *   Your roll, from the press (t = 0):
 *     t = 0                         the rolled dice start to tumble, 35 ms apart, left to right
 *     t = TUMBLE_LAND_AT x 420      each die shows its final face and lands (a squash)
 *     t = tumbleTotalMs(n)          the last die is at rest: input unlocks
 *   A score: the cell pops (260 ms) and the total counts up (300 ms), from the press.
 *   The game's last score (yours in solo, the computer's in vs), from that score:
 *     t = END_BEAT_MS[outcome]      the result card (after any YACHT! / JOKER! celebration)
 *
 * Under Reduce Motion nothing animates: the faces change in place, a score just appears, the
 * computer's turn has no tumbles and half the pauses, and the card shows as soon as the game ends
 * (docs/ACCESSIBILITY.md section 3).
 */

// ---------------------------------------------------------------------------
// The tumble (Die.tsx)
// ---------------------------------------------------------------------------

/** One die's tumble: a full turn, a hop, faces flicking, then it lands with a squash. */
export const TUMBLE_MS = 420;
/** Each rolled die starts this long after the one to its left (only the dice being rolled). */
export const TUMBLE_STAGGER_MS = 35;
/** The die turns 0 to 360 degrees (ease-out) over this share of the tumble. */
export const TUMBLE_SPIN_SHARE = 0.85;
/**
 * The hop: up to this many pt (a sine), over `TUMBLE_HOP_SHARE` of the tumble. Small, so the die
 * stays inside the tray: with the corners of the turning die it rises about 18 pt, and the dice
 * row keeps that much room above the dice (`tumbleRise` in Die.tsx, review round 1).
 */
export const TUMBLE_HOP_PX = 6;
export const TUMBLE_HOP_SHARE = 0.8;
/** While it tumbles, the die shows a random face, a new one about this often. */
export const TUMBLE_FACE_MS = 70;
/** At this share of the tumble the die shows its final face and lands. */
export const TUMBLE_LAND_AT = 0.8;
/** The landing squash: scale 1 to this and back, over the rest of the tumble. */
export const TUMBLE_SQUASH_SCALE = 1.07;

/**
 * From the roll to the last of `count` dice at rest: the tumble plus the stagger. 0 for no dice.
 * The roll's input lock and `rollingIndices` both end here (audit bugs 8 and 9).
 */
export function tumbleTotalMs(count: number): number {
  if (count <= 0) return 0;
  return TUMBLE_MS + (Math.min(count, 5) - 1) * TUMBLE_STAGGER_MS;
}

/**
 * The input lock ends when every rolled die reports it has landed (its animation's end, so the
 * lock covers the real tumble even if it started a frame or two late). As a safety net it ends
 * anyway this long after the tumble should have.
 */
export const INPUT_LOCK_FALLBACK_MS = 250;
/** The longest the input lock can last for a roll of `count` dice. */
export function inputLockMaxMs(count: number): number {
  return count <= 0 ? 0 : tumbleTotalMs(count) + INPUT_LOCK_FALLBACK_MS;
}

// ---------------------------------------------------------------------------
// Hold, score commit, upper bonus
// ---------------------------------------------------------------------------

/** A die's hold: the ring and the lift (#3748) ease in and out over this. */
export const HOLD_MS = 150;

/** A score lands: its cell pops 1 to `SCORE_POP_SCALE` and back. Yours and the computer's. */
export const SCORE_POP_MS = 260;
export const SCORE_POP_SCALE = 1.2;
/** The total counts up to its new value (ease-out). */
export const TOTAL_COUNT_MS = 300;
/** The upper bonus is earned: the band's "+35" pulses, after the score's pop. */
export const BONUS_PULSE_MS = 400;
export const BONUS_PULSE_SCALE = 1.3;

// ---------------------------------------------------------------------------
// The jackpot celebration (YACHT! / JOKER!, YachtCelebrationAnimation via useCelebration)
// ---------------------------------------------------------------------------

/** The dice around the badge spring in this far apart. */
export const JACKPOT_PARTICLE_STAGGER_MS = 45;
/** The badge and the dice start to fade out. */
export const JACKPOT_EXIT_AT_MS = 2200;
/** The celebration is over (its `onDone`): an end beat waiting for it starts here. */
export const JACKPOT_DONE_MS = 2800;
export const JACKPOT_BADGE_FADE_OUT_MS = 500;
export const JACKPOT_PARTICLE_FADE_OUT_MS = 400;
/** Under Reduce Motion: the badge and dice shown still, then done. */
export const JACKPOT_REDUCED_DONE_MS = 1500;
/**
 * A safety net: an end beat waiting for a celebration starts after this even if the celebration
 * never reports that it is done, so the card can't be held for good.
 */
export const JACKPOT_WAIT_MAX_MS = JACKPOT_DONE_MS + 700;

// ---------------------------------------------------------------------------
// The computer's turn (useYachtCpuOpponent)
// ---------------------------------------------------------------------------

/** After its dice land, before its next step: time to read them. */
export const CPU_SETTLE_MS = 150;
/** Its hold decision is shown this long before it re-rolls. */
export const CPU_HOLD_MS = 500;
/** The pause before it scores. */
export const CPU_SCORE_BEAT_MS = 600;
/** Its last turn, after your last score in vs, plays this much faster (pauses and tumbles). */
export const CPU_LAST_TURN_SPEED = 2;
/** Under Reduce Motion its pauses are this much shorter (and it has no tumbles). */
export const CPU_REDUCED_MOTION_SPEED = 2;

/** One computer roll of `count` dice: its tumble, then the settle. */
export function cpuRollMs(count: number): number {
  return tumbleTotalMs(count) + CPU_SETTLE_MS;
}

/** How much faster than normal the computer plays a turn. */
export function cpuTurnSpeed(lastTurn: boolean, reduceMotion: boolean): number {
  return (lastTurn ? CPU_LAST_TURN_SPEED : 1) * (reduceMotion ? CPU_REDUCED_MOTION_SPEED : 1);
}

/**
 * The longest computer turn at `speed`: a roll of five, two holds and re-rolls of five, the score
 * beat. Its roll sounds and the score are inside it.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function cpuTurnMaxMs(speed = 1): number {
  return (cpuRollMs(5) + 2 * (CPU_HOLD_MS + cpuRollMs(5)) + CPU_SCORE_BEAT_MS) / speed;
}

// ---------------------------------------------------------------------------
// End beats (useYachtEndBeat)
// ---------------------------------------------------------------------------

/** The game's outcome for the end beat (and #3750's sounds). Solo: a new best is a win, else a tie. */
export type YachtEndOutcome = "win" | "loss" | "tie";

/** The pause between the game's last score and its result card. */
export const WIN_BEAT_MS = 1000;
export const LOSS_BEAT_MS = 600;
export const TIE_BEAT_MS = 600;

export function endBeatMs(outcome: YachtEndOutcome): number {
  return outcome === "win" ? WIN_BEAT_MS : outcome === "loss" ? LOSS_BEAT_MS : TIE_BEAT_MS;
}
