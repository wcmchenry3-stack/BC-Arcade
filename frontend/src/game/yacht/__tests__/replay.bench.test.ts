/**
 * Yacht replay recording benchmark (#3282, epic #3273): a 13-round vs-computer
 * game saved the way the screen did before (the human's `roll` per roll and
 * `score` per score, one queue save each, the computer not recorded) and the
 * way it does now (a `turn_completed` per player per round through the
 * GameRecorder, saved at an idle moment after each turn), over the real
 * GameEventClient → EventStore → AsyncStorage mock, with an idle moment
 * between events (the worst case for the old path: nothing coalesces).
 *
 * Counts are hard budgets — the fixture is seeded and deterministic. The
 * numbers are printed and recorded in docs/games/yacht.md ("Replay
 * recording"). Run it on its own with
 *   cd frontend && npx jest src/game/yacht/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { newGame, possibleScores, roll, score, setRng, toggleHold } from "../engine";
import { emitTurn, type TurnData, type TurnSink } from "../replay";
import {
  HUMAN_SCRIPT,
  playGame,
  recorderWithSink,
  rebuild,
  asTurnSink,
} from "./helpers/replayGame";

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
  const gameId = client.startGame("yacht");
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  return { store, client, gameId };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The screen before #3282: the human's `roll` per roll and `score` per score, one save each. */
async function playBefore(): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let events = 0;
  let recordedBytes = 0;
  const send = async (type: string, data: Record<string, unknown>) => {
    events += 1;
    recordedBytes += JSON.stringify(data).length;
    client.enqueueEvent(gameId, { type, data });
    await settle();
  };
  setRng(() => 0.5);
  let state = newGame();
  for (const turn of HUMAN_SCRIPT) {
    let s = state;
    for (let i = 0; i < turn.rolls.length; i += 1) {
      const step = turn.rolls[i]!;
      s = roll(s, s.held, { dice: step.dice });
      await send("roll", {
        held: [...s.held],
        dice: [...s.dice],
        rolls_used_after: s.rolls_used,
      });
      if (step.holdNext && i < turn.rolls.length - 1) {
        for (const die of step.holdNext) s = toggleHold(s, die);
      }
    }
    const alternatives = possibleScores(s);
    const next = score(s, turn.category);
    await send("score", {
      category: turn.category,
      value: next.scores[turn.category] ?? 0,
      is_joker: next.yacht_bonus_count > s.yacht_bonus_count,
      available_alternatives: alternatives,
    });
    state = next;
  }
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events,
    recordedBytes,
  };
}

/** The screen now: `turn_completed` per turn through the GameRecorder, saved at idle after each. */
async function playAfter(): Promise<Measured> {
  // The turns of a seeded, scripted vs game, collected without a recorder.
  const collected: TurnData[] = [];
  const collector: TurnSink = {
    beginUnit: () => 0,
    record: (_type, data) => {
      collected.push(data as unknown as TurnData);
    },
    closeUnit: () => undefined,
  };
  playGame(collector, { seed: 11, difficulty: "hard" });
  expect(collected).toHaveLength(26);

  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let events = 0;
  let recordedBytes = 0;
  const tasks: (() => void)[] = [];
  const { recorder } = recorderWithSink({
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
  const sink = asTurnSink(recorder);
  for (let i = 0; i < collected.length; i += 1) {
    emitTurn(sink, collected[i]!, (i % 2) as 0 | 1, true);
    while (tasks.length > 0) tasks.shift()?.(); // the idle moment
    await settle();
  }
  recorder.endSession();
  await settle();
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events,
    recordedBytes,
  };
}

describe("Yacht replay recording benchmark (#3282)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
    setRng(Math.random);
  });

  it("a 13-round vs game: one save per turn, both players, bounded bytes", async () => {
    const before = await playBefore();
    const after = await playAfter();
    process.stdout.write(
      `[bench #3282] yacht 13-round game: before ${before.saves} saves, ${before.storageWrites} storage writes, ` +
        `${before.storageBytes} B written, ${before.events} events / ${before.recordedBytes} B recorded (human only); ` +
        `after ${after.saves} saves, ${after.storageWrites} storage writes, ${after.storageBytes} B written, ` +
        `${after.events} events / ${after.recordedBytes} B recorded (both players)\n`
    );

    // One save per turn, both players: 26 for a 13-round vs game.
    expect(after.saves).toBe(26);
    expect(after.events).toBe(26);
    // The human alone took one save per roll and per score; the computer none.
    expect(before.saves).toBe(before.events);
    expect(before.events).toBeGreaterThan(26);
    // Both players now cost fewer saves and storage writes than the human alone did.
    expect(after.saves).toBeLessThan(before.saves);
    expect(after.storageWrites).toBeLessThan(before.storageWrites);
    // And the recording stays inside the game's session cap.
    expect(after.recordedBytes).toBeLessThan(recordingConfigFor("yacht").sessionMaxBytes);
  }, 120_000);

  it("what the bench recorded rebuilds the game", () => {
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    playGame(asTurnSink(recorder), { seed: 11, difficulty: "hard" });
    recorder.endSession();
    expect(rebuild(saved).problems).toEqual([]);
  });
});
