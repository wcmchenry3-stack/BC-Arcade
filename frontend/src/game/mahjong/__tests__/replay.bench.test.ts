/**
 * Mahjong replay recording benchmark (#3285, epic #3273): a scripted, seeded
 * Turtle game played to a cleared board (matches, undos, hints and three
 * shuffles), recorded through the GameRecorder over the real
 * GameEventClient -> EventStore -> AsyncStorage mock, with an idle moment
 * between steps, against the naive alternative of one `moves` event (and one
 * queue save) per action. Mahjong sent no gameplay event before this story, so
 * the naive path is what the chunking is measured against, not an old build.
 *
 * Counts are hard budgets — the fixture is seeded and deterministic. The
 * numbers are printed and recorded in docs/games/mahjong.md ("Replay
 * recording"). Run it on its own with
 *   cd frontend && npx jest src/game/mahjong/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { createGame, createSeededRng, setRng, shuffleBoard } from "../engine";
import { getLayout } from "../layouts/registry";
import { ACTIONS_PER_CHUNK, type MahjongReplay } from "../replay";
import type { MahjongState, SlotTile } from "../types";
import { playScripted, playScriptedWithIdle, wiredReplay } from "./helpers/replayGame";

const SCRIPT = { layout: "turtle", seed: 42 } as const;

/** The epic's plan: about 40 KB a game uploaded (#3273). */
const EPIC_GAME_BUDGET_BYTES = 40 * 1024;

const tileAt = (id: number): SlotTile => ({
  id,
  suit: "circles",
  rank: 1,
  faceId: 17,
  col: id * 4,
  row: 0,
  layer: 0,
});

/** A game recorded by `play`, with the stored size of what it saved. */
async function recordLong(
  play: (replay: MahjongReplay, shuffled: MahjongState) => void
): Promise<{ events: number; recordedBytes: number; serverBytes: number }> {
  setRng(createSeededRng(11));
  const shuffled = shuffleBoard(createGame(getLayout("turtle"), 5));
  const { replay, recorder, saved } = wiredReplay();
  play(replay, shuffled);
  replay.flush();
  recorder.endSession();
  return {
    events: saved.length,
    recordedBytes: saved.reduce((n, e) => n + JSON.stringify(e.data ?? {}).length, 0),
    serverBytes: saved.reduce((n, e) => n + jsonbLength(e.data ?? {}) + ROW_OVERHEAD_BYTES, 0),
  };
}

/** A game's rows as the server stores them: `jsonb::text` (", " and ": ") plus 200 B of row overhead. */
const ROW_OVERHEAD_BYTES = 200;
function jsonbLength(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      2 + value.reduce<number>((n, v) => n + jsonbLength(v), 0) + 2 * Math.max(0, value.length - 1)
    );
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    return (
      2 +
      entries.reduce((n, [k, v]) => n + JSON.stringify(k).length + 2 + jsonbLength(v), 0) +
      2 * Math.max(0, entries.length - 1)
    );
  }
  return JSON.stringify(value).length;
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
  /** What the server stores for them: jsonb text plus row overhead. */
  serverBytes: number;
}

async function newClient() {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame("mahjong");
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  return { store, client, gameId };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function measure(
  store: EventStore,
  events: readonly { data?: Record<string, unknown> }[]
): Measured {
  const setItem = AsyncStorage.setItem as jest.Mock;
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: 0,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events: events.length,
    recordedBytes: events.reduce((n, e) => n + JSON.stringify(e.data ?? {}).length, 0),
    serverBytes: events.reduce((n, e) => n + jsonbLength(e.data ?? {}) + ROW_OVERHEAD_BYTES, 0),
  };
}

/** The game's actions, one event and one queue save each. */
async function playNaive(entries: readonly unknown[]): Promise<Measured> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  (AsyncStorage.setItem as jest.Mock).mockClear();
  const events: { data: Record<string, unknown> }[] = [];
  let unit = 0;
  for (const entry of entries) {
    unit += 1;
    const data = { v: 1, unit, t_ms: unit * 3000, m: [entry] };
    events.push({ data });
    client.enqueueEvent(gameId, { type: "moves", data });
    await settle();
  }
  return {
    ...measure(store, events),
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
  };
}

/** The game recorded the way the screen records it: chunks through the GameRecorder, saved at idle. */
async function playChunked(): Promise<{ measured: Measured; entries: unknown[] }> {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  (AsyncStorage.setItem as jest.Mock).mockClear();
  const events: { data: Record<string, unknown> }[] = [];
  const game = await playScriptedWithIdle(
    {
      ...SCRIPT,
      forward: (batch) => {
        for (const e of batch) events.push({ data: e.data ?? {} });
        client.enqueueEvents(gameId, batch);
      },
    },
    settle
  );
  await settle();
  await settle();
  return {
    measured: {
      ...measure(store, events),
      saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    },
    entries: game.entries,
  };
}

describe("Mahjong replay recording benchmark (#3285)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
    setRng(Math.random);
  });

  it("a cleared game: a few saves and a few KB, against one save per action", async () => {
    const { measured: after, entries } = await playChunked();
    const before = await playNaive(entries);
    const chunks = Math.ceil(entries.length / ACTIONS_PER_CHUNK);
    process.stdout.write(
      `[bench #3285] mahjong, ${entries.length} actions (cleared turtle): ` +
        `one event per action ${before.saves} saves, ${before.storageWrites} storage writes, ` +
        `${before.storageBytes} B written, ${before.events} events / ${before.recordedBytes} B recorded / ` +
        `${before.serverBytes} B stored; ` +
        `chunked ${after.saves} saves, ${after.storageWrites} storage writes, ${after.storageBytes} B written, ` +
        `${after.events} events / ${after.recordedBytes} B recorded / ${after.serverBytes} B stored\n`
    );

    // Structural counts.
    expect(entries.length).toBeGreaterThan(70);
    expect(before.saves).toBe(entries.length);
    expect(after.saves).toBe(chunks);
    expect(after.events).toBe(chunks);

    // One storage write per save, a handful per game.
    expect(after.storageWrites).toBeLessThan(before.storageWrites / (ACTIONS_PER_CHUNK / 2));
    expect(after.storageBytes).toBeLessThan(before.storageBytes / 5);
    expect(after.serverBytes).toBeLessThan(before.serverBytes / 4);

    // Budgets: the session cap on the device, and the epic's 40 KB a game stored
    // (jsonb text + 200 B a row), absolute, for a typical game and a long one.
    expect(after.recordedBytes).toBeLessThan(recordingConfigFor("mahjong").sessionMaxBytes);
    expect(after.serverBytes).toBeLessThan(EPIC_GAME_BUDGET_BYTES / 4);
  }, 120_000);

  it("stays under the epic's 40 KB a game, stored, for a long game and for a game of shuffles", async () => {
    // A long game: 72 pairs with 60 undos and 60 hints, and the three shuffles.
    const long = await recordLong((replay, after) => {
      for (let i = 0; i < 72; i += 1) {
        replay.match([tileAt(2 * i), tileAt(2 * i + 1)]);
        if (i % 6 === 0) {
          for (let k = 0; k < 5; k += 1) {
            replay.undo();
            replay.hint();
          }
        }
        if (i % 24 === 0) replay.shuffle(after);
      }
    });
    // A game of full-board shuffles, undone and redone, until the session cap ends it.
    const spam = await recordLong((replay, after) => {
      for (let i = 0; i < 200; i += 1) replay.shuffle(after);
    });
    process.stdout.write(
      `[bench #3285] stored per game: long ${long.events} events / ${long.serverBytes} B, ` +
        `shuffle spam ${spam.events} events / ${spam.serverBytes} B (budget ${EPIC_GAME_BUDGET_BYTES} B)\n`
    );
    expect(long.serverBytes).toBeLessThan(EPIC_GAME_BUDGET_BYTES / 2);
    expect(spam.serverBytes).toBeLessThan(EPIC_GAME_BUDGET_BYTES);
    expect(spam.recordedBytes).toBeLessThanOrEqual(recordingConfigFor("mahjong").sessionMaxBytes);
  }, 120_000);

  it("no gameplay event reaches the queue while the game is being played, except at a chunk's close", async () => {
    const { store, client, gameId } = await newClient();
    const saveEvent = jest.spyOn(store, "enqueueEvent");
    const saveMany = jest.spyOn(store, "enqueueMany");
    let steps = 0;
    const saves: number[] = [];
    let forwarded = 0;
    await playScriptedWithIdle(
      {
        ...SCRIPT,
        forward: (batch) => {
          saves.push(steps);
          forwarded += batch.length;
          client.enqueueEvents(gameId, batch);
        },
      },
      async () => {
        steps += 1;
        await settle();
      }
    );
    // never one save per step: far fewer saves than steps
    expect(saves.length).toBeLessThan(steps / 10);
    expect(saveEvent).not.toHaveBeenCalled();
    expect(saveMany.mock.calls.length).toBeGreaterThan(0);
    // the same game played with no idle moments records the same events
    expect(playScripted(SCRIPT).saved.length).toBe(forwarded);
  }, 120_000);
});
