/**
 * 2048 replay recording benchmark (#3286, epic #3273): a 2,000-swipe game
 * saved the way the screen did before (one `move` event, one queue save per
 * swipe) and the way it does now (a `moves` event per 25 swipes through the
 * GameRecorder), over the real GameEventClient → EventStore → AsyncStorage
 * mock, with an idle moment between swipes (the worst case for the old path:
 * nothing coalesces).
 *
 * Counts are hard budgets — the fixture is seeded and deterministic. The
 * numbers are printed and recorded in docs/games/twenty48.md ("Replay
 * recording"). Run it on its own with
 *   cd frontend && npx jest src/game/twenty48/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { createSeededRng, move, newGame, setRng, type Direction } from "../engine";
import { MOVES_PER_CHUNK, createMoveLog, moveTuple } from "../replay";
import type { Twenty48State } from "../types";

const SWIPES = 2_000;
const ORDER: readonly Direction[] = ["left", "up", "right", "down"];

interface Swipe {
  readonly direction: Direction;
  readonly after: Twenty48State;
}

/** 2,000 seeded swipes: games are replayed from new seeds when one ends. */
function swipes(): Swipe[] {
  const out: Swipe[] = [];
  for (let seed = 1; out.length < SWIPES; seed += 1) {
    setRng(createSeededRng(seed));
    let state = newGame();
    for (let turn = 0; out.length < SWIPES && !state.game_over; turn += 1) {
      let moved = false;
      for (let k = 0; k < ORDER.length && !moved; k += 1) {
        const direction = ORDER[(turn + k) % ORDER.length]!;
        try {
          state = move(state, direction);
          out.push({ direction, after: state });
          moved = true;
        } catch {
          // no effect
        }
      }
      if (!moved) break;
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
  const gameId = client.startGame("twenty48");
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  return { store, client, gameId };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The screen before #3286: one `move` event, one queue save, per swipe. */
async function playBefore(all: readonly Swipe[]): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let recordedBytes = 0;
  for (const { direction, after } of all) {
    const data = {
      direction,
      score_delta: after.scoreDelta,
      score_after: after.score,
      highest_tile_after: Math.max(...after.board.flat()),
      is_game_over: after.game_over,
      has_won: after.has_won,
    };
    recordedBytes += JSON.stringify(data).length;
    client.enqueueEvent(gameId, { type: "move", data });
    await settle();
  }
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events: all.length,
    recordedBytes,
  };
}

/** The screen now: `moves` chunks through the GameRecorder, saved at idle after each chunk. */
async function playAfter(all: readonly Swipe[]): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let events = 0;
  let recordedBytes = 0;
  const tasks: (() => void)[] = [];
  const recorder = new GameRecorder<"twenty48">({
    gameType: "twenty48",
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
  // 2,000 swipes of several seeded games in one stream: without the per-game limits.
  const log = createMoveLog(
    (m) => {
      recorder.beginUnit();
      recorder.record("moves", { m });
      recorder.closeUnit();
    },
    MOVES_PER_CHUNK,
    { moves: Infinity, rows: Infinity }
  );
  for (const { direction, after } of all) {
    const tuple = moveTuple(direction, after);
    if (tuple) log.push(tuple);
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
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events,
    recordedBytes,
  };
}

describe("2048 replay recording benchmark (#3286)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a 2,000-swipe game: far fewer saves, writes and bytes than one event per swipe", async () => {
    const all = swipes();
    expect(all).toHaveLength(SWIPES);
    const before = await playBefore(all);
    const after = await playAfter(all);
    const chunks = Math.ceil(SWIPES / MOVES_PER_CHUNK);
    process.stdout.write(
      `[bench #3286] twenty48, ${SWIPES} swipes: before ${before.saves} saves, ${before.storageWrites} storage writes, ` +
        `${before.storageBytes} B written, ${before.events} events / ${before.recordedBytes} B recorded; ` +
        `after ${after.saves} saves, ${after.storageWrites} storage writes, ${after.storageBytes} B written, ` +
        `${after.events} events / ${after.recordedBytes} B recorded\n`
    );

    // Structural counts.
    expect(before.saves).toBe(SWIPES);
    expect(after.saves).toBe(chunks);
    expect(after.events).toBe(chunks);

    // Fewer saves per game than today (the AC), by about the chunk size.
    expect(after.saves).toBeLessThan(before.saves / (MOVES_PER_CHUNK - 1));
    expect(after.storageWrites).toBeLessThan(before.storageWrites / 10);
    expect(after.storageBytes).toBeLessThan(before.storageBytes / 10);
    expect(after.recordedBytes).toBeLessThan(before.recordedBytes / 4);

    // And the recording stays inside the game's session cap.
    expect(after.recordedBytes).toBeLessThan(recordingConfigFor("twenty48").sessionMaxBytes);
  }, 120_000);
});
