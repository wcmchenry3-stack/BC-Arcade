/**
 * Daily Word replay recording benchmark (#3287, #3368, epic #3273): one game
 * (a typical 4-guess win with refusals, the worst case of six accented guesses
 * with 99 refusals, and a Hindi game) recorded as its one event through the
 * GameRecorder (`on_session_end`) over the real GameEventClient → EventStore →
 * AsyncStorage mock, with an idle moment after the event. Counts are hard
 * budgets; the numbers are printed and recorded in docs/games/daily_word.md
 * ("Replay recording"). Run it on its own with
 *   cd frontend && npx jest src/game/daily_word/__tests__/replay.bench.test.ts
 *
 * The kill switch off: the recorder touches neither the store nor storage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { applyServerResult, initialState, setCurrentRowLetter, tilesWithDisplay } from "../engine";
import { scoreGuess } from "../localScoring";
import { createGuessReplay, rebuild } from "../replay";

const ROW_OVERHEAD_BYTES = 200; // backend/games/replay_caps.py
const PLAN_BYTES_PER_GAME = 40 * 1024; // the 40 KB a fully recorded game is planned at
const settle = () => new Promise((r) => setTimeout(r, 0));

interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of the event's `data`, envelope included. */
  recordedBytes: number;
  /** Server storage: JSON bytes + ROW_OVERHEAD_BYTES (200) per event. */
  storedBytes: number;
  recorded: { type: string; data: Record<string, unknown> }[];
}

interface Script {
  puzzle: { puzzle_id: string; word_length: number; language: string };
  answer: string;
  guesses: { g: string; d?: string }[];
  refusals: number;
}

const TYPICAL: Script = {
  puzzle: { puzzle_id: "p1", word_length: 5, language: "en" },
  answer: "slate",
  guesses: [{ g: "crane" }, { g: "least" }, { g: "stale" }, { g: "slate" }],
  refusals: 2,
};

const WORST: Script = {
  puzzle: { puzzle_id: "p2", word_length: 5, language: "fr" },
  answer: "annee",
  guesses: [
    { g: "aerer", d: "aérer" },
    { g: "allee", d: "allée" },
    { g: "aerer", d: "aérer" },
    { g: "allee", d: "allée" },
    { g: "aerer", d: "aérer" },
    { g: "allee", d: "allée" },
  ],
  refusals: 150,
};

const HINDI: Script = {
  puzzle: { puzzle_id: "p3", word_length: 5, language: "hi" },
  answer: "अंकुर",
  guesses: [{ g: "अंजाम" }, { g: "अंकुश" }, { g: "अंकुर" }],
  refusals: 1,
};

async function play(script: Script, enabled = true): Promise<Measured> {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame("daily_word");
  client.markStarted(gameId);
  await settle();

  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();

  const out: Measured = {
    saves: 0,
    storageWrites: 0,
    storageBytes: 0,
    events: 0,
    recordedBytes: 0,
    storedBytes: 0,
    recorded: [],
  };
  const tasks: (() => void)[] = [];
  const rec = new GameRecorder({
    gameType: "daily_word",
    policy: "on_session_end",
    enabled: () => enabled,
    schedule: (task) => tasks.push(task),
    sink: {
      canAccept: () => true,
      enqueueMany: (batch: readonly EnqueueEventInput[]) => {
        for (const e of batch) {
          const size = JSON.stringify(e.data ?? {}).length;
          out.events += 1;
          out.recordedBytes += size;
          out.storedBytes += size + ROW_OVERHEAD_BYTES;
          out.recorded.push({ type: e.type, data: e.data as Record<string, unknown> });
        }
        client.enqueueEvents(gameId, batch);
        return true;
      },
    },
  });
  rec.startSession();
  const replay = createGuessReplay({
    beginUnit: (n) => rec.beginUnit(n),
    record: (type, data) => rec.record(type, data),
    closeUnit: () => rec.closeUnit(),
  });

  // The game as the screen plays it: refusals are counted, guesses fill the board, the end records.
  const { puzzle_id: id, word_length: length, language } = script.puzzle;
  for (let i = 0; i < script.refusals; i += 1) replay.refused(id);
  let board = initialState(id, length, language);
  for (const guess of script.guesses) {
    for (const ch of Array.from(guess.g)) board = setCurrentRowLetter(board, ch);
    board = applyServerResult(board, tilesWithDisplay(scoreGuess(script.answer, guess.g), guess.d));
  }
  replay.finish(board);
  while (tasks.length > 0) tasks.shift()?.(); // the idle moment: measuring only
  // Nothing was saved yet: the whole game goes in the call that ends the session.
  const savesBeforeEnd = saveEvent.mock.calls.length + saveMany.mock.calls.length;
  rec.endSession();
  await settle();
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  out.saves = saveEvent.mock.calls.length + saveMany.mock.calls.length;
  expect(out.saves - savesBeforeEnd).toBe(out.saves);
  out.storageWrites = writes.length;
  out.storageBytes = writes.reduce((n, [, v]) => n + v.length, 0);
  return out;
}

describe("Daily Word replay recording benchmark (#3287, #3368)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a typical game: one event, one save, about 130 B (330 B stored)", async () => {
    const m = await play(TYPICAL);
    process.stdout.write(
      `[bench #3287] daily word typical (4 guesses, 2 refusals): ${m.saves} save, ${m.storageWrites} storage writes, ` +
        `${m.storageBytes} B written, ${m.events} event / ${m.recordedBytes} B recorded, ${m.storedBytes} B stored\n`
    );
    expect(m.events).toBe(1);
    expect(m.saves).toBe(1);
    // the events write and the pending-games counter write
    expect(m.storageWrites).toBeLessThanOrEqual(2);
    expect(m.recordedBytes).toBeLessThan(200);
    expect(m.storedBytes).toBeLessThan(400);
    expect(m.storedBytes).toBeLessThan(PLAN_BYTES_PER_GAME / 100);
    expect(m.recorded[0]!.type).toBe("guess_submitted");
  }, 60_000);

  it("the worst case (six accented guesses, 99 refusals) stays near 500 B stored and inside the caps", async () => {
    const m = await play(WORST);
    process.stdout.write(
      `[bench #3287] daily word worst (6 accented guesses, refusals capped at 99): ${m.saves} save, ${m.storageWrites} storage writes, ` +
        `${m.storageBytes} B written, ${m.events} event / ${m.recordedBytes} B recorded, ${m.storedBytes} B stored\n`
    );
    expect(m.events).toBe(1);
    expect(m.saves).toBe(1);
    expect(m.storageWrites).toBeLessThanOrEqual(2);
    expect(m.recordedBytes).toBeLessThan(recordingConfigFor("daily_word").sessionMaxBytes);
    expect(m.recordedBytes).toBeLessThan(260);
    expect(m.storedBytes).toBeLessThanOrEqual(500);
    expect(m.recorded[0]!.data.rj).toBe(99);
  }, 60_000);

  it("a Hindi game is the same size class", async () => {
    const m = await play(HINDI);
    expect(m.events).toBe(1);
    expect(m.storedBytes).toBeLessThanOrEqual(500);
  }, 60_000);

  it("what the bench recorded rebuilds the game", async () => {
    const m = await play(TYPICAL);
    const rebuilt = rebuild(m.recorded, TYPICAL.puzzle);
    expect(rebuilt.problems).toEqual([]);
    expect([rebuilt.state.current_row, rebuilt.state.won, rebuilt.refusals]).toEqual([4, true, 2]);
  }, 60_000);

  it("with the kill switch off the recorder does no work: no store call, no storage write", async () => {
    const m = await play(TYPICAL, false);
    expect(m.events).toBe(0);
    expect(m.saves).toBe(0);
    expect(m.storageWrites).toBe(0);
  }, 60_000);
});
