/**
 * Test helpers for Yacht replay recording (#3282): a scripted, seeded game
 * played through the real engine, the real computer opponent and the real
 * GameRecorder, and a decoder that rebuilds both scorecards from the recorded
 * events alone. Shared by replay.test.ts and replay.bench.test.ts.
 *
 * The human's dice are scripted (so the game has a Yacht, a Joker placement
 * with its bonus, and the upper bonus); the computer plays by `ai.ts` on the
 * seeded engine RNG.
 */

import type { EnqueueEventInput } from "../../../_shared/gameEventClient";
import { GameRecorder, type RecorderSink } from "../../../_shared/gameRecorder";
import { holdStrategy, scoreEvs, scoreStrategy } from "../../ai";
import {
  CATEGORIES,
  createSeededRng,
  jokerActive,
  newGame,
  possibleScores,
  roll,
  score,
  setRng,
  toggleHold,
  type Category,
} from "../../engine";
import { createTurnLog, emitTurn, type TurnData, type TurnLog, type TurnSink } from "../../replay";
import type { AiDifficulty, GameState } from "../../types";

/**
 * One human turn: the dice of each roll, the dice to tap (toggle) before the
 * next roll, the category. A die held for one roll stays held until tapped.
 */
export interface ScriptedTurn {
  readonly rolls: readonly { dice: number[]; holdNext?: number[] }[];
  readonly category: Category;
}

/**
 * 13 turns: a Yacht (round 1), a second Yacht scored as a Joker (round 2: the
 * Yacht bonus, sixes forced), the upper section filling up to the upper bonus
 * (round 7), then the lower section.
 */
export const HUMAN_SCRIPT: readonly ScriptedTurn[] = [
  { rolls: [{ dice: [6, 6, 6, 6, 6] }], category: "yacht" },
  { rolls: [{ dice: [6, 6, 6, 6, 6] }], category: "sixes" }, // joker + yacht bonus
  {
    rolls: [{ dice: [1, 1, 1, 2, 3], holdNext: [0, 1, 2] }, { dice: [1, 1, 1, 5, 4] }],
    category: "ones",
  },
  {
    rolls: [
      { dice: [2, 5, 2, 5, 6], holdNext: [0, 2] },
      { dice: [2, 3, 2, 2, 1], holdNext: [3] }, // dice 0 and 2 are still held
      { dice: [2, 3, 2, 2, 6] },
    ],
    category: "twos",
  },
  { rolls: [{ dice: [3, 3, 3, 1, 2] }], category: "threes" },
  { rolls: [{ dice: [4, 4, 4, 1, 6] }], category: "fours" },
  { rolls: [{ dice: [5, 5, 5, 2, 1] }], category: "fives" }, // upper bonus
  { rolls: [{ dice: [4, 4, 2, 2, 2] }], category: "full_house" },
  { rolls: [{ dice: [1, 2, 3, 4, 6] }], category: "small_straight" },
  { rolls: [{ dice: [2, 3, 4, 5, 6] }], category: "large_straight" },
  { rolls: [{ dice: [5, 5, 5, 1, 2] }], category: "three_of_a_kind" },
  { rolls: [{ dice: [4, 4, 4, 4, 1] }], category: "four_of_a_kind" },
  { rolls: [{ dice: [1, 2, 3, 4, 5] }], category: "chance" },
];

/**
 * A scripted computer, for a fixture that does not move when the AI is
 * retuned. `keep` is the hold mask the computer chooses going into the next
 * roll (it sets the mask itself; it taps nothing).
 */
export interface ScriptedCpuTurn {
  readonly rolls: readonly { dice: number[]; keep?: boolean[] }[];
  readonly category: Category;
}

const T = true;
const F = false;
export const CPU_SCRIPT: readonly ScriptedCpuTurn[] = [
  {
    rolls: [{ dice: [3, 3, 4, 4, 5], keep: [T, T, T, T, F] }, { dice: [3, 3, 4, 4, 4] }],
    category: "full_house",
  },
  { rolls: [{ dice: [2, 2, 2, 2, 6] }], category: "four_of_a_kind" },
  {
    rolls: [
      { dice: [6, 6, 1, 2, 3], keep: [T, T, F, F, F] },
      { dice: [6, 6, 6, 2, 5], keep: [T, T, T, F, F] },
      { dice: [6, 6, 6, 1, 1] },
    ],
    category: "sixes",
  },
  { rolls: [{ dice: [1, 1, 1, 1, 1] }], category: "yacht" },
  { rolls: [{ dice: [4, 4, 4, 4, 4] }], category: "fours" }, // joker + yacht bonus
  { rolls: [{ dice: [1, 2, 3, 4, 5] }], category: "large_straight" },
  { rolls: [{ dice: [1, 2, 3, 4, 6] }], category: "small_straight" },
  { rolls: [{ dice: [5, 5, 5, 2, 2] }], category: "three_of_a_kind" },
  { rolls: [{ dice: [1, 1, 3, 2, 6] }], category: "ones" },
  { rolls: [{ dice: [2, 2, 3, 5, 6] }], category: "twos" },
  { rolls: [{ dice: [3, 3, 5, 6, 6] }], category: "threes" },
  { rolls: [{ dice: [5, 5, 1, 2, 4] }], category: "fives" },
  { rolls: [{ dice: [1, 3, 3, 4, 6] }], category: "chance" },
];

/** Plays one scripted computer turn, as the hook does: it sets the hold mask, then rolls. */
function playScriptedCpuTurn(
  state: GameState,
  turn: ScriptedCpuTurn,
  log: TurnLog
): { turn: TurnData; next: GameState } {
  let s = state;
  turn.rolls.forEach((step, i) => {
    const held = i === 0 ? ALL_FREE : (turn.rolls[i - 1]!.keep ?? ALL_FREE);
    s = roll(s, held, { dice: step.dice });
    log.roll(s);
  });
  const next = score(s, turn.category);
  return {
    turn: log.finish({
      prev: s,
      next,
      category: turn.category,
      alternatives: possibleScores(s),
      ev: scoreEvs(s, turn.category),
    }),
    next,
  };
}

const ALL_FREE = [false, false, false, false, false];

/** Plays one scripted human turn into `log`; returns the state before the score and after it. */
function playHumanTurn(
  state: GameState,
  turn: ScriptedTurn,
  log: TurnLog
): { prev: GameState; next: GameState } {
  let s = state;
  turn.rolls.forEach((step, i) => {
    s = roll(s, s.held, { dice: step.dice });
    log.roll(s);
    if (step.holdNext && i < turn.rolls.length - 1) {
      for (const die of step.holdNext) {
        s = toggleHold(s, die);
        log.hold(s.rolls_used, die, s.held[die] === true);
      }
    }
  });
  return { prev: s, next: score(s, turn.category) };
}

/** Plays the computer's turn the way `useYachtCpuOpponent` does, into `log`. */
function playCpuTurn(
  state: GameState,
  difficulty: AiDifficulty,
  log: TurnLog
): { turn: TurnData; next: GameState } {
  let s = roll(state, ALL_FREE);
  log.roll(s);
  while (s.rolls_used < 3) {
    const holds = holdStrategy(s, difficulty);
    if (holds.every((h) => h)) break;
    s = roll(s, holds);
    log.roll(s);
  }
  const category = scoreStrategy(s, difficulty);
  const next = score(s, category);
  const turn = log.finish({
    prev: s,
    next,
    category,
    alternatives: possibleScores(s),
    ev: scoreEvs(s, category),
  });
  return { turn, next };
}

export interface PlayedGame {
  readonly human: GameState;
  readonly cpu: GameState | null;
  /** Turns recorded, in order, as `turn_completed` event data. */
  readonly turns: TurnData[];
}

/**
 * Plays the 13-round scripted game (vs the computer when `difficulty` is
 * given), recording every turn through `sink` the way the screen does.
 */
export function playGame(
  sink: TurnSink,
  options: { seed: number; difficulty: AiDifficulty | null; scriptedCpu?: boolean }
): PlayedGame {
  setRng(createSeededRng(options.seed));
  const vs = options.difficulty !== null;
  const humanLog = createTurnLog();
  const cpuLog = createTurnLog();
  let human = newGame();
  let cpu: GameState | null = vs ? newGame() : null;
  const turns: TurnData[] = [];
  for (const [round, scripted] of HUMAN_SCRIPT.entries()) {
    const { prev, next } = playHumanTurn(human, scripted, humanLog);
    const turn = humanLog.finish({
      prev,
      next,
      category: scripted.category,
      alternatives: possibleScores(prev),
    });
    human = next;
    turns.push(turn);
    emitTurn(sink, turn, 0, vs);
    if (cpu && options.difficulty) {
      const played = options.scriptedCpu
        ? playScriptedCpuTurn(cpu, CPU_SCRIPT[round]!, cpuLog)
        : playCpuTurn(cpu, options.difficulty, cpuLog);
      cpu = played.next;
      turns.push(played.turn);
      emitTurn(sink, played.turn, 1, vs);
    }
  }
  return { human, cpu, turns };
}

/** A recorder over a fake sink that collects every saved event; saved on `endSession`. */
export function recorderWithSink(
  overrides: Partial<ConstructorParameters<typeof GameRecorder<"yacht">>[0]> = {}
): { recorder: GameRecorder<"yacht">; saved: EnqueueEventInput[]; sink: RecorderSink } {
  const saved: EnqueueEventInput[] = [];
  const sink: RecorderSink = {
    canAccept: () => true,
    enqueueMany: (events) => {
      saved.push(...events);
      return true;
    },
  };
  const recorder = new GameRecorder<"yacht">({
    gameType: "yacht",
    sink,
    schedule: () => undefined, // saved at endSession, not during the test's loop
    ...overrides,
  });
  return { recorder, saved, sink };
}

/** The recorder's calls as a `TurnSink`. */
export function asTurnSink(recorder: GameRecorder<"yacht">): TurnSink {
  return {
    beginUnit: (n) => recorder.beginUnit(n),
    record: (type, data, actor) => recorder.record(type, data, actor),
    closeUnit: () => recorder.closeUnit(),
  };
}

export interface Rebuilt {
  /** Seat -> the scorecard rebuilt from that seat's turns. */
  readonly cards: Record<number, GameState>;
  /** Every place the recorded turn disagrees with the replay. Empty for a faithful recording. */
  readonly problems: string[];
}

/**
 * Rebuilds both scorecards from the saved `turn_completed` events alone: the
 * last roll's dice and the chosen category go through the engine's own
 * `score`, and everything else the event says is checked against the result.
 */
export function rebuild(events: readonly EnqueueEventInput[]): Rebuilt {
  const cards: Record<number, GameState> = {};
  const problems: string[] = [];
  for (const event of events) {
    if (event.type !== "turn_completed") continue;
    const data = event.data as unknown as TurnData & { actor?: { seat: number } };
    const seat = data.actor?.seat ?? 0;
    const card = cards[seat] ?? newGame();
    const at = `seat ${seat} round ${data.r}`;
    if (data.r !== card.round) problems.push(`${at}: expected round ${card.round}`);
    const last = data.rolls[data.rolls.length - 1]![0];
    const before: GameState = {
      ...card,
      dice: [...last],
      rolls_used: data.rolls.length + (data.ro ?? 0),
    };
    const category = CATEGORIES[data.s[0]]!;
    const next = score(before, category);
    if (next.scores[category] !== data.s[1]) problems.push(`${at}: value`);
    if ((data.jk === 1) !== jokerActive(before)) problems.push(`${at}: joker flag`);
    if ((data.yb === 1) !== next.yacht_bonus_count > card.yacht_bonus_count) {
      problems.push(`${at}: yacht bonus flag`);
    }
    if ((data.ub === 1) !== (card.upper_bonus === 0 && next.upper_bonus > 0)) {
      problems.push(`${at}: upper bonus flag`);
    }
    if ((data.yc ?? 0) !== next.yacht_bonus_count) problems.push(`${at}: yacht bonus count`);
    if (data.us !== next.upper_subtotal) problems.push(`${at}: upper subtotal`);
    if (data.tot !== next.total_score) problems.push(`${at}: total`);
    const alt: number[] = [];
    for (const [name, value] of Object.entries(possibleScores(before))) {
      if (name !== category) alt.push(CATEGORIES.indexOf(name as Category), value);
    }
    if (JSON.stringify(alt) !== JSON.stringify(data.alt ?? []))
      problems.push(`${at}: alternatives`);
    cards[seat] = next;
  }
  return { cards, problems };
}

export interface RandomGames {
  /** One entry per game: the players' final totals and the events as recorded. */
  readonly games: { totals: number[]; events: { type: string; data: Record<string, unknown> }[] }[];
  /** What the games covered, counted from the engine's own states. */
  readonly coverage: {
    jokerPriority1: number;
    jokerPriority2: number;
    jokerPriority3: number;
    gamesWithTwoBonuses: number;
    yachtScratchedThenYachtRolled: number;
  };
}

/**
 * Seeded random games for the cross-language differential (the backend
 * rebuilds each and must reach the engine's totals): random holds, random
 * categories, and 30% of turns roll a Yacht, so Jokers of every priority,
 * several Yacht bonuses and a scratched Yacht followed by a Yacht roll all
 * occur. Half the games are vs (the second player records EVs).
 */
export function randomGames(count: number, seed = 12345): RandomGames {
  let state = seed;
  const rnd = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const coverage = {
    jokerPriority1: 0,
    jokerPriority2: 0,
    jokerPriority3: 0,
    gamesWithTwoBonuses: 0,
    yachtScratchedThenYachtRolled: 0,
  };
  const games: RandomGames["games"] = [];
  for (let g = 0; g < count; g += 1) {
    const events: RandomGames["games"][number]["events"] = [];
    let unit = 0;
    const sink: TurnSink = {
      beginUnit: (n) => (unit = n ?? unit + 1),
      record: (type, data, actor) => {
        events.push({
          type,
          data: { ...data, v: 1, unit, t_ms: 0, ...(actor ? { actor } : {}) },
        });
      },
      closeUnit: () => undefined,
    };
    const vs = g % 2 === 0;
    const players = vs ? [newGame(), newGame()] : [newGame()];
    const logs = players.map(() => createTurnLog());
    for (let r = 0; r < 13; r += 1) {
      for (let p = 0; p < players.length; p += 1) {
        let s = players[p]!;
        const yachty = rnd() < 0.3;
        const face = 1 + Math.floor(rnd() * 6);
        const rolls = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < rolls; k += 1) {
          if (k > 0) {
            for (let i = 0; i < 5; i += 1) {
              if (rnd() < 0.3) {
                s = toggleHold(s, i);
                logs[p]!.hold(s.rolls_used, i, s.held[i] === true);
              }
            }
          }
          const dice = yachty
            ? [face, face, face, face, face]
            : Array.from({ length: 5 }, () => 1 + Math.floor(rnd() * 6));
          s = roll(s, s.held, { dice });
          logs[p]!.roll(s);
        }
        const alternatives = possibleScores(s);
        const keys = Object.keys(alternatives);
        const category = keys[Math.floor(rnd() * keys.length)] as Category;
        if (jokerActive(s)) {
          const upper = ["ones", "twos", "threes", "fours", "fives", "sixes"][s.dice[0]! - 1]!;
          if (s.scores[upper as Category] == null) coverage.jokerPriority1 += 1;
          else if (
            CATEGORIES.some(
              (c) =>
                c !== "yacht" &&
                !["ones", "twos", "threes", "fours", "fives", "sixes"].includes(c) &&
                s.scores[c] == null
            )
          ) {
            coverage.jokerPriority2 += 1;
          } else coverage.jokerPriority3 += 1;
        } else if (s.scores.yacht === 0 && new Set(s.dice).size === 1) {
          coverage.yachtScratchedThenYachtRolled += 1;
        }
        const next = score(s, category);
        emitTurn(
          sink,
          logs[p]!.finish({
            prev: s,
            next,
            category,
            alternatives,
            ev: p === 1 ? [100.04, 120.06] : undefined,
          }),
          p as 0 | 1,
          vs
        );
        players[p] = next;
      }
    }
    if (players.some((x) => x.yacht_bonus_count >= 2)) coverage.gamesWithTwoBonuses += 1;
    games.push({ totals: players.map((x) => x.total_score), events });
  }
  return { games, coverage };
}
