/**
 * Sudoku replay recording benchmark (#3288, epic #3273): a heavy hard game
 * (every empty cell pencilled with four notes, then filled, with erases, undos
 * and hints) saved the way a naive recorder would (one event, one queue save
 * per entry) and the way the screen does (an `entries` event per 32 entries
 * through the GameRecorder), over the real GameEventClient → EventStore →
 * AsyncStorage mock, with an idle moment between taps (the worst case for the
 * naive path: nothing coalesces).
 *
 * Counts are hard budgets — the fixture is deterministic. The numbers are
 * printed and recorded in docs/games/sudoku.md ("Replay recording"). Run it on
 * its own with
 *   cd frontend && npx jest src/game/sudoku/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { loadPuzzle, selectCell, toggleNotesMode } from "../engine";
import {
  ENTRIES_PER_CHUNK,
  MAX_REPLAY_ROWS,
  applyRecorded,
  createEntryLog,
  unitOfEntry,
  type EntryTuple,
} from "../replay";
import type { CellValue } from "../types";

/** The heavy game's entries, each paired with the state change they were built from. */
function heavyGame(): EntryTuple[] {
  let s = loadPuzzle("hard", "classic", () => 0.77);
  const out: EntryTuple[] = [];
  const play = (action: Parameters<typeof applyRecorded>[1]) => {
    const r = applyRecorded(s, action);
    if (!r) return;
    s = r.next;
    out.push(r.entry);
  };
  const empties = [...s.puzzle].flatMap((c, i) => (c === "0" ? [i] : []));
  for (const cell of empties) {
    s = selectCell(s, Math.floor(cell / 9), cell % 9);
    const sol = Number(s.solution[cell]);
    // four notes, written in pencil mode
    s = toggleNotesMode(s);
    for (const d of [sol, (sol % 9) + 1, ((sol + 1) % 9) + 1, ((sol + 2) % 9) + 1]) {
      play({ kind: "digit", digit: d as CellValue });
    }
    s = toggleNotesMode(s);
    play({ kind: "digit", digit: sol as CellValue });
    // every 5th cell is changed its mind about
    if (cell % 5 === 0) {
      play({ kind: "erase" });
      play({ kind: "digit", digit: sol as CellValue });
    }
    if (cell % 7 === 0) {
      play({ kind: "undo" });
      play({ kind: "digit", digit: sol as CellValue });
    }
  }
  return out;
}

interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  /** AsyncStorage writes of any key while the game was played. */
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of every event's `data`. */
  recordedBytes: number;
}

async function newClient() {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame("sudoku");
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  return { store, client, gameId };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The naive recorder: one `entries`-shaped event, one queue save, per entry. */
async function playNaive(all: readonly EntryTuple[]): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let recordedBytes = 0;
  let n = 0;
  for (const entry of all) {
    const data = { v: 1, unit: n + 1, t_ms: n * 1500, i: n, e: [entry] };
    n += 1;
    recordedBytes += JSON.stringify(data).length;
    client.enqueueEvent(gameId, { type: "entries", data });
    await settle();
  }
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((sum, [, v]) => sum + v.length, 0),
    events: all.length,
    recordedBytes,
  };
}

/** The screen: chunks through the GameRecorder, saved at idle after each chunk. */
async function playChunked(all: readonly EntryTuple[]): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let events = 0;
  let recordedBytes = 0;
  const tasks: (() => void)[] = [];
  let t = 0;
  const recorder = new GameRecorder<"sudoku">({
    gameType: "sudoku",
    now: () => (t += 1500),
    sink: {
      canAccept: () => true,
      enqueueMany: (batch: readonly EnqueueEventInput[]) => {
        for (const e of batch) {
          events += 1;
          recordedBytes += JSON.stringify(e.data ?? {}).length;
        }
        client.enqueueEvents(gameId, batch);
        return true;
      },
    },
    schedule: (task) => tasks.push(task),
  });
  recorder.startSession();
  const log = createEntryLog((first, e) => {
    recorder.beginUnit(unitOfEntry(first));
    recorder.record("entries", { i: first, e });
    recorder.closeUnit();
  });
  for (const entry of all) {
    log.push(entry);
    while (tasks.length > 0) tasks.shift()?.(); // the idle moment
    await settle();
  }
  log.flush();
  recorder.endSession();
  await settle();
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((sum, [, v]) => sum + v.length, 0),
    events,
    recordedBytes,
  };
}

/** Postgres `jsonb::text` adds a space after each `,` and `:` (our data has no such characters in strings). */
const jsonbBytes = (data: unknown) => JSON.stringify(data).replace(/([,:])/g, "$1 ").length;
const ROW_OVERHEAD_BYTES = 200; // backend/games/replay_caps.py

/** What the server stores for a game of `n` entries recorded in chunks: jsonb plus 200 B a row. */
function storedBytes(entries: readonly EntryTuple[]): { rows: number; bytes: number } {
  let bytes = 0;
  let rows = 0;
  for (let first = 0; first < entries.length; first += ENTRIES_PER_CHUNK) {
    const e = entries.slice(first, first + ENTRIES_PER_CHUNK);
    const data = { v: 1, unit: unitOfEntry(first), t_ms: 3_600_000, i: first, e };
    bytes += jsonbBytes(data) + ROW_OVERHEAD_BYTES;
    rows += 1;
  }
  return { rows, bytes };
}

describe("Sudoku replay recording benchmark (#3288)", () => {
  it("flush spam (a flush after every entry) is bounded by the row limit: rows and stored bytes", () => {
    const rows: { first: number; entries: EntryTuple[] }[] = [];
    const log = createEntryLog((first, entries) => rows.push({ first, entries }));
    const heavy = heavyGame();
    for (let n = 0; n < 2_000; n++) {
      log.push(heavy[n % heavy.length]!);
      log.flush(); // an app that leaves and returns after every tap
    }
    expect(rows).toHaveLength(MAX_REPLAY_ROWS);
    expect(log.count).toBe(2_000);
    const stored = rows.reduce(
      (sum, r) =>
        sum +
        jsonbBytes({
          v: 1,
          unit: unitOfEntry(r.first),
          t_ms: 3_600_000,
          i: r.first,
          e: r.entries,
        }) +
        ROW_OVERHEAD_BYTES,
      0
    );
    process.stdout.write(`[bench #3288] flush spam: ${rows.length} rows, ${stored} B stored\n`);
    expect(stored).toBeLessThan(40 * 1024 * 0.4); // tiny rows: about 280 B each
    // and the worst the limit allows: every row a full worst-case chunk (747 B) is under the 40 KB plan
    const worstRow = jsonbBytes({
      v: 1,
      unit: 99_999,
      t_ms: 2 ** 31 - 1,
      i: 2 ** 31 - 1,
      e: Array.from({ length: ENTRIES_PER_CHUNK }, () => [0, 80, 9, 1]),
    });
    expect(MAX_REPLAY_ROWS * (worstRow + ROW_OVERHEAD_BYTES)).toBeLessThan(40 * 1024);
    expect(MAX_REPLAY_ROWS).toBeLessThan(500 / 4); // well under the server's 500-event cap
  });

  it("stored bytes per game (jsonb + 200 B a row) stay far under the epic's 40 KB, typical and long", () => {
    const heavy = heavyGame(); // 315 entries
    const typical = storedBytes(heavy.slice(0, 70));
    const long = storedBytes(heavy);
    // a long game: 1,000 entries (three times the heavy one)
    const marathon = storedBytes(Array.from({ length: 1_000 }, (_, k) => heavy[k % heavy.length]!));
    process.stdout.write(
      `[bench #3288] stored: typical ${typical.rows} rows ${typical.bytes} B, heavy ${long.rows} rows ${long.bytes} B, 1,000 entries ${marathon.rows} rows ${marathon.bytes} B\n`
    );
    expect(typical.bytes).toBeLessThan(2 * 1024);
    expect(long.bytes).toBeLessThan(8 * 1024);
    expect(marathon.bytes).toBeLessThan((40 * 1024) / 2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a heavy hard game: a handful of saves, far fewer writes and bytes than one event per entry", async () => {
    const all = heavyGame();
    expect(all.length).toBeGreaterThan(250);
    const naive = await playNaive(all);
    const chunked = await playChunked(all);
    const chunks = Math.ceil(all.length / ENTRIES_PER_CHUNK);
    process.stdout.write(
      `[bench #3288] sudoku, ${all.length} entries: naive ${naive.saves} saves, ${naive.storageWrites} storage writes, ` +
        `${naive.storageBytes} B written, ${naive.events} events / ${naive.recordedBytes} B recorded; ` +
        `chunked ${chunked.saves} saves, ${chunked.storageWrites} storage writes, ${chunked.storageBytes} B written, ` +
        `${chunked.events} events / ${chunked.recordedBytes} B recorded\n`
    );

    // Structural counts: one save per chunk, one event per chunk.
    expect(naive.saves).toBe(all.length);
    expect(chunked.saves).toBe(chunks);
    expect(chunked.events).toBe(chunks);

    // Far less work than a save per entry (by about the chunk size).
    expect(chunked.saves).toBeLessThan(naive.saves / (ENTRIES_PER_CHUNK - 1));
    expect(chunked.storageWrites).toBeLessThan(naive.storageWrites / 10);
    expect(chunked.storageBytes).toBeLessThan(naive.storageBytes / 10);
    expect(chunked.recordedBytes).toBeLessThan(naive.recordedBytes / 1.5);

    // A game this heavy stays under 4 KB of recorded JSON, and inside the session cap.
    expect(chunked.recordedBytes).toBeLessThan(4 * 1024);
    expect(chunked.recordedBytes).toBeLessThan(recordingConfigFor("sudoku").sessionMaxBytes);
  }, 120_000);
});
