/**
 * Sort replay recording (#3384, epic #3383): the action builders and the strict
 * shape check, `rebuild` against the real engine and the shipped catalog, the
 * chunking, the row and byte caps, and the isolation guard.
 */

import * as Sentry from "@sentry/react-native";

import {
  SORT_MAX_UNITS,
  SORT_MOVES_MAX_BYTES,
  SORT_SESSION_MAX_BYTES,
  gameRecordingConfigs,
  logConfig,
  Priority,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { resetSentryThrottle } from "../../_shared/sentryThrottle";
import { SORT_CATALOG_VERSION, SORT_LEVELS } from "../catalog";
import { applyPour, initState, isValidPour, undo as undoState } from "../engine";
import {
  ACTIONS_PER_CHUNK,
  MAX_BOTTLES,
  MAX_REWIND,
  SORT_REPLAY_ENGINE_VERSION,
  SortReplay,
  createActionLog,
  hintEntry,
  isAction,
  pourEntry,
  rebuild,
  rewindEntry,
  undoEntry,
  type Action,
  type ReplaySink,
} from "../replay";
import { solve } from "../solver";
import type { SortState } from "../types";

/** The opening board of `(catalog, level)`: what a reader rebuilds from. */
function opening(level: number, catalog: number = SORT_CATALOG_VERSION): SortState {
  expect(catalog).toBe(SORT_CATALOG_VERSION);
  const found = SORT_LEVELS[level - 1]!;
  return initState(found.bottles.map((b) => [...b]));
}

/** Two-colour board: A = red, B = blue; capacity 4. */
const small = (rows: string[][]): SortState =>
  initState(
    rows.map((r) => r.map((c) => (c === "A" ? "red" : c === "B" ? "blue" : "")))
  ) as SortState;

const bottlesOf = (s: SortState): string[] => s.bottles.map((b) => b.join(","));

/** Plays `actions` through the engine as the screen does, returning state and history. */
function play(start: SortState, actions: readonly Action[]) {
  let state = start;
  let history: readonly SortState[] = [];
  for (const a of actions) {
    if (a[0] === 0) {
      history = [...history, state];
      state = applyPour(state, a[1], a[2]);
    } else if (a[0] === 1) {
      ({ state, history } = undoState(state, history));
    } else if (a[0] === 3) {
      for (let i = 0; i < a[1]; i += 1) ({ state, history } = undoState(state, history));
    }
  }
  return { state, history };
}

// ---------------------------------------------------------------------------
// Constants, builders, isAction
// ---------------------------------------------------------------------------

describe("contract constants", () => {
  it("are the figures the backend validator holds", () => {
    expect(SORT_REPLAY_ENGINE_VERSION).toBe(1);
    expect(MAX_BOTTLES).toBe(16);
    expect(MAX_REWIND).toBe(1000);
    expect(ACTIONS_PER_CHUNK).toBe(25);
    expect(SORT_MOVES_MAX_BYTES).toBe(1024);
    expect(SORT_MAX_UNITS).toBe(12);
  });
});

describe("builders", () => {
  it("build the number tuples of the contract", () => {
    expect(pourEntry(2, 5)).toEqual([0, 2, 5]);
    expect(undoEntry()).toEqual([1]);
    expect(hintEntry(3, 0)).toEqual([2, 3, 0]);
    expect(rewindEntry(7)).toEqual([3, 7]);
  });

  it("the longest honest entry is 10 characters with its comma", () => {
    expect(`${JSON.stringify(pourEntry(15, 14))},`).toHaveLength(10);
  });
});

describe("isAction", () => {
  it.each([[0, 0, 1], [0, 15, 14], [1], [2, 0, 15], [3, 1], [3, 1000]].map((a) => [a]))(
    "accepts %j",
    (a) => {
      expect(isAction(a)).toBe(true);
    }
  );

  it.each<unknown[]>(
    (<unknown[]>[
      null,
      undefined,
      "u",
      7,
      {},
      [],
      [4],
      [-1],
      [0],
      [0, 1],
      [0, 1, 2, 3],
      [0, 1, 1],
      [2, 4, 4],
      [0, -1, 2],
      [0, 1, 16],
      [0, 1.5, 2],
      [0, "1", 2],
      [0, 1, null],
      [0, Number.NaN, 1],
      [0, Infinity, 1],
      [1, 0],
      [3],
      [3, 0],
      [3, -2],
      [3, 1001],
      [3, 1.5],
      [3, "2"],
      [3, 1, 1],
    ]).map((a) => [a])
  )("rejects %j", (a) => {
    expect(isAction(a)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

describe("rebuild", () => {
  it("round trip: a catalog level's solution, logged while played, rebuilds the same board", () => {
    for (const level of [1, 2, 60, 120]) {
      const start = opening(level);
      const solution = solve(start)!;
      expect(solution).not.toBeNull();
      const actions: Action[] = solution.map((m) => pourEntry(m.from, m.to));
      const live = play(start, actions);
      expect(live.state.isComplete).toBe(true);
      const result = rebuild(opening(level), actions);
      expect(result.error).toBeUndefined();
      expect(result.state.bottles).toEqual(live.state.bottles);
      expect(result.state.moveCount).toBe(live.state.moveCount);
      expect(result.state.undosUsed).toBe(live.state.undosUsed);
      expect(result.state.isComplete).toBe(true);
    }
  });

  it("round trip survives JSON (the wire form)", () => {
    const start = opening(10);
    const actions: Action[] = solve(start)!.map((m) => pourEntry(m.from, m.to));
    const wire = JSON.parse(JSON.stringify({ m: actions })) as { m: Action[] };
    expect(rebuild(start, wire.m).state.isComplete).toBe(true);
  });

  it("an empty log is the opening board", () => {
    const start = opening(3);
    const r = rebuild(start, []);
    expect(r.state).toBe(start);
    expect(r.history).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it("a multi-unit pour moves the whole top run", () => {
    const start = small([["B", "A", "A", "A"], [], ["B"]]);
    const r = rebuild(start, [pourEntry(0, 1)]);
    expect(r.error).toBeUndefined();
    expect(bottlesOf(r.state)).toEqual(["blue", "red,red,red", "blue"]);
    expect(r.state.moveCount).toBe(1);
  });

  it("a partial-capacity pour moves only what fits", () => {
    // source top run is 3 reds; the destination has room for 2
    const start = small([["B", "A", "A", "A"], ["A", "A"], []]);
    const r = rebuild(start, [pourEntry(0, 1)]);
    expect(r.error).toBeUndefined();
    expect(bottlesOf(r.state)).toEqual(["blue,red", "red,red,red,red", ""]);
    expect(r.state.moveCount).toBe(1);
  });

  it("an undo restores the previous board and counts", () => {
    const start = small([["A", "B"], ["B"], []]);
    const r = rebuild(start, [pourEntry(0, 1), undoEntry()]);
    expect(r.error).toBeUndefined();
    expect(r.state.bottles).toEqual(start.bottles);
    expect(r.state.moveCount).toBe(0);
    expect(r.state.undosUsed).toBe(1);
    expect(r.history).toHaveLength(0);
  });

  it("a rewind of n counts n undos", () => {
    const start = small([["A", "B"], ["B"], []]);
    const r = rebuild(start, [pourEntry(0, 1), pourEntry(0, 2), pourEntry(2, 0), rewindEntry(2)]);
    expect(r.error).toBeUndefined();
    expect(r.state.moveCount).toBe(1);
    expect(r.state.undosUsed).toBe(2);
    expect(r.history).toHaveLength(1);
    // the same as the screen: undo called n times
    const live = play(start, [pourEntry(0, 1), pourEntry(0, 2), pourEntry(2, 0), rewindEntry(2)]);
    expect(r.state.bottles).toEqual(live.state.bottles);
    expect(r.state.undosUsed).toBe(live.state.undosUsed);
  });

  it("a rewind of exactly the whole history is fine", () => {
    const start = small([["A", "B"], ["B"], []]);
    const r = rebuild(start, [pourEntry(0, 1), pourEntry(1, 2), rewindEntry(2)]);
    expect(r.error).toBeUndefined();
    expect(r.state.bottles).toEqual(start.bottles);
    expect(r.state.undosUsed).toBe(2);
  });

  it("a hint changes nothing", () => {
    const start = small([["A", "B"], ["B"], []]);
    const r = rebuild(start, [hintEntry(0, 1), hintEntry(1, 2)]);
    expect(r.error).toBeUndefined();
    expect(r.state).toBe(start);
    expect(r.history).toEqual([]);
  });

  it("undo, then pour again, then undo: history stays consistent", () => {
    const start = small([["A", "B"], ["B"], []]);
    const actions: Action[] = [pourEntry(0, 1), undoEntry(), pourEntry(0, 2), undoEntry()];
    const r = rebuild(start, actions);
    expect(r.error).toBeUndefined();
    expect(r.state.moveCount).toBe(0);
    expect(r.state.undosUsed).toBe(2);
  });

  describe("reports the first illegal action", () => {
    const start = small([["A", "B"], ["B"], []]);

    const cases: [string, readonly unknown[], number][] = [
      ["a pour from an empty bottle", [[0, 2, 0]], 0],
      [
        "a pour onto a different colour",
        [
          [0, 0, 1],
          [0, 0, 1],
        ],
        1,
      ],
      ["a bottle index off the board", [[0, 0, 3]], 0],
      ["a hint with a bottle off the board", [[2, 0, 5]], 0],
      ["an undo with no history", [[1]], 0],
      ["an undo after everything was undone", [[0, 0, 1], [1], [1]], 2],
      [
        "a rewind past the start",
        [
          [0, 0, 1],
          [3, 2],
        ],
        1,
      ],
      ["a rewind with no history", [[3, 1]], 0],
      ["a rewind of zero", [[3, 0]], 0],
      ["a pour onto itself", [[0, 1, 1]], 0],
      ["an unknown code", [[9, 0, 1]], 0],
      ["a short pour", [[0, 1]], 0],
      ["a long undo", [[1, 0]], 0],
      ["a non-integer index", [[0, 0.5, 1]], 0],
      ["a string", ["u"], 0],
      ["a hint onto itself", [[2, 1, 1]], 0],
    ];
    it.each(cases)("%s", (_name, actions, index) => {
      const r = rebuild(start, actions as readonly Action[]);
      expect(r.error?.index).toBe(index);
      expect(typeof r.error?.reason).toBe("string");
    });

    it("a pour into a full bottle", () => {
      const full = small([["A", "A", "A", "A"], ["B", "B", "B", "B"], ["A"]]);
      // top colours differ, and bottle 0 is full: both refuse
      expect(rebuild(full, [pourEntry(2, 0)]).error?.index).toBe(0);
      const fullSame = small([["A", "A", "A", "A"], ["A"], []]);
      expect(rebuild(fullSame, [pourEntry(1, 0)]).error?.index).toBe(0);
    });

    it("stops there: the state is the board before the bad action, later actions are not applied", () => {
      const r = rebuild(start, [pourEntry(0, 1), pourEntry(2, 0), pourEntry(1, 2)]);
      expect(r.error?.index).toBe(1);
      expect(r.state.moveCount).toBe(1);
      expect(r.history).toHaveLength(1);
    });

    it("every action rejected by isAction is rejected by rebuild too", () => {
      for (const a of [[0, 1, 1], [1, 0], [3, 0], [3, 1001], [0, 16, 0], [4]]) {
        expect(isAction(a)).toBe(false);
        expect(rebuild(start, [a as unknown as Action]).error?.index).toBe(0);
      }
    });

    it("an illegal pour agrees with the engine's own isValidPour", () => {
      const s = small([["B", "A"], ["B"], []]);
      expect(isValidPour(s.bottles[0]!, s.bottles[1]!)).toBe(false);
      expect(rebuild(s, [pourEntry(0, 1)]).error).toBeDefined();
      expect(isValidPour(s.bottles[1]!, s.bottles[2]!)).toBe(true);
      expect(rebuild(s, [pourEntry(1, 2)]).error).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe("createActionLog", () => {
  const entry = (n: number): Action => pourEntry(n % 16, (n + 1) % 16);

  it("hands a chunk over at exactly ACTIONS_PER_CHUNK actions", () => {
    const emitted: Action[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    for (let i = 0; i < ACTIONS_PER_CHUNK - 1; i += 1) log.push(entry(i));
    expect(emitted).toHaveLength(0);
    log.push(entry(ACTIONS_PER_CHUNK - 1));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(ACTIONS_PER_CHUNK);
    log.push(entry(ACTIONS_PER_CHUNK));
    expect(emitted).toHaveLength(1);
  });

  it("flush hands over the partial chunk, once, and nothing when empty", () => {
    const emitted: Action[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    log.flush();
    for (let i = 0; i < 7; i += 1) log.push(entry(i));
    log.flush();
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([7]);
  });

  it("keeps order and never reuses an emitted array", () => {
    const emitted: Action[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    const n = 2 * ACTIONS_PER_CHUNK + 3;
    for (let i = 0; i < n; i += 1) log.push(entry(i));
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([ACTIONS_PER_CHUNK, ACTIONS_PER_CHUNK, 3]);
    expect(emitted.flat()).toEqual(Array.from({ length: n }, (_, i) => entry(i)));
    expect(new Set(emitted).size).toBe(3);
  });

  it("clear forgets what is collected without handing it over", () => {
    const emitted: Action[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    log.push(entry(1));
    log.clear();
    log.flush();
    expect(emitted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SortReplay
// ---------------------------------------------------------------------------

function spySink(open = true, full = false) {
  const calls: string[] = [];
  const sink: ReplaySink = {
    isOpen: jest.fn(() => open),
    beginUnit: jest.fn((n: number) => {
      calls.push(`begin ${n}`);
      return n;
    }),
    record: jest.fn((_type, data) => {
      calls.push(`record ${JSON.stringify(data.m)}`);
    }),
    closeUnit: jest.fn(() => {
      calls.push("close");
    }),
    isFull: jest.fn(() => full),
    flush: jest.fn(() => {
      calls.push("flush");
    }),
  };
  return { sink, calls };
}

describe("SortReplay", () => {
  it("hands a full chunk to the recorder as one unit: begin, one moves record, close", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 4);
    replay.pour(0, 1);
    replay.undo();
    replay.hint(2, 3);
    expect(calls).toEqual([]);
    replay.rewind(2);
    expect(calls).toEqual(["begin 1", "record [[0,0,1],[1],[2,2,3],[3,2]]", "close"]);
    expect(replay.unit).toBe(1);
  });

  it("numbers the units 1, 2, 3 ... and flushes the partial chunk and the recorder", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 2);
    for (let i = 0; i < 5; i += 1) replay.hint(0, 1);
    replay.flush();
    expect(calls.filter((c) => c.startsWith("begin"))).toEqual(["begin 1", "begin 2", "begin 3"]);
    expect(calls[calls.length - 1]).toBe("flush");
    expect(replay.unit).toBe(3);
  });

  it("flush with nothing waiting only asks the recorder to save", () => {
    const { sink, calls } = spySink();
    new SortReplay(sink).flush();
    expect(calls).toEqual(["flush"]);
  });

  it("chunks at 25 by default", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink);
    for (let i = 0; i < 24; i += 1) replay.pour(0, 1);
    expect(calls).toEqual([]);
    replay.pour(0, 1);
    expect(calls.filter((c) => c.startsWith("begin"))).toEqual(["begin 1"]);
    replay.flush();
    expect(replay.unit).toBe(1);
  });

  it("records nothing while no game session is open", () => {
    const { sink, calls } = spySink(false);
    const replay = new SortReplay(sink, 1);
    replay.pour(0, 1);
    replay.undo();
    replay.hint(0, 1);
    replay.rewind(1);
    expect(calls).toEqual([]);
    expect(replay.unit).toBe(0);
  });

  it("reset forgets the chunk in progress and starts the unit count again", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 2);
    replay.undo();
    replay.undo();
    expect(replay.unit).toBe(1);
    replay.undo();
    replay.reset();
    replay.flush();
    expect(calls.filter((c) => c.startsWith("record"))).toHaveLength(1);
    expect(replay.unit).toBe(0);
    replay.undo();
    replay.undo();
    expect(replay.unit).toBe(1);
  });

  it("resumeAt carries the unit count on: the next chunk is the saved count plus one", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 1);
    replay.resumeAt(7);
    expect(replay.unit).toBe(7);
    replay.undo();
    expect(calls[0]).toBe("begin 8");
    expect(replay.unit).toBe(8);
  });

  it.each([0, -3, 2.5, Number.NaN])("resumeAt(%p) starts from the first unit", (bad) => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 1);
    replay.resumeAt(bad);
    replay.undo();
    expect(calls[0]).toBe("begin 1");
  });

  it("resumeAt drops a chunk left over from before", () => {
    const { sink, calls } = spySink();
    const replay = new SortReplay(sink, 2);
    replay.undo();
    replay.resumeAt(4);
    replay.undo();
    expect(calls).toEqual([]);
  });

  describe("the row budget (SORT_MAX_UNITS)", () => {
    it("stops after the cap: no unit past it, nothing more collected", () => {
      const { sink, calls } = spySink();
      const replay = new SortReplay(sink, 1);
      for (let i = 0; i < SORT_MAX_UNITS + 30; i += 1) replay.undo();
      replay.flush();
      expect(calls.filter((c) => c.startsWith("begin"))).toHaveLength(SORT_MAX_UNITS);
      expect(replay.unit).toBe(SORT_MAX_UNITS);
    });

    it("a level of full chunks holds 300 actions", () => {
      expect(SORT_MAX_UNITS * ACTIONS_PER_CHUNK).toBe(300);
      const { sink, calls } = spySink();
      const replay = new SortReplay(sink);
      for (let i = 0; i < 400; i += 1) replay.pour(0, 1);
      replay.flush();
      const recorded = calls
        .filter((c) => c.startsWith("record"))
        .reduce((n, c) => n + (JSON.parse(c.slice(7)) as unknown[]).length, 0);
      expect(recorded).toBe(300);
    });

    it("a resumed level's count carries on", () => {
      const { sink, calls } = spySink();
      const replay = new SortReplay(sink, 1);
      replay.resumeAt(SORT_MAX_UNITS - 2);
      for (let i = 0; i < 10; i += 1) replay.undo();
      expect(calls.filter((c) => c.startsWith("begin"))).toHaveLength(2);
      expect(replay.unit).toBe(SORT_MAX_UNITS);
    });
  });

  describe("block / the recorder's byte cap", () => {
    it("block records nothing, drops what was collected, spends the budget and tells the screen", () => {
      const { sink, calls } = spySink();
      const replay = new SortReplay(sink, 5);
      const onBlocked = jest.fn();
      replay.setOnBlocked(onBlocked);
      replay.undo();
      replay.block();
      replay.flush();
      replay.undo();
      replay.pour(0, 1);
      expect(calls).toEqual(["flush"]);
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(replay.unit).toBe(SORT_MAX_UNITS);
    });

    it("stays blocked when resumed with the saved count; a new level (reset) records again", () => {
      const { sink, calls } = spySink();
      const replay = new SortReplay(sink, 1);
      replay.block();
      replay.resumeAt(replay.unit);
      replay.undo();
      expect(calls).toEqual([]);
      replay.reset();
      replay.undo();
      expect(calls).toHaveLength(3);
      expect(replay.unit).toBe(1);
    });

    it("a full recorder blocks the replay at the next chunk or flush, and does not record it", () => {
      const { sink, calls } = spySink(true, true);
      const replay = new SortReplay(sink, 1);
      const onBlocked = jest.fn();
      replay.setOnBlocked(onBlocked);
      replay.undo();
      expect(calls).toEqual([]);
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(replay.unit).toBe(SORT_MAX_UNITS);
      replay.flush();
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Size against the caps (the real recorder)
// ---------------------------------------------------------------------------

describe("size", () => {
  function wired(chunkSize?: number) {
    const saved: EnqueueEventInput[] = [];
    const recorder = new GameRecorder<"sort">({
      gameType: "sort",
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saved.push(...events);
          return true;
        },
      },
      schedule: () => undefined,
    });
    recorder.startSession();
    const replay = new SortReplay(
      {
        isOpen: () => true,
        beginUnit: (n) => recorder.beginUnit(n),
        record: (type, data) => recorder.record(type, data),
        closeUnit: () => recorder.closeUnit(),
        flush: () => recorder.flush(),
        isFull: () => recorder.full,
      },
      chunkSize
    );
    return { replay, recorder, saved };
  }

  it("registers moves as a chunkable replay event with the 1 KB cap and a session cap", () => {
    const config = recordingConfigFor("sort");
    expect(config).toBe(gameRecordingConfigs.sort);
    expect(config.events.moves).toEqual({ maxBytes: SORT_MOVES_MAX_BYTES, chunkField: "m" });
    expect(SORT_MOVES_MAX_BYTES).toBe(1024);
    expect(config.sessionMaxBytes).toBe(SORT_SESSION_MAX_BYTES);
    expect(logConfig.priorityForEvent("game_event", "moves")).toBe(Priority.REPLAY);
  });

  it("a worst honest chunk (25 pours between the highest bottles) is under the cap, unsplit", () => {
    const { replay, recorder, saved } = wired();
    for (let i = 0; i < ACTIONS_PER_CHUNK; i += 1) replay.pour(15, 14);
    replay.flush();
    recorder.endSession();
    const events = saved.filter((e) => e.type === "moves");
    expect(events).toHaveLength(1);
    const bytes = JSON.stringify(events[0]!.data).length;
    expect(bytes).toBeLessThan(SORT_MOVES_MAX_BYTES);
    expect((events[0]!.data as { parts?: number }).parts).toBeUndefined();
    process.stdout.write(`[sort #3384] worst honest chunk: ${bytes} B JSON\n`);
  });

  it("a level at the row cap stays inside the session byte cap", () => {
    const { replay, recorder, saved } = wired();
    for (let i = 0; i < SORT_MAX_UNITS * ACTIONS_PER_CHUNK; i += 1) replay.pour(15, 14);
    replay.flush();
    recorder.endSession();
    expect(saved).toHaveLength(SORT_MAX_UNITS);
    const total = saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(total).toBeLessThanOrEqual(SORT_SESSION_MAX_BYTES);
    expect(recorder.full).toBe(false);
  });

  it("a recorded level rebuilds from its saved events", () => {
    const start = opening(5);
    const solution = solve(start)!;
    const { replay, recorder, saved } = wired(3);
    replay.hint(solution[0]!.from, solution[0]!.to);
    for (const m of solution) replay.pour(m.from, m.to);
    replay.flush();
    recorder.endSession();
    const actions = saved
      .filter((e) => e.type === "moves")
      .flatMap((e) => (e.data as { m: Action[] }).m);
    expect(actions.every(isAction)).toBe(true);
    const r = rebuild(opening(5), actions);
    expect(r.error).toBeUndefined();
    expect(r.state.isComplete).toBe(true);
    expect(r.state.moveCount).toBe(solution.length);
  });
});

// ---------------------------------------------------------------------------
// Isolation: recording never breaks play
// ---------------------------------------------------------------------------

describe("isolation", () => {
  function throwingSink(): { sink: ReplaySink; fail: { on: boolean }; recorded: number[] } {
    const fail = { on: true };
    const recorded: number[] = [];
    const sink: ReplaySink = {
      isOpen: () => true,
      beginUnit: (n) => n,
      record: (_type, data) => {
        if (fail.on) throw new Error("recorder broke");
        recorded.push(data.m.length);
      },
      closeUnit: () => undefined,
      isFull: () => false,
      flush: () => {
        if (fail.on) throw new Error("flush broke");
      },
    };
    return { sink, fail, recorded };
  }

  it("a sink that throws does not reach the caller, and recording resumes when it recovers", () => {
    const { sink, fail, recorded } = throwingSink();
    const replay = new SortReplay(sink, 1);
    expect(() => replay.hint(0, 1)).not.toThrow();
    expect(() => replay.pour(0, 1)).not.toThrow();
    expect(() => replay.undo()).not.toThrow();
    expect(() => replay.rewind(2)).not.toThrow();
    expect(() => replay.flush()).not.toThrow();
    fail.on = false;
    replay.hint(0, 1);
    expect(recorded).toEqual([1]);
  });

  it("a sink that cannot say whether a game is open does not break play either", () => {
    const { sink } = throwingSink();
    const replay = new SortReplay({
      ...sink,
      isOpen: () => {
        throw new Error("no session");
      },
    });
    expect(() => replay.pour(0, 1)).not.toThrow();
  });

  it("a failure is reported to Sentry through the throttle: once, by name only", () => {
    resetSentryThrottle();
    (Sentry.captureMessage as jest.Mock).mockClear();
    const { sink } = throwingSink();
    const replay = new SortReplay(sink, 1);
    for (let i = 0; i < 20; i += 1) replay.hint(0, 1);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0]!;
    expect(message).toBe("sort replay recording failed");
    expect(JSON.stringify(options)).not.toContain("recorder broke");
  });
});
