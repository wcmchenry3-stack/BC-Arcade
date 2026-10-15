/**
 * Daily Word replay recording benchmark (#3287, epic #3273): a typical game
 * (a refusal and four guesses, the last one the win) and the worst case (the
 * refusal budget spent and six guesses) saved through the GameRecorder over the
 * real GameEventClient → EventStore → AsyncStorage mock, with an idle moment
 * between attempts (the worst case: nothing coalesces). Counts are hard budgets;
 * the numbers are printed and recorded in docs/games/daily_word.md ("Replay
 * recording"). Run it on its own with
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
import { scoreGuess } from "../localScoring";
import { MAX_RECORDED_REJECTIONS, createGuessReplay, rebuild } from "../replay";

const ANSWER = "slate";
const settle = () => new Promise((r) => setTimeout(r, 0));

interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of every event's `data`, envelope included. */
  recordedBytes: number;
  largest: number;
  recorded: { type: string; data: Record<string, unknown> }[];
}

type Attempt = { word: string; row: number; refused?: "nw" | "dup" };

async function play(attempts: Attempt[], enabled = true): Promise<Measured> {
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
    largest: 0,
    recorded: [],
  };
  const tasks: (() => void)[] = [];
  const rec = new GameRecorder({
    gameType: "daily_word",
    enabled: () => enabled,
    schedule: (task) => tasks.push(task),
    sink: {
      canAccept: () => true,
      enqueueMany: (batch: readonly EnqueueEventInput[]) => {
        for (const e of batch) {
          const size = JSON.stringify(e.data ?? {}).length;
          out.events += 1;
          out.recordedBytes += size;
          out.largest = Math.max(out.largest, size);
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
  for (const a of attempts) {
    if (a.refused) replay.rejected("p1", a.row, a.word, a.refused);
    else replay.accepted(a.row, scoreGuess(ANSWER, a.word));
    while (tasks.length > 0) tasks.shift()?.(); // the idle moment
    await settle();
  }
  rec.endSession();
  await settle();
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  out.saves = saveEvent.mock.calls.length + saveMany.mock.calls.length;
  out.storageWrites = writes.length;
  out.storageBytes = writes.reduce((n, [, v]) => n + v.length, 0);
  return out;
}

const TYPICAL: Attempt[] = [
  { word: "zzzzz", row: 1, refused: "nw" },
  { word: "crane", row: 1 },
  { word: "least", row: 2 },
  { word: "stale", row: 3 },
  { word: ANSWER, row: 4 },
];

const WORST: Attempt[] = [
  ...Array.from({ length: MAX_RECORDED_REJECTIONS }, (): Attempt => ({
    word: "zzzzz",
    row: 1,
    refused: "nw",
  })),
  ...["crane", "least", "stale", "plate", "slant", "slats"].map((word, i): Attempt => ({
    word,
    row: i + 1,
  })),
];

describe("Daily Word replay recording benchmark (#3287)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a typical game: one save per attempt, a few hundred bytes", async () => {
    const m = await play(TYPICAL);
    process.stdout.write(
      `[bench #3287] daily word typical (1 refusal + 4 guesses): ${m.saves} saves, ${m.storageWrites} storage writes, ` +
        `${m.storageBytes} B written, ${m.events} events / ${m.recordedBytes} B recorded, largest ${m.largest} B\n`
    );
    expect(m.events).toBe(5);
    expect(m.saves).toBe(5);
    expect(m.recordedBytes).toBeLessThan(500);
    expect(m.recorded.map((e) => e.type)).toEqual(Array(5).fill("guess_submitted"));
  }, 60_000);

  it("the worst case (refusal budget spent, six guesses) stays inside the caps", async () => {
    const m = await play(WORST);
    process.stdout.write(
      `[bench #3287] daily word worst (${MAX_RECORDED_REJECTIONS} refusals + 6 guesses): ${m.saves} saves, ${m.storageWrites} storage writes, ` +
        `${m.storageBytes} B written, ${m.events} events / ${m.recordedBytes} B recorded, largest ${m.largest} B\n`
    );
    expect(m.events).toBe(MAX_RECORDED_REJECTIONS + 6);
    expect(m.saves).toBe(MAX_RECORDED_REJECTIONS + 6);
    expect(m.recordedBytes).toBeLessThan(recordingConfigFor("daily_word").sessionMaxBytes);
    expect(m.recordedBytes).toBeLessThan(1500);
    expect(m.largest).toBeLessThan(100);
  }, 60_000);

  it("what the bench recorded rebuilds the game", async () => {
    const m = await play(TYPICAL);
    const rebuilt = rebuild(m.recorded, { puzzle_id: "p1", word_length: 5, language: "en" });
    expect(rebuilt.problems).toEqual([]);
    expect([rebuilt.state.current_row, rebuilt.state.won]).toEqual([4, true]);
  }, 60_000);

  it("with the kill switch off the recorder does no work: no store call, no storage write", async () => {
    const m = await play(TYPICAL, false);
    expect(m.events).toBe(0);
    expect(m.saves).toBe(0);
    expect(m.storageWrites).toBe(0);
  }, 60_000);
});
