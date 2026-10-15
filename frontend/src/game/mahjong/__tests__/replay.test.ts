/**
 * Mahjong replay recording (#3285): the entry builders, the chunking, the size
 * against the caps, the kill switch, and the golden replay — a seeded game
 * played through the real engine and the real GameRecorder is rebuilt from the
 * deal's seed plus the recorded events alone, and must come out with the same
 * board (shuffles, undos and hints included).
 */

import * as Sentry from "@sentry/react-native";

import * as eventQueueConfig from "../../_shared/eventQueueConfig";
import { resetSentryThrottle } from "../../_shared/sentryThrottle";
import {
  MAHJONG_MAX_UNITS,
  MAHJONG_MOVES_MAX_BYTES,
  MAHJONG_SESSION_MAX_BYTES,
  gameRecordingConfigs,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import {
  createGame,
  createSeededRng,
  getAllFreePairs,
  selectTile,
  setRng,
  shuffleBoard,
} from "../engine";
import { getLayout, LAYOUTS } from "../layouts/registry";
import {
  ACTIONS_PER_CHUNK,
  MahjongReplay,
  createActionLog,
  matchEntry,
  shuffleEntry,
  type MoveEntry,
  type ReplaySink,
} from "../replay";
import type { MahjongState, SlotTile } from "../types";
import {
  ReplayError,
  applyEntry,
  standingEvents,
  gameOutcome,
  playScripted,
  rebuildGame,
  wiredReplay,
  type Script,
} from "./helpers/replayGame";

afterEach(() => setRng(Math.random));

const tile = (id: number): SlotTile => ({
  id,
  suit: "circles",
  rank: 1,
  faceId: 17,
  col: id * 4,
  row: 0,
  layer: 0,
});

/** A dealt board, shuffled once by the engine: the state a shuffle's event is read from. */
function shuffledOnce(layout = "turtle", seed = 5): { before: MahjongState; after: MahjongState } {
  setRng(createSeededRng(11));
  const before = createGame(getLayout(layout), seed);
  const after = shuffleBoard(before);
  return { before, after };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

describe("matchEntry", () => {
  it("is the two tile ids, in the engine's board order", () => {
    expect(matchEntry([tile(7), tile(40)])).toEqual([7, 40]);
  });

  it("matches what the engine reports for a real match", () => {
    setRng(createSeededRng(1));
    let state = createGame(getLayout("turtle"), 3);
    const [a, b] = getAllFreePairs(state.tiles)[0]!;
    state = selectTile(state, a.id);
    state = selectTile(state, b.id);
    const event = state.events!.find((e) => e.type === "tileMatch");
    expect(event?.type).toBe("tileMatch");
    if (event?.type !== "tileMatch") return;
    expect(matchEntry(event.tiles)).toEqual([event.tiles[0].id, event.tiles[1].id]);
    expect([...(matchEntry(event.tiles) as number[])].sort()).toEqual([a.id, b.id].sort());
  });

  it("is a bare pair of numbers, small enough for a 144-tile board", () => {
    const entry = matchEntry([tile(142), tile(143)]) as readonly number[];
    expect(Array.isArray(entry)).toBe(true);
    expect(entry).toHaveLength(2);
    expect(JSON.stringify(entry)).toBe("[142,143]");
  });
});

describe("shuffleEntry", () => {
  it("lists, per new tile id, the old index of the position it takes and its face", () => {
    const { before, after } = shuffledOnce();
    const entry = shuffleEntry(after) as { s: number[]; f: number[] };
    expect(entry.s).toHaveLength(before.tiles.length);
    expect(entry.f).toHaveLength(before.tiles.length);
    after.tiles.forEach((t, i) => {
      expect(t.id).toBe(i);
      const at = before.tiles[entry.s[i]!]!;
      expect([at.col, at.row, at.layer]).toEqual([t.col, t.row, t.layer]);
      expect(entry.f[i]).toBe(t.faceId);
    });
  });

  it("uses every position of the board before it exactly once, and keeps its faces", () => {
    const { before, after } = shuffledOnce("pyramid", 8);
    const entry = shuffleEntry(after) as { s: number[]; f: number[] };
    expect([...entry.s].sort((x, y) => x - y)).toEqual(before.tiles.map((_, i) => i));
    expect([...entry.f].sort((x, y) => x - y)).toEqual(
      before.tiles.map((t) => t.faceId).sort((x, y) => x - y)
    );
  });

  it("is bare numbers only: no suit names, no coordinates", () => {
    const { after } = shuffledOnce();
    const entry = shuffleEntry(after) as { s: number[]; f: number[] };
    expect(Object.keys(entry).sort()).toEqual(["f", "s"]);
    expect(entry.s.every(Number.isInteger) && entry.f.every(Number.isInteger)).toBe(true);
  });

  it("is 's' when the shuffle left the board as it was (a geometric deadlock)", () => {
    const { before } = shuffledOnce();
    const stuck: MahjongState = {
      ...before,
      undoStack: [
        {
          kind: "shuffle",
          tilesBefore: null,
          scoreBefore: 0,
          pairsRemovedBefore: 0,
          shufflesLeftBefore: 3,
          selectedBefore: null,
          isCompleteBefore: false,
          isDeadlockedBefore: false,
        },
      ],
    };
    expect(shuffleEntry(stuck)).toBe("s");
  });

  it("is 's' when the state holds no shuffle to read (not a state this was called with)", () => {
    const { before } = shuffledOnce();
    expect(shuffleEntry(before)).toBe("s");
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe("createActionLog", () => {
  const entry = (n: number): MoveEntry => [n, n + 1];

  it("hands a chunk over at exactly ACTIONS_PER_CHUNK actions", () => {
    const emitted: MoveEntry[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    for (let i = 0; i < ACTIONS_PER_CHUNK - 1; i += 1) log.push(entry(i));
    expect(emitted).toHaveLength(0);
    log.push(entry(ACTIONS_PER_CHUNK - 1));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(ACTIONS_PER_CHUNK);
    log.push(entry(ACTIONS_PER_CHUNK));
    expect(emitted).toHaveLength(1);
  });

  it("chunks 25 actions, as the AC's example", () => {
    expect(ACTIONS_PER_CHUNK).toBe(25);
  });

  it("flush hands over the partial chunk, once, and nothing when empty", () => {
    const emitted: MoveEntry[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    log.flush();
    expect(emitted).toHaveLength(0);
    for (let i = 0; i < 7; i += 1) log.push(entry(i));
    log.flush();
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([7]);
  });

  it("keeps order, loses nothing, and never reuses an emitted array", () => {
    const emitted: MoveEntry[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    const n = 2 * ACTIONS_PER_CHUNK + 3;
    for (let i = 0; i < n; i += 1) log.push(["u", "h"][i % 2] as MoveEntry);
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([ACTIONS_PER_CHUNK, ACTIONS_PER_CHUNK, 3]);
    expect(emitted.flat()).toEqual(Array.from({ length: n }, (_, i) => ["u", "h"][i % 2]));
    expect(new Set(emitted).size).toBe(3);
  });

  it("clear forgets what is collected without handing it over", () => {
    const emitted: MoveEntry[][] = [];
    const log = createActionLog((m) => emitted.push(m));
    log.push(entry(1));
    log.clear();
    log.flush();
    expect(emitted).toEqual([]);
  });

  it("honours a chunk size argument", () => {
    const emitted: MoveEntry[][] = [];
    const log = createActionLog((m) => emitted.push(m), 2);
    for (let i = 0; i < 5; i += 1) log.push(entry(i));
    expect(emitted.map((c) => c.length)).toEqual([2, 2]);
  });
});

// ---------------------------------------------------------------------------
// MahjongReplay
// ---------------------------------------------------------------------------

describe("MahjongReplay", () => {
  function spySink(open = true) {
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
      flush: jest.fn(() => {
        calls.push("flush");
      }),
    };
    return { sink, calls };
  }

  it("hands a full chunk to the recorder as one unit: begin, one moves record, close", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 3);
    replay.match([tile(1), tile(2)]);
    replay.undo();
    expect(calls).toEqual([]);
    replay.hint();
    expect(calls).toEqual(["begin 1", 'record [[1,2],"u","h"]', "close"]);
    expect(replay.unit).toBe(1);
  });

  it("numbers the units 1, 2, 3 ... and flushes the partial chunk and the recorder", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 2);
    for (let i = 0; i < 5; i += 1) replay.hint();
    replay.flush();
    expect(calls.filter((c) => c.startsWith("begin"))).toEqual(["begin 1", "begin 2", "begin 3"]);
    expect(calls[calls.length - 1]).toBe("flush");
    expect(replay.unit).toBe(3);
  });

  it("flush with nothing waiting only asks the recorder to save", () => {
    const { sink, calls } = spySink();
    new MahjongReplay(sink).flush();
    expect(calls).toEqual(["flush"]);
  });

  it("records nothing while no game session is open", () => {
    const { sink, calls } = spySink(false);
    const replay = new MahjongReplay(sink, 1);
    replay.hint();
    replay.undo();
    replay.match([tile(1), tile(2)]);
    expect(calls).toEqual([]);
    expect(replay.unit).toBe(0);
  });

  it("reset forgets the chunk in progress and starts the unit count again", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 2);
    replay.hint();
    replay.hint();
    expect(replay.unit).toBe(1);
    replay.hint();
    replay.reset();
    replay.flush();
    expect(calls.filter((c) => c.startsWith("record"))).toHaveLength(1);
    expect(replay.unit).toBe(0);
    replay.hint();
    replay.hint();
    expect(replay.unit).toBe(1);
  });

  it("resumeAt carries the unit count on: the next chunk is the saved count plus one", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 1);
    replay.resumeAt(7);
    expect(replay.unit).toBe(7);
    replay.hint();
    expect(calls[0]).toBe("begin 8");
    expect(replay.unit).toBe(8);
  });

  it.each([0, -3, 2.5, Number.NaN])("resumeAt(%p) starts from the first unit", (bad) => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 1);
    replay.resumeAt(bad);
    replay.hint();
    expect(calls[0]).toBe("begin 1");
  });

  it("resumeAt drops a chunk left over from before", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 2);
    replay.hint();
    replay.resumeAt(4);
    replay.hint();
    expect(calls).toEqual([]);
  });

  it("builds a shuffle's entry from the state it produced", () => {
    const { sink, calls } = spySink();
    const replay = new MahjongReplay(sink, 1);
    const { after } = shuffledOnce();
    replay.shuffle(after);
    expect(calls[1]).toBe(`record ${JSON.stringify([shuffleEntry(after)])}`);
  });
});

// ---------------------------------------------------------------------------
// Size against the caps
// ---------------------------------------------------------------------------

describe("size", () => {
  it("registers moves as a chunkable replay event with the 2 KB cap", () => {
    const config = recordingConfigFor("mahjong");
    expect(config).toBe(gameRecordingConfigs.mahjong);
    expect(config.events.moves).toEqual({ maxBytes: MAHJONG_MOVES_MAX_BYTES, chunkField: "m" });
    expect(MAHJONG_MOVES_MAX_BYTES).toBe(2048);
    expect(eventQueueConfig.logConfig.priorityForEvent("game_event", "moves")).toBe(
      eventQueueConfig.Priority.REPLAY
    );
  });

  it("a worst honest chunk (24 matches of the largest ids and a full-board shuffle) is under the cap, unsplit", () => {
    const { before, after } = shuffledOnce("turtle", 2);
    expect(before.tiles).toHaveLength(144);
    const { replay, saved } = wiredReplay();
    for (let i = 0; i < ACTIONS_PER_CHUNK - 1; i += 1) replay.match([tile(142), tile(143)]);
    replay.shuffle(after);
    replay.flush();
    // the shuffle was the 25th action: one full chunk
    const events = saved.filter((e) => e.type === "moves");
    expect(events).toHaveLength(1);
    const bytes = JSON.stringify(events[0]!.data).length;
    expect(bytes).toBeLessThan(MAHJONG_MOVES_MAX_BYTES);
    expect((events[0]!.data as { parts?: number }).parts).toBeUndefined();
    process.stdout.write(`[mahjong #3285] worst honest chunk: ${bytes} B JSON\n`);
  });

  it("the session is capped at 20 KB: a game of full-board shuffles stops recording as a clean prefix", () => {
    expect(recordingConfigFor("mahjong").sessionMaxBytes).toBe(MAHJONG_SESSION_MAX_BYTES);
    const { after } = shuffledOnce("turtle", 2);
    const { replay, recorder, saved } = wiredReplay(1);
    for (let i = 0; i < 60; i += 1) replay.shuffle(after);
    replay.flush();
    recorder.endSession();
    const total = saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(total).toBeLessThanOrEqual(MAHJONG_SESSION_MAX_BYTES);
    expect(saved.length).toBeGreaterThan(15);
    expect(saved.length).toBeLessThan(60);
    // a prefix: the units that were saved are 1, 2, 3 ...
    expect(saved.map((e) => (e.data as { unit: number }).unit)).toEqual(saved.map((_, i) => i + 1));
  });

  it("a chunk of shuffles (undo, shuffle, undo, ...) is split on m, not dropped", () => {
    const { after } = shuffledOnce("turtle", 2);
    const { replay, recorder, saved } = wiredReplay();
    for (let i = 0; i < 12; i += 1) {
      replay.shuffle(after);
      replay.undo();
    }
    replay.flush();
    recorder.endSession();
    const events = saved.filter((e) => e.type === "moves");
    expect(events.length).toBeGreaterThan(1);
    for (const e of events) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(MAHJONG_MOVES_MAX_BYTES);
    }
    const entries = events.flatMap((e) => (e.data as { m: MoveEntry[] }).m);
    expect(entries).toHaveLength(24);
    expect(entries.filter((m) => typeof m === "object" && !Array.isArray(m))).toHaveLength(12);
  });

  it("a whole scripted game is a handful of events, far inside the session cap", () => {
    const game = playScripted({ layout: "turtle", seed: 21 });
    const events = game.saved.filter((e) => e.type === "moves");
    const total = events.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    for (const e of events) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(MAHJONG_MOVES_MAX_BYTES);
    }
    expect(events.length).toBeLessThanOrEqual(Math.ceil(game.entries.length / ACTIONS_PER_CHUNK));
    expect(total).toBeLessThan(recordingConfigFor("mahjong").sessionMaxBytes / 4);
  });
});

// ---------------------------------------------------------------------------
// Golden replay
// ---------------------------------------------------------------------------

describe("golden replay", () => {
  const SCRIPTS: readonly Script[] = [
    { layout: "turtle", seed: 42 },
    { layout: "pyramid", seed: 7, shuffleSeed: 5 },
    { layout: "double_pyramid", seed: 3 },
    { layout: "four_rivers", seed: 11, shuffleSeed: 123 },
  ];

  it.each(SCRIPTS)(
    "$layout seed $seed: the deal's seed plus the recorded events rebuild the final board",
    (script) => {
      const game = playScripted(script);
      // The scripts exercise every kind of entry.
      expect(game.counts.matches).toBeGreaterThan(30);
      expect(game.counts.shuffles).toBeGreaterThanOrEqual(2);
      expect(game.counts.undos).toBeGreaterThanOrEqual(2);
      expect(game.counts.hints).toBeGreaterThanOrEqual(2);
      expect(game.saved.length).toBeGreaterThan(2);

      const rebuilt = rebuildGame(game.start, game.saved);
      expect(gameOutcome(rebuilt)).toEqual(gameOutcome(game.final));
    }
  );

  it("rebuilds a game played to the end: the cleared board, score and all", () => {
    const game = playScripted({ layout: "turtle", seed: 42 });
    expect(game.final.isComplete).toBe(true);
    const rebuilt = rebuildGame(game.start, game.saved);
    expect(rebuilt.tiles).toEqual([]);
    expect(rebuilt.isComplete).toBe(true);
    expect(rebuilt.score).toBe(game.final.score);
    expect(rebuilt.pairsRemoved).toBe(72);
  });

  it.each(LAYOUTS.map((l) => l.id))("%s: a short recorded game rebuilds", (layout) => {
    const game = playScripted({ layout, seed: 5, maxSteps: 38 });
    expect(game.counts.shuffles).toBeGreaterThanOrEqual(1);
    expect(gameOutcome(rebuildGame(game.start, game.saved))).toEqual(gameOutcome(game.final));
  });

  it("the chunk size does not change what is rebuilt", () => {
    const small = playScripted({ layout: "turtle", seed: 42, chunkSize: 8 });
    const large = playScripted({ layout: "turtle", seed: 42, chunkSize: 100 });
    expect(small.saved.length).toBeGreaterThan(large.saved.length);
    expect(small.entries).toEqual(large.entries);
    expect(gameOutcome(rebuildGame(small.start, small.saved))).toEqual(gameOutcome(large.final));
  });

  it("rebuilds a shuffle that left the board as it was (a geometric deadlock)", () => {
    // Two matching tiles stacked on one spot: the only pair there is can never be free.
    const stacked: SlotTile[] = [
      { id: 0, suit: "circles", rank: 1, faceId: 17, col: 0, row: 0, layer: 0 },
      { id: 1, suit: "circles", rank: 1, faceId: 17, col: 0, row: 0, layer: 1 },
    ];
    const before: MahjongState = {
      ...createGame(getLayout("turtle"), 1),
      tiles: stacked,
      pairsRemoved: 70,
      shufflesLeft: 3,
      undoStack: [],
    };
    const after = shuffleBoard(before);
    expect(after.isDeadlocked).toBe(true);
    const entry = shuffleEntry(after);
    expect(entry).toBe("s");
    const rebuilt = applyEntry(before, entry);
    expect(gameOutcome(rebuilt)).toEqual(gameOutcome(after));
    expect(rebuilt.shufflesLeft).toBe(2);
  });

  it("refuses an entry that does not apply to the board it meets", () => {
    const board = createGame(getLayout("turtle"), 1);
    // the first and last tile of a deal are never both free matching tiles
    expect(() => applyEntry(board, [0, 143])).toThrow(ReplayError);
    expect(() => applyEntry(board, { s: [999], f: [1] })).toThrow(ReplayError);
  });

  it("chunks arrive in order and the unit numbers count 1, 2, 3 ...", () => {
    const game = playScripted({ layout: "turtle", seed: 42 });
    const units = game.saved.map((e) => (e.data as { unit: number }).unit);
    expect(units).toEqual(units.map((_, i) => i + 1));
    const sizes = game.saved.map((e) => (e.data as { m: unknown[] }).m.length);
    expect(sizes.slice(0, -1).every((n) => n === ACTIONS_PER_CHUNK)).toBe(true);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(ACTIONS_PER_CHUNK);
  });

  describe("a recorder that loses information fails (the test can tell)", () => {
    const base = () => playScripted({ layout: "turtle", seed: 42 });

    const withEntries = (
      game: ReturnType<typeof base>,
      keep: (entry: MoveEntry, index: number) => boolean
    ): EnqueueEventInput[] => {
      let index = 0;
      return game.saved.map((e) => ({
        ...e,
        data: {
          ...e.data,
          m: (e.data as { m: MoveEntry[] }).m.filter((entry) => keep(entry, index++)),
        },
      }));
    };

    it("without the shuffles' order", () => {
      const game = base();
      const events = withEntries(
        game,
        (entry) => !(typeof entry === "object" && !Array.isArray(entry))
      );
      let rebuilt: MahjongState | null = null;
      try {
        rebuilt = rebuildGame(game.start, events);
      } catch (error) {
        expect(error).toBeInstanceOf(ReplayError);
      }
      if (rebuilt !== null) {
        expect(gameOutcome(rebuilt)).not.toEqual(gameOutcome(game.final));
      }
    });

    it("without the undos", () => {
      const game = base();
      const events = withEntries(game, (entry) => entry !== "u");
      let differs = false;
      try {
        differs =
          JSON.stringify(gameOutcome(rebuildGame(game.start, events))) !==
          JSON.stringify(gameOutcome(game.final));
      } catch (error) {
        expect(error).toBeInstanceOf(ReplayError);
        differs = true;
      }
      expect(differs).toBe(true);
    });

    it("without a match", () => {
      const game = base();
      const events = withEntries(game, (_entry, i) => i !== 3);
      let differs = false;
      try {
        differs =
          JSON.stringify(gameOutcome(rebuildGame(game.start, events))) !==
          JSON.stringify(gameOutcome(game.final));
      } catch (error) {
        differs = error instanceof ReplayError;
      }
      expect(differs).toBe(true);
    });

    it("without a chunk", () => {
      const game = base();
      const holed = game.saved.filter((_, i) => i !== 1);
      let differs = false;
      try {
        differs =
          JSON.stringify(gameOutcome(rebuildGame(game.start, holed))) !==
          JSON.stringify(gameOutcome(game.final));
      } catch (error) {
        differs = error instanceof ReplayError;
      }
      expect(differs).toBe(true);
    });

    it("with a different seed", () => {
      const game = base();
      let differs = false;
      try {
        differs =
          JSON.stringify(gameOutcome(rebuildGame({ ...game.start, seed: 43 }, game.saved))) !==
          JSON.stringify(gameOutcome(game.final));
      } catch (error) {
        differs = error instanceof ReplayError;
      }
      expect(differs).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Cost: the row bound, and games that cannot be rebuilt
// ---------------------------------------------------------------------------

describe("the row bound (MAHJONG_MAX_UNITS)", () => {
  it("is 20 rows", () => {
    expect(MAHJONG_MAX_UNITS).toBe(20);
  });

  it("hint spam is cut off after 20 rows, a clean prefix", () => {
    const { replay, recorder, saved } = wiredReplay();
    for (let i = 0; i < 5000; i += 1) replay.hint();
    replay.flush();
    recorder.endSession();
    const units = saved.map((e) => (e.data as { unit: number }).unit);
    expect(units).toEqual(Array.from({ length: MAHJONG_MAX_UNITS }, (_, i) => i + 1));
    expect(replay.unit).toBe(MAHJONG_MAX_UNITS);
  });

  it("an action after every flush (backgrounding again and again) is cut off too", () => {
    const { replay, recorder, saved } = wiredReplay();
    for (let i = 0; i < 500; i += 1) {
      replay.hint();
      replay.flush();
    }
    recorder.endSession();
    expect(saved).toHaveLength(MAHJONG_MAX_UNITS);
  });

  it("a resumed game's count carries on: the bound is per game, not per process", () => {
    const { replay, recorder, saved } = wiredReplay(1);
    replay.resumeAt(MAHJONG_MAX_UNITS - 2);
    for (let i = 0; i < 10; i += 1) replay.hint();
    recorder.endSession();
    expect(saved).toHaveLength(2);
    expect(replay.unit).toBe(MAHJONG_MAX_UNITS);
  });

  it("does not collect actions once spent (no memory growth)", () => {
    const { sink, calls } = (() => {
      const calls: string[] = [];
      const sink: ReplaySink = {
        isOpen: () => true,
        beginUnit: (n) => n,
        record: () => calls.push("record"),
        closeUnit: () => undefined,
        flush: () => undefined,
      };
      return { sink, calls };
    })();
    const replay = new MahjongReplay(sink, 1, 3);
    for (let i = 0; i < 50; i += 1) replay.hint();
    expect(calls).toHaveLength(3);
  });
});

describe("block (a game with no deal seed)", () => {
  function counting() {
    const calls: string[] = [];
    const sink: ReplaySink = {
      isOpen: () => true,
      beginUnit: (n) => n,
      record: () => calls.push("record"),
      closeUnit: () => undefined,
      flush: () => undefined,
    };
    return { replay: new MahjongReplay(sink, 1), calls };
  }

  it("records nothing, and drops what was collected", () => {
    const { replay, calls } = counting();
    const waiting = new MahjongReplay(
      {
        isOpen: () => true,
        beginUnit: (n) => n,
        record: () => calls.push("waiting"),
        closeUnit: () => undefined,
        flush: () => undefined,
      },
      5
    );
    waiting.hint();
    waiting.block();
    waiting.flush();
    replay.block();
    replay.hint();
    replay.match([tile(1), tile(2)]);
    expect(calls).toEqual([]);
    expect(replay.unit).toBe(0);
  });

  it("a new game (reset) and a resumed one (resumeAt) record again", () => {
    const { replay, calls } = counting();
    replay.block();
    replay.reset();
    replay.hint();
    replay.block();
    replay.resumeAt(2);
    replay.hint();
    expect(calls).toHaveLength(2);
  });
});

describe("standingEvents (a repeated unit number is a restart point)", () => {
  const event = (unit: number, m: unknown[], part?: number): EnqueueEventInput => ({
    type: "moves",
    data: { v: 1, unit, t_ms: unit, m, ...(part !== undefined && { part, parts: 2 }) },
  });
  const units = (events: EnqueueEventInput[]) =>
    events.map((e) => (e.data as { unit: number }).unit);

  it("keeps a clean run as it is", () => {
    const events = [event(1, ["h"]), event(2, ["h"]), event(3, ["h"])];
    expect(standingEvents(events)).toEqual(events);
  });

  it("drops the stale chunks a resumed game did not keep", () => {
    const stale = event(4, [[0, 143]]);
    const fresh = event(4, ["h"]);
    const events = [
      event(1, ["h"]),
      event(2, ["h"]),
      event(3, ["h"]),
      stale,
      fresh,
      event(5, ["h"]),
    ];
    const kept = standingEvents(events);
    expect(units(kept)).toEqual([1, 2, 3, 4, 5]);
    expect(kept).not.toContain(stale);
    expect(kept).toContain(fresh);
  });

  it("a restart further back drops every chunk from there on", () => {
    const kept = standingEvents([
      event(1, ["h"]),
      event(2, ["h"]),
      event(3, ["h"]),
      event(2, ["u"]),
    ]);
    expect(units(kept)).toEqual([1, 2]);
    expect((kept[1]!.data as { m: unknown[] }).m).toEqual(["u"]);
  });

  it("the parts of one split event share a unit and are all kept", () => {
    const events = [event(1, ["h"]), event(2, ["h"], 0), event(2, ["h"], 1), event(3, ["h"])];
    expect(standingEvents(events)).toEqual(events);
  });

  it("a game that resumed in the debounce window still rebuilds", () => {
    const game = playScripted({ layout: "turtle", seed: 42, chunkSize: 8 });
    expect(game.saved.length).toBeGreaterThan(5);
    const events = [...game.saved];
    // the server holds a chunk the saved game never had; the resumed game re-sends its unit
    const unit = 3;
    const stale = event(unit, [[0, 143]]);
    events.splice(unit - 1, 0, stale);
    expect(() => rebuildGame(game.start, events)).not.toThrow();
    expect(gameOutcome(rebuildGame(game.start, events))).toEqual(gameOutcome(game.final));
  });
});

// ---------------------------------------------------------------------------
// Kill switch: the recorder decides, once per session
// ---------------------------------------------------------------------------

describe("kill switch (a recorder with recording off)", () => {
  /** The same wiring as the screen, over spies, with the recorder recording or not. */
  function wired(enabled: boolean) {
    const enqueueMany = jest.fn(() => true);
    const canAccept = jest.fn(() => true);
    const schedule = jest.fn();
    const report = jest.fn();
    const recorder = new GameRecorder<"mahjong">({
      gameType: "mahjong",
      sink: { canAccept, enqueueMany },
      schedule,
      report,
      enabled: () => enabled,
    });
    const sink: ReplaySink = {
      isOpen: () => true,
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
      flush: () => recorder.flush(),
    };
    const replay = new MahjongReplay(sink, 3);
    return { recorder, replay, enqueueMany, canAccept, schedule, report };
  }

  it("with recording off the recorder holds, schedules and saves nothing", () => {
    const { recorder, replay, enqueueMany, canAccept, schedule, report } = wired(false);
    recorder.startSession();
    const { after } = shuffledOnce();
    for (let i = 0; i < 40; i += 1) replay.match([tile(1), tile(2)]);
    replay.undo();
    replay.hint();
    replay.shuffle(after);
    replay.flush();
    expect(recorder.held).toBe(0);
    recorder.endSession();
    expect(enqueueMany).not.toHaveBeenCalled();
    expect(canAccept).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("with recording on, the same play is scheduled and saved (the spies can tell)", () => {
    const { recorder, replay, enqueueMany, schedule } = wired(true);
    recorder.startSession();
    for (let i = 0; i < 40; i += 1) replay.match([tile(1), tile(2)]);
    expect(schedule).toHaveBeenCalled();
    replay.flush();
    recorder.endSession();
    expect(enqueueMany).toHaveBeenCalled();
    expect(replay.unit).toBe(Math.ceil(40 / 3));
  });

  it("the replay does not read the dial itself", () => {
    const spy = jest.spyOn(eventQueueConfig, "isRecordingEnabled");
    try {
      const { replay } = wired(true);
      replay.hint();
      replay.flush();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
      flush: () => {
        if (fail.on) throw new Error("flush broke");
      },
    };
    return { sink, fail, recorded };
  }

  it("a recorder that throws does not reach the caller, and recording resumes when it recovers", () => {
    const { sink, fail, recorded } = throwingSink();
    const replay = new MahjongReplay(sink, 1);
    expect(() => replay.hint()).not.toThrow();
    expect(() => replay.match([tile(1), tile(2)])).not.toThrow();
    expect(() => replay.undo()).not.toThrow();
    expect(() => replay.flush()).not.toThrow();
    fail.on = false;
    replay.hint();
    expect(recorded).toEqual([1]);
  });

  it("a sink that cannot say whether a game is open does not break play either", () => {
    const { sink } = throwingSink();
    const replay = new MahjongReplay({
      ...sink,
      isOpen: () => {
        throw new Error("no session");
      },
    });
    expect(() => replay.hint()).not.toThrow();
    expect(() => replay.shuffle(shuffledOnce().after)).not.toThrow();
  });

  it("a failure is reported to Sentry through the throttle: once, by name only", () => {
    resetSentryThrottle();
    (Sentry.captureMessage as jest.Mock).mockClear();
    const { sink } = throwingSink();
    const replay = new MahjongReplay(sink, 1);
    for (let i = 0; i < 20; i += 1) replay.hint();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0]!;
    expect(message).toBe("mahjong replay recording failed");
    expect(JSON.stringify(options)).not.toContain("recorder broke");
  });
});
