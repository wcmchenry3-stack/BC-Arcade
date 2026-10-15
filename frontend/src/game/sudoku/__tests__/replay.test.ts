/**
 * Sudoku replay recording (#3288, epic #3273): the entry builders, the chunking,
 * the golden replay (a scripted seeded game rebuilt from its events alone), the
 * byte caps and the kill switch.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import {
  SUDOKU_ENTRIES_MAX_BYTES,
  gameEventRegistry,
  recordingEventCap,
  recordingConfigFor,
  resetLogConfig,
} from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { enterDigit, loadPuzzle, selectCell, toggleNotesMode, applyHint } from "../engine";
import {
  ENTRIES_PER_CHUNK,
  OP_DIGIT,
  OP_ERASE,
  OP_HINT,
  OP_NOTE,
  OP_UNDO,
  applyRecorded,
  createEntryLog,
  unitOfEntry,
  type EntryTuple,
} from "../replay";
import type { CellValue, SudokuState } from "../types";
import { notesOf, playGolden, startRecording, valuesOf } from "./helpers/goldenGame";
import { rebuildFromEvents } from "./helpers/rebuild";

const entries = (saved: { data?: Record<string, unknown> }[]) =>
  saved.flatMap((e) => (e.data as { e: number[][] }).e);

/** A classic puzzle state with `cell` selected. */
function stateWith(rng: () => number, cell?: number, variant: "classic" | "mini" = "classic") {
  const s = loadPuzzle("easy", variant, rng);
  if (cell === undefined) return s;
  const size = variant === "mini" ? 6 : 9;
  return selectCell(s, Math.floor(cell / size), cell % size);
}

const firstEmpty = (s: SudokuState) => s.puzzle.indexOf("0");

describe("applyRecorded: the entry for each action", () => {
  const rng = () => 0.31;

  it("a digit is [0, cell, digit]", () => {
    const s0 = loadPuzzle("easy", "classic", rng);
    const cell = firstEmpty(s0);
    const s = stateWith(rng, cell);
    const sol = Number(s.solution[cell]);
    const r = applyRecorded(s, { kind: "digit", digit: sol as CellValue });
    expect(r?.entry).toEqual([OP_DIGIT, cell, sol]);
    expect(r?.next.grid[Math.floor(cell / 9)]![cell % 9]!.value).toBe(sol);
  });

  it("an illegal digit carries the wrong-entry flag, a legal one that is not the solution does not", () => {
    const s0 = loadPuzzle("easy", "classic", rng);
    const cell = firstEmpty(s0);
    const s = stateWith(rng, cell);
    // a digit a given in the cell's row holds is a duplicate
    const dup = Number(s.puzzle.slice(0, 9).replace(/0/g, "")[0]);
    const wrong = applyRecorded(s, { kind: "digit", digit: dup as CellValue });
    expect(wrong?.entry).toEqual([OP_DIGIT, cell, dup, 1]);
    expect(wrong?.next.errorCount).toBe(1);

    // some digit that is legal here but not the solution: no flag, as in the score
    const legal = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as CellValue[]).find((d) => {
      if (d === Number(s.solution[cell])) return false;
      const next = enterDigit(s, d);
      return next.errorCount === s.errorCount;
    });
    expect(legal).toBeDefined();
    expect(applyRecorded(s, { kind: "digit", digit: legal! })?.entry).toEqual([
      OP_DIGIT,
      cell,
      legal,
    ]);
  });

  it("a digit in notes mode is a note: [1, cell, digit], and toggling it again is another note", () => {
    const cell = firstEmpty(loadPuzzle("easy", "classic", rng));
    let s = toggleNotesMode(stateWith(rng, cell));
    const on = applyRecorded(s, { kind: "digit", digit: 4 });
    expect(on?.entry).toEqual([OP_NOTE, cell, 4]);
    s = on!.next;
    const off = applyRecorded(s, { kind: "digit", digit: 4 });
    expect(off?.entry).toEqual([OP_NOTE, cell, 4]);
    expect(off?.next.errorCount).toBe(0);
  });

  it("an erase is [2, cell]; an undo is [3]", () => {
    const cell = firstEmpty(loadPuzzle("easy", "classic", rng));
    const s = stateWith(rng, cell);
    const placed = applyRecorded(s, {
      kind: "digit",
      digit: Number(s.solution[cell]) as CellValue,
    })!;
    const erased = applyRecorded(placed.next, { kind: "erase" });
    expect(erased?.entry).toEqual([OP_ERASE, cell]);
    expect(applyRecorded(erased!.next, { kind: "undo" })?.entry).toEqual([OP_UNDO]);
  });

  it("a hint is [4, cell, solution digit], never flagged", () => {
    const cell = firstEmpty(loadPuzzle("easy", "classic", rng));
    const s = stateWith(rng, cell);
    const r = applyRecorded(s, { kind: "hint" });
    expect(r?.entry).toEqual([OP_HINT, cell, Number(s.solution[cell])]);
    expect(r?.next.errorCount).toBe(0);
  });

  it("a hint on a full-but-wrong grid records the cell it corrected", () => {
    let s = loadPuzzle("easy", "classic", rng);
    const wrongCell = s.puzzle.lastIndexOf("0");
    for (let i = 0; i < 81; i++) {
      if (s.puzzle[i] !== "0") continue;
      const sol = Number(s.solution[i]);
      const d = i === wrongCell ? (sol % 9) + 1 : sol;
      s = enterDigit(selectCell(s, Math.floor(i / 9), i % 9), d as CellValue);
      // selecting the selected cell would deselect it: the loop moves on each time
    }
    expect(s.isComplete).toBe(false);
    // nothing selected: the hint finds the wrong cell by itself
    const none = { ...s, selectedRow: null, selectedCol: null };
    const r = applyRecorded(none, { kind: "hint" });
    expect(r?.entry).toEqual([OP_HINT, wrongCell, Number(s.solution[wrongCell])]);
    expect(r?.next.isComplete).toBe(true);
    expect(r?.next).toEqual(applyHint(none));
  });

  it("an action that changes nothing records nothing", () => {
    const s0 = loadPuzzle("easy", "classic", rng);
    const given = s0.puzzle.split("").findIndex((c) => c !== "0");
    const cell = firstEmpty(s0);
    // nothing selected
    expect(applyRecorded(s0, { kind: "digit", digit: 3 })).toBeNull();
    expect(applyRecorded(s0, { kind: "erase" })).toBeNull();
    expect(applyRecorded(s0, { kind: "hint" })).toBeNull();
    // a given
    const onGiven = selectCell(s0, Math.floor(given / 9), given % 9);
    expect(applyRecorded(onGiven, { kind: "digit", digit: 3 })).toBeNull();
    expect(applyRecorded(onGiven, { kind: "erase" })).toBeNull();
    // an empty cell: nothing to erase; nothing to undo
    const onEmpty = selectCell(s0, Math.floor(cell / 9), cell % 9);
    expect(applyRecorded(onEmpty, { kind: "erase" })).toBeNull();
    expect(applyRecorded(onEmpty, { kind: "undo" })).toBeNull();
  });

  it("numbers Mini's cells by its 6-wide rows", () => {
    const s0 = loadPuzzle("easy", "mini", rng);
    const cell = s0.puzzle.lastIndexOf("0");
    expect(cell).toBeGreaterThanOrEqual(6); // not in the first row
    const s = selectCell(s0, Math.floor(cell / 6), cell % 6);
    const sol = Number(s.solution[cell]);
    expect(applyRecorded(s, { kind: "digit", digit: sol as CellValue })?.entry).toEqual([
      OP_DIGIT,
      cell,
      sol,
    ]);
  });
});

describe("the entry log: chunks of ENTRIES_PER_CHUNK, numbered by where they start", () => {
  const e = (n: number): EntryTuple => [OP_DIGIT, n % 81, 1 + (n % 9)];

  function log(size?: number) {
    const emitted: { first: number; entries: EntryTuple[] }[] = [];
    const l = createEntryLog((first, entries) => emitted.push({ first, entries }), size);
    return { l, emitted };
  }

  it("holds a chunk in memory until it is full", () => {
    const { l, emitted } = log();
    for (let n = 0; n < ENTRIES_PER_CHUNK - 1; n++) l.push(e(n));
    expect(emitted).toEqual([]);
    l.push(e(ENTRIES_PER_CHUNK - 1));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.first).toBe(0);
    expect(emitted[0]!.entries).toHaveLength(ENTRIES_PER_CHUNK);
  });

  it("splits at the boundary: 33 entries are a chunk of 32 and, on flush, one of 1", () => {
    const { l, emitted } = log();
    for (let n = 0; n < 33; n++) l.push(e(n));
    expect(emitted.map((x) => [x.first, x.entries.length])).toEqual([[0, 32]]);
    l.flush();
    expect(emitted.map((x) => [x.first, x.entries.length])).toEqual([
      [0, 32],
      [32, 1],
    ]);
    l.flush(); // nothing collected: nothing handed over
    expect(emitted).toHaveLength(2);
  });

  it("a chunk flushed early is finished at the next boundary, under the same unit", () => {
    const { l, emitted } = log();
    for (let n = 0; n < 10; n++) l.push(e(n));
    l.flush();
    for (let n = 10; n < 40; n++) l.push(e(n));
    expect(emitted.map((x) => [x.first, x.entries.length])).toEqual([
      [0, 10],
      [10, 22],
    ]);
    expect(unitOfEntry(0)).toBe(1);
    expect(unitOfEntry(10)).toBe(1);
    expect(unitOfEntry(32)).toBe(2);
    expect(unitOfEntry(63)).toBe(2);
    expect(unitOfEntry(64)).toBe(3);
  });

  it("every entry is in exactly one chunk, in order", () => {
    const { l, emitted } = log();
    for (let n = 0; n < 100; n++) {
      l.push(e(n));
      if (n % 17 === 16) l.flush();
    }
    l.flush();
    expect(emitted.flatMap((x) => x.entries)).toEqual(Array.from({ length: 100 }, (_, n) => e(n)));
    let next = 0;
    for (const x of emitted) {
      expect(x.first).toBe(next);
      next += x.entries.length;
    }
  });

  it("reset(count) carries on from a saved game's entry count, and drops what was collected", () => {
    const { l, emitted } = log();
    l.push(e(0));
    l.reset(40);
    for (let n = 0; n < 30; n++) l.push(e(n));
    // 40..63 fill chunk 2 (units numbered from 1: entries 32..63), 64.. start chunk 3
    expect(emitted.map((x) => [x.first, x.entries.length])).toEqual([[40, 24]]);
    expect(unitOfEntry(40)).toBe(2);
    l.reset();
    l.push(e(0));
    l.flush();
    expect(emitted[1]!.first).toBe(0);
  });

  it("hands over a fresh array each time", () => {
    const { l, emitted } = log(2);
    l.push(e(0));
    l.push(e(1));
    l.push(e(2));
    l.push(e(3));
    expect(emitted[0]!.entries).not.toBe(emitted[1]!.entries);
  });
});

describe("golden replay: the givens plus the entries rebuild the final grid", () => {
  it.each([
    ["classic easy", "easy", "classic", 0.42],
    ["classic hard", "hard", "classic", 0.77],
    ["mini", "easy", "mini", 0.5],
  ] as const)("%s", (_name, difficulty, variant, seed) => {
    const g = playGolden(difficulty, variant, () => seed);
    const rebuilt = rebuildFromEvents(g.puzzle, g.saved);
    expect(rebuilt.values).toBe(valuesOf(g.state));
    expect(rebuilt.notes).toEqual(notesOf(g.state));
    expect(rebuilt.errors).toBe(g.state.errorCount);
    // the script covers every kind of entry, and the rest of the game besides
    for (const op of [OP_DIGIT, OP_NOTE, OP_ERASE, OP_UNDO, OP_HINT]) {
      expect(g.counts[op] ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(rebuilt.notes).length).toBeGreaterThanOrEqual(2); // notes left on the board
    const flagged = entries(g.saved).filter((x) => x[0] === OP_DIGIT && x[3] === 1);
    expect(flagged).toHaveLength(1);
    // the game is the entries' count, in order, with no hole
    expect(rebuilt.entries).toBe(entries(g.saved).length);
    // and it spans more than one chunk for Classic, so chunk joins are rebuilt too
    if (variant === "classic") expect(g.saved.length).toBeGreaterThan(1);
  });

  it("is not the starting grid: dropping any one chunk changes the rebuilt grid or breaks the sequence", () => {
    const g = playGolden("hard", "classic", () => 0.77);
    expect(g.saved.length).toBeGreaterThan(2);
    for (let drop = 0; drop < g.saved.length; drop++) {
      const without = g.saved.filter((_, i) => i !== drop);
      // a missing chunk is visible: `i` no longer follows on
      if (drop === g.saved.length - 1) {
        expect(rebuildFromEvents(g.puzzle, without).values).not.toBe(valuesOf(g.state));
      } else {
        expect(() => rebuildFromEvents(g.puzzle, without)).toThrow(/hole in the entries/);
      }
    }
  });

  it("an undo past the 50-snapshot limit changes nothing and is not recorded", () => {
    let s = loadPuzzle("hard", "classic", () => 0.77);
    const empties = [...s.puzzle].flatMap((c, i) => (c === "0" ? [i] : []));
    expect(empties.length).toBeGreaterThan(50);
    const rec = startRecording();
    for (const cell of empties) {
      s = selectCell(s, Math.floor(cell / 9), cell % 9);
      s = rec.play(s, { kind: "digit", digit: Number(s.solution[cell]) as CellValue });
    }
    let undos = 0;
    for (let i = 0; i < 60; i++) {
      const before = s;
      s = rec.play(s, { kind: "undo" });
      if (s !== before) undos += 1;
    }
    rec.finish();
    expect(undos).toBe(50);
    expect(entries(rec.saved).filter((x) => x[0] === OP_UNDO)).toHaveLength(50);
    const rebuilt = rebuildFromEvents(s.puzzle, rec.saved);
    expect(rebuilt.values).toBe(valuesOf(s));
  });

  it("a game resumed after a kill carries on: units never repeat and `i` shows the hole", () => {
    // 40 entries were recorded before the kill; the chunk 32..39 was not saved
    const rec = startRecording({ count: 40 });
    let s = loadPuzzle("easy", "classic", () => 0.42);
    const empties = [...s.puzzle].flatMap((c, i) => (c === "0" ? [i] : []));
    for (const cell of empties.slice(0, 30)) {
      s = selectCell(s, Math.floor(cell / 9), cell % 9);
      s = rec.play(s, { kind: "digit", digit: Number(s.solution[cell]) as CellValue });
    }
    rec.finish();
    const data = rec.saved.map((e) => e.data as { unit: number; i: number; e: unknown[] });
    expect(data.map((d) => [d.unit, d.i, d.e.length])).toEqual([
      [2, 40, 24], // chunk 2 finishes where the saved count left off
      [3, 64, 6],
    ]);
    // the reader sees the missing 0..39
    expect(() => rebuildFromEvents(s.puzzle, rec.saved)).toThrow(/expected 0, got 40/);
  });
});

describe("sizes", () => {
  it("the registry types entries as a replay event with its own cap, never split into parts", () => {
    const spec = gameEventRegistry.sudoku.events.entries as {
      tier: number;
      maxBytes?: number;
      chunkField?: string;
    };
    expect(spec.maxBytes).toBe(SUDOKU_ENTRIES_MAX_BYTES);
    expect(spec.chunkField).toBeUndefined();
    expect(recordingEventCap(recordingConfigFor("sudoku"), "entries")).toBe(512);
  });

  it("a worst-case chunk (long numbers, every entry the longest shape) is under the cap", () => {
    const reports: RecordingDropReport[] = [];
    const saved: { data?: Record<string, unknown> }[] = [];
    const recorder = new GameRecorder<"sudoku">({
      gameType: "sudoku",
      sink: {
        canAccept: () => true,
        enqueueMany: (b) => {
          saved.push(...b);
          return true;
        },
      },
      now: (() => {
        let t = 0;
        return () => (t += 2_000_000_000);
      })(),
      schedule: (task) => task(),
      report: (r) => reports.push(r),
    });
    recorder.startSession();
    const worst: EntryTuple[] = Array.from({ length: ENTRIES_PER_CHUNK }, () => [
      OP_DIGIT,
      80,
      9,
      1,
    ]);
    recorder.beginUnit(99_999);
    recorder.record("entries", { i: 99_999 * ENTRIES_PER_CHUNK, e: worst });
    recorder.closeUnit();
    recorder.endSession();
    expect(saved).toHaveLength(1);
    const size = JSON.stringify(saved[0]!.data).length;
    expect(size).toBeLessThanOrEqual(SUDOKU_ENTRIES_MAX_BYTES * 0.85);
    expect(reports).toEqual([]);
  });

  it("a full chunk of 32 is under 420 B", () => {
    const g = playGolden("hard", "classic", () => 0.77);
    const full = g.saved.filter((e) => (e.data as { e: unknown[] }).e.length === ENTRIES_PER_CHUNK);
    expect(full.length).toBeGreaterThan(0);
    for (const e of full) expect(JSON.stringify(e.data).length).toBeLessThan(420);
  });
});

describe("kill switch: recording off for this game", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
  });

  it("the recorder does no work: nothing reaches the store, nothing is written", async () => {
    const store = new EventStore();
    const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
    await client.init();
    const gameId = client.startGame("sudoku");
    client.markStarted(gameId);
    await new Promise((r) => setTimeout(r, 10));
    const saveEvent = jest.spyOn(store, "enqueueEvent");
    const saveMany = jest.spyOn(store, "enqueueMany");
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();

    const tasks: (() => void)[] = [];
    const recorder = new GameRecorder<"sudoku">({
      gameType: "sudoku",
      sink: { canAccept: () => true, enqueueMany: (b) => (client.enqueueEvents(gameId, b), true) },
      schedule: (t) => tasks.push(t),
      enabled: () => false,
    });
    recorder.startSession();
    const log = createEntryLog((first, e) => {
      recorder.beginUnit(unitOfEntry(first));
      recorder.record("entries", { i: first, e });
      recorder.closeUnit();
    });
    let s = loadPuzzle("easy", "classic", () => 0.42);
    const empties = [...s.puzzle].flatMap((c, i) => (c === "0" ? [i] : []));
    for (const cell of empties) {
      s = selectCell(s, Math.floor(cell / 9), cell % 9);
      const r = applyRecorded(s, { kind: "digit", digit: Number(s.solution[cell]) as CellValue });
      if (r) {
        log.push(r.entry);
        s = r.next;
      }
    }
    log.flush();
    recorder.flush();
    while (tasks.length > 0) tasks.shift()?.();
    recorder.endSession();
    await new Promise((r) => setTimeout(r, 10));

    expect(tasks).toEqual([]);
    expect(saveEvent).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(s.isComplete).toBe(true);
    jest.restoreAllMocks();
  });
});
