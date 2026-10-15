/**
 * Test helper (#3289): records a card game's actions through the real
 * GameRecorder -> GameEventClient -> EventStore -> AsyncStorage mock, with an
 * idle moment after every action (the worst case: nothing coalesces), and
 * measures what it cost. Used by the Solitaire and FreeCell bench tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../../bugReportLimiter";
import { resetLogConfig } from "../../../eventQueueConfig";
import { EventStore } from "../../../eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../../gameEventClient";
import { GameRecorder } from "../../../gameRecorder";
import { PendingGamesStore } from "../../../pendingGamesStore";
import { createMoveLog, recordChunk, type Action } from "../../moveLog";
import type { CardGame } from "./recordMoves";

/** What the server charges one stored row beyond its JSON (backend `ROW_OVERHEAD_BYTES`). */
export const ROW_OVERHEAD_BYTES = 200;

export interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  /** AsyncStorage writes of any key while the game was played. */
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of every event's `data`. */
  recordedBytes: number;
  /** What the server stores: each row as `jsonb::text` plus ROW_OVERHEAD_BYTES. */
  storedBytes: number;
  /** Calls to `fetch` while the game was played (zero mid-game uploads). */
  fetches: number;
  /** Actions the move log took, and rows it handed over (its limits cap both). */
  logged: number;
  rows: number;
}

/** The length of `value` as Postgres prints `jsonb::text`: a space after every `,` and `:`. */
export function jsonbBytes(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      2 + value.reduce((n: number, v) => n + jsonbBytes(v), 0) + Math.max(0, value.length - 1) * 2
    );
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      2 +
      entries.reduce((n, [k, v]) => n + JSON.stringify(k).length + 2 + jsonbBytes(v), 0) +
      Math.max(0, entries.length - 1) * 2
    );
  }
  return JSON.stringify(value).length;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

async function newClient(gameType: CardGame) {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame(gameType);
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  return { store, client, gameId };
}

/** The screen's recording: chunks of 25 through the recorder, saved at idle. */
export async function playRecorded(
  gameType: CardGame,
  actions: readonly Action[],
  options: { readonly flushEvery?: number } = {}
): Promise<Measured> {
  const { store, client, gameId } = await newClient(gameType);
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let events = 0;
  let recordedBytes = 0;
  let storedBytes = 0;
  const tasks: (() => void)[] = [];
  const recorder = new GameRecorder<CardGame>({
    gameType,
    sink: {
      canAccept: () => true,
      enqueueMany: (batch: readonly EnqueueEventInput[]) => {
        for (const e of batch) {
          events += 1;
          recordedBytes += JSON.stringify(e.data ?? {}).length;
          storedBytes += jsonbBytes(e.data ?? {}) + ROW_OVERHEAD_BYTES;
        }
        client.enqueueEvents(gameId, batch);
        return true;
      },
    },
    schedule: (task) => tasks.push(task),
  });
  recorder.startSession();
  const log = createMoveLog((a, first) =>
    recordChunk(
      {
        beginUnit: (n) => recorder.beginUnit(n),
        record: (type, data) => recorder.record(type, data),
        closeUnit: () => recorder.closeUnit(),
      },
      a,
      first
    )
  );
  let n = 0;
  for (const action of actions) {
    log.push(action);
    n += 1;
    // The app going to the background (or another screen covering the game): a partial chunk is a row.
    if (options.flushEvery !== undefined && n % options.flushEvery === 0) {
      log.flush();
      recorder.flush();
    }
    while (tasks.length > 0) tasks.shift()?.(); // the idle moment
    await settle();
  }
  log.flush();
  recorder.endSession();
  await settle();
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  const out: Measured = {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    events,
    recordedBytes,
    storedBytes,
    fetches: fetchSpy.mock.calls.length,
    logged: log.count,
    rows: log.rows,
  };
  fetchSpy.mockRestore();
  return out;
}

/** The per-action alternative the chunks replace: one `moves`-sized event and one save per action. */
export async function playPerAction(
  gameType: CardGame,
  actions: readonly Action[]
): Promise<Measured> {
  const { store, client, gameId } = await newClient(gameType);
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  let recordedBytes = 0;
  let storedBytes = 0;
  let n = 0;
  for (const action of actions) {
    const data = { v: 1, unit: (n += 1), t_ms: n * 1500, m: [action] };
    recordedBytes += JSON.stringify(data).length;
    storedBytes += jsonbBytes(data) + ROW_OVERHEAD_BYTES;
    client.enqueueEvent(gameId, { type: "moves", data } as never);
    await settle();
  }
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((a, [, v]) => a + v.length, 0),
    events: actions.length,
    recordedBytes,
    storedBytes,
    fetches: 0,
    logged: actions.length,
    rows: actions.length,
  };
}
