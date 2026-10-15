/**
 * EventStore.enqueueMany (#3274): a unit of events in one lock turn and one
 * write per tier touched.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type GameEventRow } from "../eventStore";
import { chunkKey } from "../eventStoreChunks";
import { Priority, logConfig, resetLogConfig } from "../eventQueueConfig";

const setItem = AsyncStorage.setItem as jest.Mock;
const removeItem = AsyncStorage.removeItem as jest.Mock;

/** AsyncStorage writes (set or remove) of the event queue's own keys. */
function queueWrites(): string[] {
  return [...setItem.mock.calls, ...removeItem.mock.calls]
    .map((c) => c[0] as string)
    .filter((k) => k.startsWith("event_queue_v1/"));
}

function unit(n: number, type = "move", from = 0) {
  return Array.from({ length: n }, (_, i) => ({
    game_id: "g1",
    event_index: from + i,
    event_type: type,
    payload: { i },
  }));
}

describe("EventStore.enqueueMany", () => {
  let store: EventStore;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
    await store.stats(); // load the (empty) mirror, so only the enqueue writes below
    setItem.mockClear();
    removeItem.mockClear();
  });

  afterEach(() => {
    resetLogConfig();
  });

  it("writes a unit of N same-tier events with one AsyncStorage write", async () => {
    await store.enqueueMany(unit(25));
    expect(queueWrites()).toEqual([chunkKey(3, 0)]);
    const rows = (await store.peek(100)) as GameEventRow[];
    expect(rows).toHaveLength(25);
  });

  it("costs N writes the old way, for comparison", async () => {
    for (const input of unit(5)) await store.enqueueEvent(input);
    expect(queueWrites()).toHaveLength(5);
  });

  it("writes each tier a mixed unit touches once", async () => {
    await store.enqueueMany([
      { game_id: "g1", event_index: 0, event_type: "move", payload: {} },
      { game_id: "g1", event_index: 1, event_type: "score", payload: {} },
      { game_id: "g1", event_index: 2, event_type: "move", payload: {} },
      { game_id: "g1", event_index: 3, event_type: "score", payload: {} },
    ]);
    expect(queueWrites().sort()).toEqual([chunkKey(2, 0), chunkKey(3, 0)]);
  });

  it("keeps the given order and event_index, and places rows by priority", async () => {
    const returned = await store.enqueueMany(unit(10, "move", 7));
    expect(returned.map((r) => r.event_index)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(returned.every((r) => r.priority === Priority.GRANULAR)).toBe(true);
    const peeked = (await store.peek(100)) as GameEventRow[];
    expect(peeked.map((r) => r.event_index)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(peeked.map((r) => r.payload)).toEqual(Array.from({ length: 10 }, (_, i) => ({ i })));
  });

  it("survives a relaunch: a new store reads the unit back from AsyncStorage", async () => {
    await store.enqueueMany(unit(8));
    const relaunched = new EventStore();
    const rows = (await relaunched.peek(100)) as GameEventRow[];
    expect(rows.map((r) => r.event_index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("runs one eviction pass after the unit is in, written in the same commit", async () => {
    logConfig.MAX_ROWS = 6;
    await store.enqueueMany(unit(4, "move", 0));
    setItem.mockClear();
    await store.enqueueMany(unit(4, "move", 4));
    const stats = await store.stats();
    expect(stats.totalRows).toBe(6);
    expect(queueWrites()).toEqual([chunkKey(3, 0)]);
  });

  it("does nothing for an empty unit", async () => {
    expect(await store.enqueueMany([])).toEqual([]);
    expect(queueWrites()).toEqual([]);
  });

  it("leaves the mirror as the disk has it when the write fails", async () => {
    setItem.mockImplementationOnce(() => Promise.reject(new Error("disk full")));
    await expect(store.enqueueMany(unit(3))).rejects.toThrow("disk full");
    expect((await store.stats()).totalRows).toBe(0);
  });
});
