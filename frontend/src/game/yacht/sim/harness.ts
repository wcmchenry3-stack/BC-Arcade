/**
 * Yacht simulation harness (#2245) — the single game runner behind the
 * PR smoke test, the scheduled calibration gate, the baseline printer and
 * `scripts/simulate-yacht.ts`.
 *
 * A matchup is played in blocks of four games. In `paired` mode each block
 * draws two dice streams X and Y and plays every combination of turn order
 * and dice assignment:
 *
 *   game | moves first | A's dice | B's dice
 *   -----+-------------+----------+---------
 *     0  |      A      |    X     |    Y
 *     1  |      A      |    Y     |    X      <- mirror of game 0
 *     2  |      B      |    X     |    Y      <- order swap of game 0
 *     3  |      B      |    Y     |    X      <- order swap of game 1
 *
 * so each player faces the same dice in both seats and both players face
 * the same dice across each mirrored pair. Luck cancels inside a block,
 * which is why block means (not single games) are the statistical unit in
 * `stats.ts`. `independent` mode keeps the same four-game shape and order
 * balance but gives every player-game a fresh stream: no variance
 * reduction, useful as the unbiased baseline.
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { CATEGORIES, getRng, newGame, roll, score, setRng, type Category } from "../engine";
import type { AiDifficulty, GameState } from "../types";
import { deriveSeed, turnDiceTable, turnNoiseStream } from "./streams";

export type DiceMode = "paired" | "independent";

/** A player strategy. Built-in difficulties come from `difficultyPolicy`. */
export interface SimPolicy {
  readonly label: string;
  hold(state: GameState): boolean[];
  category(state: GameState, opponentScore: number, opponentRound: number): Category;
}

export function difficultyPolicy(difficulty: AiDifficulty): SimPolicy {
  return {
    label: difficulty,
    hold: (state) => holdStrategy(state, difficulty),
    category: (state) => scoreStrategy(state, difficulty),
  };
}

/** One player's final scorecard. */
export interface PlayerResult {
  readonly label: string;
  readonly score: number;
  readonly upperSubtotal: number;
  readonly bonus: boolean;
  readonly yachtBonusCount: number;
  readonly categories: Readonly<Record<Category, number>>;
  /** The category filled each round, in order (13 entries). */
  readonly fillOrder: readonly Category[];
  /** Every dice array this player saw, in order. Only with `recordDice`. */
  readonly diceLog?: readonly (readonly number[])[];
}

export interface GameRecord {
  /** True when player A moved first. */
  readonly aFirst: boolean;
  /** Which of the block's two paired streams A used ("X" or "Y"). */
  readonly aStream: "X" | "Y";
  readonly a: PlayerResult;
  readonly b: PlayerResult;
}

export interface BlockRecord {
  readonly games: readonly [GameRecord, GameRecord, GameRecord, GameRecord];
}

export interface MatchupConfig {
  readonly a: SimPolicy;
  readonly b: SimPolicy;
  readonly blocks: number;
  readonly mode: DiceMode;
  readonly seed: number;
  /** Keep every player's dice log (tests only — memory grows with games). */
  readonly recordDice?: boolean;
}

export interface MatchupRun {
  readonly a: string;
  readonly b: string;
  readonly mode: DiceMode;
  readonly seed: number;
  readonly blocks: readonly BlockRecord[];
}

interface Seat {
  readonly policy: SimPolicy;
  readonly streamSeed: number;
}

const NO_HOLDS = [false, false, false, false, false];

function playTurn(
  state: GameState,
  seat: Seat,
  opponent: GameState,
  diceLog: number[][] | null,
  fills: Category[]
): GameState {
  const round = state.round;
  const table = turnDiceTable(seat.streamSeed, round);
  setRng(turnNoiseStream(seat.streamSeed, round));

  let s = roll(state, NO_HOLDS, { dice: table[0]! });
  diceLog?.push([...s.dice]);
  while (s.rolls_used < 3) {
    const holds = seat.policy.hold(s);
    // Keeping every die ends the turn early, as in the live AI loop.
    if (holds.every((h) => h)) break;
    s = roll(s, holds, { dice: table[s.rolls_used]! });
    diceLog?.push([...s.dice]);
  }
  const category = seat.policy.category(s, opponent.total_score, opponent.round);
  fills.push(category);
  return score(s, category);
}

function toResult(
  label: string,
  state: GameState,
  diceLog: number[][] | null,
  fillOrder: readonly Category[]
): PlayerResult {
  const categories = {} as Record<Category, number>;
  for (const cat of CATEGORIES) categories[cat] = state.scores[cat] ?? 0;
  return {
    label,
    score: state.total_score,
    upperSubtotal: state.upper_subtotal,
    bonus: state.upper_bonus > 0,
    yachtBonusCount: state.yacht_bonus_count,
    categories,
    fillOrder,
    ...(diceLog ? { diceLog } : {}),
  };
}

/**
 * Play one 13-round game. `first` moves first every round. Each
 * `category()` call sees the opponent's current total and round, so a
 * second mover knows the opponent has already banked this round (#2200).
 */
export function playGame(
  first: Seat,
  second: Seat,
  recordDice = false
): { first: PlayerResult; second: PlayerResult } {
  const previousRng = getRng();
  const firstLog = recordDice ? ([] as number[][]) : null;
  const secondLog = recordDice ? ([] as number[][]) : null;
  const fills0: Category[] = [];
  const fills1: Category[] = [];
  let p0 = newGame();
  let p1 = newGame();
  try {
    for (let round = 0; round < 13; round++) {
      p0 = playTurn(p0, first, p1, firstLog, fills0);
      p1 = playTurn(p1, second, p0, secondLog, fills1);
    }
  } finally {
    setRng(previousRng);
  }
  return {
    first: toResult(first.policy.label, p0, firstLog, fills0),
    second: toResult(second.policy.label, p1, secondLog, fills1),
  };
}

function blockStreams(
  seed: number,
  block: number
): { x: number; y: number; fresh: (game: number, player: 0 | 1) => number } {
  return {
    x: deriveSeed(seed, block, 0),
    y: deriveSeed(seed, block, 1),
    fresh: (game, player) => deriveSeed(seed, block, 2 + game * 2 + player),
  };
}

/** Play one four-game block (see the table in this file's header). */
export function playBlock(config: MatchupConfig, block: number): BlockRecord {
  const { a, b, mode, seed, recordDice = false } = config;
  const streams = blockStreams(seed, block);
  const layout: readonly { aFirst: boolean; aStream: "X" | "Y" }[] = [
    { aFirst: true, aStream: "X" },
    { aFirst: true, aStream: "Y" },
    { aFirst: false, aStream: "X" },
    { aFirst: false, aStream: "Y" },
  ];

  const games = layout.map(({ aFirst, aStream }, g): GameRecord => {
    const aSeed =
      mode === "paired" ? (aStream === "X" ? streams.x : streams.y) : streams.fresh(g, 0);
    const bSeed =
      mode === "paired" ? (aStream === "X" ? streams.y : streams.x) : streams.fresh(g, 1);
    const seatA: Seat = { policy: a, streamSeed: aSeed };
    const seatB: Seat = { policy: b, streamSeed: bSeed };
    const result = aFirst ? playGame(seatA, seatB, recordDice) : playGame(seatB, seatA, recordDice);
    return {
      aFirst,
      aStream,
      a: aFirst ? result.first : result.second,
      b: aFirst ? result.second : result.first,
    };
  });

  return { games: games as unknown as BlockRecord["games"] };
}

/** Run `config.blocks` blocks (4 games each). Deterministic for a given config. */
export function runMatchup(config: MatchupConfig): MatchupRun {
  const blocks: BlockRecord[] = [];
  for (let i = 0; i < config.blocks; i++) blocks.push(playBlock(config, i));
  return {
    a: config.a.label,
    b: config.b.label,
    mode: config.mode,
    seed: config.seed,
    blocks,
  };
}
