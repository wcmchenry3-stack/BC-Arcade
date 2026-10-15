/**
 * Yacht replay recording (#3282): the turn builder and its compact encoding,
 * the unit numbering, the byte cap, the kill switch, and the golden replay —
 * a scripted, seeded vs-computer game played through the real engine, the real
 * computer opponent and the real GameRecorder is rebuilt from the recorded
 * events alone and must come out with the same two scorecards.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import {
  YACHT_TURN_MAX_BYTES,
  gameEventRegistry,
  recordingConfigFor,
  recordingEventCap,
} from "../../_shared/eventQueueConfig";
import {
  CATEGORIES,
  createSeededRng,
  newGame,
  possibleScores,
  roll,
  score,
  setRng,
  toggleHold,
} from "../engine";
import { scoreCategories, scoreEvs } from "../ai";
import {
  MAX_HOLD_CHANGES,
  TURN_COMPLETED,
  createTurnLog,
  emitTurn,
  startedData,
  turnUnit,
  type TurnData,
} from "../replay";
import type { GameState } from "../types";
import {
  HUMAN_SCRIPT,
  asTurnSink,
  playGame,
  rebuild,
  recorderWithSink,
} from "./helpers/replayGame";

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// The turn builder
// ---------------------------------------------------------------------------

/** A state with `dice` showing after `rolls` rolls. */
function rolled(base: GameState, dice: number[], rollsUsed: number, held?: boolean[]): GameState {
  return {
    ...base,
    dice,
    rolls_used: rollsUsed,
    held: held ?? [false, false, false, false, false],
  };
}

describe("TurnLog", () => {
  it("encodes a two-roll turn compactly: dice, hold mask going in, the score, the totals", () => {
    const log = createTurnLog();
    const start = newGame();
    const first = roll(start, [], { dice: [1, 1, 2, 3, 6] });
    log.roll(first);
    const taps = toggleHold(toggleHold(first, 0), 1);
    log.hold(1, 0, true);
    log.hold(1, 1, true);
    const second = roll(taps, taps.held, { dice: [1, 1, 1, 4, 5] });
    log.roll(second);
    const next = score(second, "ones");
    const turn = log.finish({
      prev: second,
      next,
      category: "ones",
      alternatives: possibleScores(second),
    });

    expect(turn.r).toBe(1);
    expect(turn.rolls).toEqual([[[1, 1, 2, 3, 6]], [[1, 1, 1, 4, 5], 0b00011]]);
    expect(turn.h).toEqual([
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(turn.s).toEqual([CATEGORIES.indexOf("ones"), 3]);
    expect(turn.us).toBe(3);
    expect(turn.tot).toBe(3);
    // The other 12 legal categories, flat [category, value, ...], not the chosen one.
    expect(turn.alt).toHaveLength(24);
    expect(turn.alt!.slice(0, 2)).toEqual([CATEGORIES.indexOf("twos"), 0]);
    // Booleans, counts and the offset are left out when false / zero / absent.
    for (const key of ["jk", "yb", "ub", "yc", "ro", "ev"]) expect(turn).not.toHaveProperty(key);
    // A solo first roll has no mask element at all.
    expect(turn.rolls[0]).toHaveLength(1);
  });

  it("leaves out the hold taps of a turn with none, and starts the next turn clean", () => {
    const log = createTurnLog();
    const s = roll(newGame(), [], { dice: [2, 2, 3, 3, 3] });
    log.roll(s);
    log.hold(1, 4, true);
    const first = log.finish({
      prev: s,
      next: score(s, "full_house"),
      category: "full_house",
      alternatives: {},
    });
    expect(first.h).toEqual([[1, 4, 1]]);
    const t = roll(score(s, "full_house"), [], { dice: [1, 2, 3, 4, 5] });
    log.roll(t);
    const second = log.finish({
      prev: t,
      next: score(t, "chance"),
      category: "chance",
      alternatives: {},
    });
    expect(second.h).toBeUndefined();
    expect(second.rolls).toEqual([[[1, 2, 3, 4, 5]]]);
    expect(second.alt).toBeUndefined();
  });

  it("flags a Joker placement and the Yacht bonus separately, and the upper bonus", () => {
    const base = newGame();
    const yachtBox = { ...base.scores, yacht: 50 };
    // An extra Yacht of sixes with the Yacht box at 50: the Joker rule applies, sixes is forced.
    const jokerFrom = rolled(
      { ...base, scores: yachtBox, yacht_bonus_count: 0 },
      [6, 6, 6, 6, 6],
      1
    );
    const log = createTurnLog();
    log.roll(jokerFrom);
    const jokerTurn = log.finish({
      prev: jokerFrom,
      next: score(jokerFrom, "sixes"),
      category: "sixes",
      alternatives: possibleScores(jokerFrom),
    });
    expect(jokerTurn.jk).toBe(1);
    expect(jokerTurn.yb).toBe(1);
    expect(jokerTurn.yc).toBe(1);
    expect(jokerTurn.tot).toBe(50 + 30 + 100);

    // The last upper box taking the subtotal to 63 earns the upper bonus.
    const upper = {
      ...base.scores,
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      sixes: 30,
    };
    const lastUpper = rolled({ ...base, scores: upper, upper_subtotal: 60 }, [5, 5, 5, 1, 2], 1);
    const log2 = createTurnLog();
    log2.roll(lastUpper);
    const bonusTurn = log2.finish({
      prev: lastUpper,
      next: score(lastUpper, "fives"),
      category: "fives",
      alternatives: {},
    });
    expect(bonusTurn.ub).toBe(1);
    expect(bonusTurn.jk).toBeUndefined();
    expect(bonusTurn.yb).toBeUndefined();
    expect(bonusTurn.us).toBe(75);
    expect(bonusTurn.tot).toBe(75 + 35);
  });

  it("notes the rolls a turn lost to an app kill (a resumed turn)", () => {
    const log = createTurnLog();
    // Restored with two rolls already used; only the third is seen.
    const resumed = rolled(newGame(), [1, 2, 3, 4, 6], 2);
    const third = roll(resumed, [true, true, true, true, false], { dice: [1, 2, 3, 4, 5] });
    log.roll(third);
    const turn = log.finish({
      prev: third,
      next: score(third, "large_straight"),
      category: "large_straight",
      alternatives: {},
    });
    expect(turn.rolls).toHaveLength(1);
    expect(turn.ro).toBe(2);
  });

  it("shows the dice of a resumed turn scored without another roll as its one roll", () => {
    const log = createTurnLog();
    const resumed = rolled(newGame(), [2, 2, 2, 5, 5], 3);
    const turn = log.finish({
      prev: resumed,
      next: score(resumed, "full_house"),
      category: "full_house",
      alternatives: {},
    });
    expect(turn.rolls).toEqual([[[2, 2, 2, 5, 5]]]);
    expect(turn.ro).toBe(2);
  });

  it("records at most MAX_HOLD_CHANGES taps and at most three rolls", () => {
    const log = createTurnLog();
    let s = roll(newGame(), [], { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    for (let i = 0; i < MAX_HOLD_CHANGES + 10; i += 1) log.hold(1, i % 5, i % 2 === 0);
    s = roll(s, s.held, { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    s = roll(s, s.held, { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    log.roll(s); // a fourth is not a roll
    const turn = log.finish({
      prev: s,
      next: score(s, "chance"),
      category: "chance",
      alternatives: {},
    });
    expect(turn.h).toHaveLength(MAX_HOLD_CHANGES);
    expect(turn.rolls).toHaveLength(3);
  });

  it("carries the computer's EVs to one decimal", () => {
    const log = createTurnLog();
    const s = roll(newGame(), [], { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    const turn = log.finish({
      prev: s,
      next: score(s, "chance"),
      category: "chance",
      alternatives: {},
      ev: [231.4467, 233.9511],
    });
    expect(turn.ev).toEqual([231.4, 234]);
  });

  it("reset drops a turn in progress", () => {
    const log = createTurnLog();
    const s = roll(newGame(), [], { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    log.hold(1, 0, true);
    log.reset();
    const t = roll(newGame(), [], { dice: [6, 6, 6, 6, 6] });
    log.roll(t);
    const turn = log.finish({
      prev: t,
      next: score(t, "yacht"),
      category: "yacht",
      alternatives: {},
    });
    expect(turn.rolls).toEqual([[[6, 6, 6, 6, 6]]]);
    expect(turn.h).toBeUndefined();
  });
});

describe("game_started data", () => {
  it("names the mode, and in a vs game the computer's type and difficulty", () => {
    expect(startedData(null)).toEqual({ v: 1, mode: "solo" });
    expect(startedData("hard")).toEqual({
      v: 1,
      mode: "vs",
      cpu_type: "oracle",
      difficulty: "hard",
    });
  });
});

// ---------------------------------------------------------------------------
// Units and actors
// ---------------------------------------------------------------------------

describe("turn units", () => {
  it("numbers a solo game by round and a vs game 2r-1 (human) and 2r (computer)", () => {
    expect([1, 2, 13].map((r) => turnUnit(0, r, false))).toEqual([1, 2, 13]);
    expect([1, 2, 13].map((r) => turnUnit(0, r, true))).toEqual([1, 3, 25]);
    expect([1, 2, 13].map((r) => turnUnit(1, r, true))).toEqual([2, 4, 26]);
  });

  it("continues the numbering of a resumed game instead of restarting at 1 (GAME-CONTRACT §2.10)", () => {
    // A fresh recorder, as after an app kill, resumes at round 9: the unit is the round's, not 1.
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    const s = roll(newGame(), [], { dice: [1, 2, 3, 4, 5] });
    const log = createTurnLog();
    log.roll(s);
    const turn = log.finish({
      prev: { ...s, round: 9 },
      next: score({ ...s, round: 9 }, "chance"),
      category: "chance",
      alternatives: {},
    });
    emitTurn(asTurnSink(recorder), turn, 0, true);
    recorder.endSession();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.data).toEqual(expect.objectContaining({ unit: 17, r: 9 }));
  });

  it("gives a vs turn its actor and a solo turn none", () => {
    const turn: TurnData = { r: 1, rolls: [[[1, 2, 3, 4, 5]]], s: [12, 15], us: 0, tot: 15 };
    for (const [vs, seat, actor] of [
      [false, 0, undefined],
      [true, 0, { seat: 0, kind: "human" }],
      [true, 1, { seat: 1, kind: "cpu" }],
    ] as const) {
      const { recorder, saved } = recorderWithSink();
      recorder.startSession();
      emitTurn(asTurnSink(recorder), { ...turn }, seat, vs);
      recorder.endSession();
      expect(saved[0]!.type).toBe(TURN_COMPLETED);
      expect((saved[0]!.data as { actor?: unknown }).actor).toEqual(actor);
    }
  });
});

// ---------------------------------------------------------------------------
// The oracle's EVs
// ---------------------------------------------------------------------------

describe("scoreEvs", () => {
  it("is the oracle's value of the chosen category and of the best one, at λ = 1", () => {
    setRng(createSeededRng(3));
    const s = roll(newGame(), [], { dice: [6, 6, 6, 6, 2] });
    const options = scoreCategories(s, 1);
    const best = Math.max(...options.map((o) => o.value));
    const sixes = options.find((o) => o.category === "sixes")!.value;
    const yacht = options.find((o) => o.category === "yacht")!.value;
    expect(scoreEvs(s, "sixes")).toEqual([sixes, best]);
    expect(scoreEvs(s, "yacht")).toEqual([yacht, best]);
    expect(best).toBeGreaterThanOrEqual(sixes);
    // Scoring a pat 4-of-a-kind in sixes beats burning it on ones.
    expect(sixes).toBeGreaterThan(scoreEvs(s, "ones")[0]);
  });
});

// ---------------------------------------------------------------------------
// Golden replay
// ---------------------------------------------------------------------------

describe("golden replay: a vs-computer game rebuilt from its events", () => {
  it.each(["easy", "medium", "hard"] as const)(
    "rebuilds both scorecards of a finished %s game",
    (difficulty) => {
      const { recorder, saved } = recorderWithSink();
      recorder.startSession();
      const game = playGame(asTurnSink(recorder), { seed: 11, difficulty });
      recorder.endSession();

      // Both players, every round: 26 turns, one event each.
      expect(saved).toHaveLength(26);
      expect(saved.every((e) => e.type === TURN_COMPLETED)).toBe(true);

      const rebuilt = rebuild(saved);
      expect(rebuilt.problems).toEqual([]);
      expect(rebuilt.cards[0]!.scores).toEqual(game.human.scores);
      expect(rebuilt.cards[0]!.total_score).toBe(game.human.total_score);
      expect(rebuilt.cards[1]!.scores).toEqual(game.cpu!.scores);
      expect(rebuilt.cards[1]!.total_score).toBe(game.cpu!.total_score);
      expect(rebuilt.cards[0]!.game_over && rebuilt.cards[1]!.game_over).toBe(true);
    }
  );

  it("covers a Yacht, a Joker placement with the Yacht bonus, and the upper bonus", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    const game = playGame(asTurnSink(recorder), { seed: 11, difficulty: "hard" });
    recorder.endSession();

    const human = saved
      .map((e) => e.data as unknown as TurnData & { actor: { seat: number } })
      .filter((d) => d.actor.seat === 0);
    expect(human).toHaveLength(13);
    expect(human[0]!.s).toEqual([CATEGORIES.indexOf("yacht"), 50]);
    expect(human[1]).toEqual(expect.objectContaining({ jk: 1, yb: 1, yc: 1 }));
    expect(human[1]!.s).toEqual([CATEGORIES.indexOf("sixes"), 30]);
    expect(human[6]).toEqual(expect.objectContaining({ ub: 1, us: 75 }));
    expect(human.filter((d) => d.ub === 1)).toHaveLength(1);
    expect(game.human.upper_bonus).toBe(35);
    expect(game.human.yacht_bonus_total).toBe(100);
    expect(human[12]!.tot).toBe(game.human.total_score);
    // The taps of the scripted turns are there, in order.
    expect(human[2]!.h).toEqual([
      [1, 0, 1],
      [1, 1, 1],
      [1, 2, 1],
    ]);
    expect(human[3]!.rolls.map((r) => r[1])).toEqual([undefined, 0b00101, 0b01101]);
  });

  it("records the computer's expected values on its turns only", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    playGame(asTurnSink(recorder), { seed: 5, difficulty: "hard" });
    recorder.endSession();
    for (const e of saved) {
      const d = e.data as unknown as TurnData & { actor: { seat: number } };
      if (d.actor.seat === 1) {
        expect(d.ev).toHaveLength(2);
        expect(d.ev![0]).toBeLessThanOrEqual(d.ev![1]);
      } else {
        expect(d).not.toHaveProperty("ev");
      }
    }
  });

  it("rebuilds a solo game too, with no actor on any turn", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    const game = playGame(asTurnSink(recorder), { seed: 2, difficulty: null });
    recorder.endSession();
    expect(saved).toHaveLength(13);
    expect(saved.some((e) => "actor" in (e.data ?? {}))).toBe(false);
    const rebuilt = rebuild(saved);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.cards[0]!.total_score).toBe(game.human.total_score);
    expect(game.human.total_score).toBe(405);
  });

  it("fails when the recording loses information (the test would notice)", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    playGame(asTurnSink(recorder), { seed: 11, difficulty: "hard" });
    recorder.endSession();
    // Lose the last roll of every turn: the dice are gone and so are the scores.
    const lossy = saved.map((e) => ({
      ...e,
      data: { ...e.data, rolls: [[[1, 2, 3, 4, 6]]] },
    }));
    expect(rebuild(lossy).problems.length).toBeGreaterThan(0);
    // Or the alternatives.
    const noAlt = saved.map((e) => ({ ...e, data: { ...e.data, alt: undefined } }));
    expect(rebuild(noAlt).problems.length).toBeGreaterThan(0);
  });

  it("the script plays out to the total it was designed to", () => {
    const { recorder } = recorderWithSink();
    recorder.startSession();
    const game = playGame(asTurnSink(recorder), { seed: 1, difficulty: "easy" });
    recorder.endSession();
    expect(HUMAN_SCRIPT).toHaveLength(13);
    expect(game.human.scores.yacht).toBe(50);
    expect(game.human.total_score).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// The fixture the backend validates and rebuilds
// ---------------------------------------------------------------------------

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "backend",
  "tests",
  "fixtures",
  "yacht_turn_events_v1.json"
);

describe("the events the backend checks (backend/tests/fixtures/yacht_turn_events_v1.json)", () => {
  /** The scripted vs game with a scripted computer and a fixed clock: the same events every run. */
  function recordFixtureGame() {
    let t = 0;
    const { recorder, saved } = recorderWithSink({ now: () => (t += 1500) });
    recorder.startSession();
    const game = playGame(asTurnSink(recorder), { seed: 1, difficulty: "hard", scriptedCpu: true });
    recorder.endSession();
    return {
      totals: { "0": game.human.total_score, "1": game.cpu!.total_score },
      events: saved.map((e) => ({ type: e.type, data: e.data })),
    };
  }

  it("are what the app records, byte for byte (UPDATE_GOLDEN=1 re-records)", () => {
    const recorded = recordFixtureGame();
    if (process.env.UPDATE_GOLDEN === "1") {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      // One event per line, so a diff reads turn by turn.
      const lines = recorded.events.map((e) => JSON.stringify(e)).join(",\n");
      writeFileSync(
        FIXTURE,
        `{"totals": ${JSON.stringify(recorded.totals)}, "events": [\n${lines}\n]}\n`
      );
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(recorded)));
  });

  it("rebuild to the fixture's totals in the frontend decoder too", () => {
    const recorded = recordFixtureGame();
    const rebuilt = rebuild(recorded.events as never);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.cards[0]!.total_score).toBe(recorded.totals["0"]);
    expect(rebuilt.cards[1]!.total_score).toBe(recorded.totals["1"]);
    // A Joker for each player, and the human's upper bonus.
    expect(recorded.events.filter((e) => (e.data as TurnData).jk === 1)).toHaveLength(2);
    expect(recorded.events.filter((e) => (e.data as TurnData).ub === 1)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Saves, caps and the kill switch
// ---------------------------------------------------------------------------

describe("saves and caps", () => {
  it("one save per turn when each turn is saved at its idle moment", () => {
    const tasks: (() => void)[] = [];
    const saves: number[] = [];
    const { recorder } = recorderWithSink({
      schedule: (task) => tasks.push(task),
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saves.push(events.length);
          return true;
        },
      },
    });
    recorder.startSession();
    const sink = asTurnSink(recorder);
    // Drive the game turn by turn, running the idle task after each turn.
    const originalEmit = sink.closeUnit;
    sink.closeUnit = () => {
      originalEmit();
      while (tasks.length > 0) tasks.shift()?.();
    };
    playGame(sink, { seed: 11, difficulty: "hard" });
    recorder.endSession();
    expect(saves).toEqual(Array(26).fill(1));
  });

  it("nothing reaches the recorder while a turn is played", () => {
    const { recorder } = recorderWithSink();
    recorder.startSession();
    const log = createTurnLog();
    let s = newGame();
    s = roll(s, [], { dice: [1, 2, 3, 4, 5] });
    log.roll(s);
    s = toggleHold(s, 2);
    log.hold(1, 2, true);
    s = roll(s, s.held, { dice: [1, 2, 3, 4, 6] });
    log.roll(s);
    expect(recorder.held).toBe(0);
  });

  it("registers turn_completed with the shared cap, and the old types as legacy", () => {
    const events = gameEventRegistry.yacht.events;
    expect(Object.keys(events)).toEqual([
      "game_started",
      "game_ended",
      "roll",
      "score",
      "turn_completed",
    ]);
    expect(events.turn_completed.maxBytes).toBe(YACHT_TURN_MAX_BYTES);
    expect(recordingEventCap(recordingConfigFor("yacht"), TURN_COMPLETED)).toBe(
      YACHT_TURN_MAX_BYTES
    );
  });

  it("a worst-case turn, envelope included, fits the cap with room to spare", () => {
    const worst = {
      v: 1,
      unit: 26,
      t_ms: 7_200_000,
      actor: { seat: 1, kind: "cpu" },
      r: 13,
      rolls: [[[6, 6, 6, 6, 6]], [[6, 6, 6, 6, 6], 31], [[6, 6, 6, 6, 6], 31]],
      h: Array.from({ length: MAX_HOLD_CHANGES }, () => [3, 4, 1]),
      ro: 2,
      s: [12, 50],
      alt: Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 12 : 50)),
      jk: 1,
      yb: 1,
      ub: 1,
      yc: 12,
      us: 105,
      tot: 1575,
      ev: [1234.5, 1234.5],
    };
    const size = JSON.stringify(worst).length;
    expect(size).toBeLessThan(YACHT_TURN_MAX_BYTES);
    expect(size).toBeLessThan(500);
  });

  it("a real game's turns are far under the cap, and the game under the session cap", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    playGame(asTurnSink(recorder), { seed: 11, difficulty: "hard" });
    recorder.endSession();
    const sizes = saved.map((e) => JSON.stringify(e.data).length);
    expect(Math.max(...sizes)).toBeLessThan(YACHT_TURN_MAX_BYTES);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(
      recordingConfigFor("yacht").sessionMaxBytes
    );
  });

  it("kill switch off: the recorder does no work and saves nothing", () => {
    const enqueueMany = jest.fn(() => true);
    const enabled = jest.fn(() => false);
    const { recorder } = recorderWithSink({
      enabled,
      sink: { canAccept: () => true, enqueueMany },
    });
    recorder.startSession();
    const game = playGame(asTurnSink(recorder), { seed: 11, difficulty: "hard" });
    expect(recorder.held).toBe(0);
    recorder.flush();
    recorder.endSession();
    expect(enqueueMany).not.toHaveBeenCalled();
    expect(enabled).toHaveBeenCalledWith("yacht");
    // And the game itself is untouched.
    expect(game.human.game_over).toBe(true);
    expect(game.cpu!.game_over).toBe(true);
  });
});
