/**
 * Yacht replay recording (#3282, epic #3273).
 *
 * Every turn of both players is one `turn_completed` event, recorded when the
 * turn is scored. A turn is built in memory while it is played (a push per
 * roll or hold tap, nothing else) and handed to the shared GameRecorder once,
 * so a turn is one recorder unit, one event and one storage write. Nothing
 * reaches the recorder during the dice animation.
 *
 * The event's `data` (the recorder adds `v`, `unit`, `t_ms` and, in a vs game,
 * `actor` = `{seat, kind}`), compact keys, ASCII, booleans left out when false:
 *
 *     r       round, 1..13
 *     rolls   1..3 rolls: [dice] or [dice, mask] — the five dice the roll
 *             produced, and the hold mask going INTO it (bit i = die i kept;
 *             left out when 0, which the first roll always is)
 *     h       hold taps between rolls, [after_roll, die, held 1|0] (the human
 *             only, at most MAX_HOLD_CHANGES; left out when none)
 *     ro      rolls of this turn played before the app was killed and so
 *             missing from `rolls` (left out when 0)
 *     s       the scored choice, [category, value]; category is the index in
 *             CATEGORIES (engine.ts)
 *     alt     the other legal categories, flat [category, value, ...]
 *     jk      1 when the Joker rule applied (an extra Yacht, Yacht box = 50)
 *     yb      1 when this score earned a Yacht bonus (100)
 *     ub      1 when this score earned the upper bonus (35)
 *     yc      Yacht bonus count after the turn (left out when 0)
 *     us      upper subtotal after the turn
 *     tot     total score after the turn
 *     ev      the computer only: [EV of its choice, EV of the best legal
 *             category], the oracle's expected total still to come, this
 *             score included, under optimal play
 *
 * `jk` and `yb` are separate flags (the old `is_joker` mixed them). In this
 * engine they coincide — the Joker rule applies exactly when an extra Yacht
 * earns the bonus — but they are different facts and are recorded as such.
 *
 * The starting scorecard is empty and every roll is random, so the game
 * rebuilds from the events alone: the dice of each roll and the category
 * chosen are all the engine needs (docs/games/yacht.md, "Replay recording").
 *
 * Cost → performance → data: building a turn is a few small arrays and one
 * object; there is no `JSON.stringify`, no storage and no clone of game
 * state. The recorder measures and saves the unit at an idle moment.
 */

import * as Sentry from "@sentry/react-native";

import { sentryThrottle } from "../_shared/sentryThrottle";
import { CATEGORIES, jokerActive, type Category } from "./engine";
import type { GameState } from "./types";

/** The event type. */
export const TURN_COMPLETED = "turn_completed";

/** Hold taps recorded per turn; later taps are not (the next roll's mask still says what was kept). */
export const MAX_HOLD_CHANGES = 16;

/** A roll: the dice it produced, and (when not 0) the hold mask going into it. */
export type RollTuple = readonly [number[]] | readonly [number[], number];

/** One turn's `data`, before the recorder's envelope. */
export interface TurnData {
  r: number;
  rolls: RollTuple[];
  h?: [number, number, number][];
  ro?: number;
  s: [number, number];
  alt?: number[];
  jk?: 1;
  yb?: 1;
  ub?: 1;
  yc?: number;
  us: number;
  tot: number;
  ev?: [number, number];
}

/** The recorder calls a turn needs (what `useGameRecorder` returns). */
export interface TurnSink {
  beginUnit: (n?: number) => number;
  record: (
    type: "turn_completed",
    data?: Record<string, unknown>,
    actor?: { readonly seat: number; readonly kind: "human" | "cpu" }
  ) => void;
  closeUnit: () => void;
}

/** Hold mask: bit i set when die i is kept. */
function maskOf(held: readonly boolean[]): number {
  let m = 0;
  for (let i = 0; i < held.length; i += 1) if (held[i]) m |= 1 << i;
  return m;
}

/**
 * The recorder unit number of a turn: a solo game has one turn per round
 * (unit = round); a vs game has two (human `2r - 1`, computer `2r`). It is
 * derived from the round, so a game resumed after a kill continues the
 * numbering with no counter to restore (GAME-CONTRACT §2.10).
 */
export function turnUnit(seat: 0 | 1, round: number, vs: boolean): number {
  return vs ? 2 * round - 1 + seat : round;
}

/**
 * Records a finished turn: one unit, one event. Solo turns carry no actor
 * (the player is the only one); a vs game's carry `{seat, kind}`.
 */
export function emitTurn(sink: TurnSink, turn: TurnData, seat: 0 | 1, vs: boolean): void {
  sink.beginUnit(turnUnit(seat, turn.r, vs));
  sink.record(
    TURN_COMPLETED,
    turn as unknown as Record<string, unknown>,
    vs ? { seat, kind: seat === 0 ? "human" : "cpu" } : undefined
  );
  sink.closeUnit();
}

/** What `TurnLog.finish` needs about the score that ends the turn. */
export interface ScoredTurn {
  /** The state the score was made from (final dice, `rolls_used`, scorecard). */
  readonly prev: GameState;
  /** The state after scoring. */
  readonly next: GameState;
  readonly category: Category;
  /** Every legal category and its value for `prev` (the engine's `possibleScores`). */
  readonly alternatives: Readonly<Record<string, number>>;
  /** The computer's `[EV of its choice, EV of the best category]`. */
  readonly ev?: readonly [number, number];
}

/** One player's turn, collected in memory as it is played. */
export interface TurnLog {
  /** A roll was made: `next` is the state it produced (`held` is the mask it was made with). */
  roll(next: GameState): void;
  /** A hold tap, after `rollsUsed` rolls. */
  hold(rollsUsed: number, die: number, held: boolean): void;
  /** The turn's `data` for the score, and the log is cleared for the next turn. */
  finish(scored: ScoredTurn): TurnData;
  /** Throw away the turn in progress (a new game). */
  reset(): void;
}

const ROUND_TO_TENTH = 10;

export function createTurnLog(): TurnLog {
  let rolls: RollTuple[] = [];
  let holds: [number, number, number][] = [];
  return {
    roll(next) {
      if (rolls.length >= 3) return;
      const mask = maskOf(next.held);
      const dice = [...next.dice];
      rolls.push(mask === 0 ? [dice] : [dice, mask]);
    },
    hold(rollsUsed, die, held) {
      if (holds.length >= MAX_HOLD_CHANGES) return;
      holds.push([rollsUsed, die, held ? 1 : 0]);
    },
    finish({ prev, next, category, alternatives, ev }) {
      // A turn resumed after a kill and scored without another roll has seen
      // none: the dice it is scored on are the only roll there is to show.
      if (rolls.length === 0) rolls.push([[...prev.dice]]);
      const index = CATEGORIES.indexOf(category);
      const alt: number[] = [];
      for (const [name, value] of Object.entries(alternatives)) {
        if (name !== category) alt.push(CATEGORIES.indexOf(name as Category), value);
      }
      const turn: TurnData = {
        r: prev.round,
        rolls,
        s: [index, next.scores[category] ?? 0],
        us: next.upper_subtotal,
        tot: next.total_score,
      };
      if (holds.length > 0) turn.h = holds;
      const missed = prev.rolls_used - rolls.length;
      if (missed > 0) turn.ro = missed;
      if (alt.length > 0) turn.alt = alt;
      if (jokerActive(prev)) turn.jk = 1;
      if (next.yacht_bonus_count > prev.yacht_bonus_count) turn.yb = 1;
      if (prev.upper_bonus === 0 && next.upper_bonus > 0) turn.ub = 1;
      if (next.yacht_bonus_count > 0) turn.yc = next.yacht_bonus_count;
      if (ev) {
        turn.ev = [
          Math.round(ev[0] * ROUND_TO_TENTH) / ROUND_TO_TENTH,
          Math.round(ev[1] * ROUND_TO_TENTH) / ROUND_TO_TENTH,
        ];
      }
      // The log is the turn's alone: hand its arrays over (the recorder keeps
      // them) and start fresh arrays for the next turn.
      rolls = [];
      holds = [];
      return turn;
    },
    reset() {
      rolls = [];
      holds = [];
    },
  };
}

/**
 * Report a failure to record a turn, at most once per `op` per throttle window
 * (a bad build would otherwise report every turn). Never throws.
 */
export function reportRecordingError(e: unknown, op: string): void {
  try {
    if (!sentryThrottle.allow(`yacht.replay.${op}`, "error")) return;
    Sentry.captureException(e, { tags: { subsystem: "yacht.replay", op } });
  } catch {
    // reporting must never reach the game
  }
}

/** The `game_started` event data: the mode, and in a vs game the computer's type and difficulty. */
export function startedData(difficulty: string | null): Record<string, unknown> {
  return difficulty ? { v: 1, mode: "vs", cpu_type: "oracle", difficulty } : { v: 1, mode: "solo" };
}
