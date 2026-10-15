/**
 * The chunked on-disk format (#3333): each tier is a run of fixed-size chunk
 * keys, a save writes one chunk whatever the queue's size, eviction and the
 * TTL sweep touch only the chunks they remove from, a crash between two
 * writes never loses or duplicates a row, the #2959 one-key-per-tier format
 * is migrated on the first load, and clearAll leaves no key behind.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type Row } from "../eventStore";
import { CHUNK_MAX_BYTES, CHUNK_MAX_ROWS, chunkKey, legacyTierKey } from "../eventStoreChunks";
import {
  Priority,
  logConfig,
  resetLogConfig,
  type Priority as PriorityT,
} from "../eventQueueConfig";

const setItem = AsyncStorage.setItem as jest.Mock;
const removeItem = AsyncStorage.removeItem as jest.Mock;
const removeMany = AsyncStorage.removeMany as jest.Mock;

const everything = { includeDeadLettered: true, includeFuture: true };

function row(i: number, priority: PriorityT = Priority.GRANULAR, extra: Partial<Row> = {}): Row {
  const common = {
    id: `r${priority}-${i}`,
    payload: { i },
    created_at: 1_000 + i,
    priority,
    retry_count: 0,
    next_retry_at: null,
  };
  if (priority === Priority.BUG_LOG) {
    return {
      ...common,
      log_type: "bug_log",
      bug_uuid: `b${i}`,
      bug_level: "warn",
      bug_source: "t",
      ...extra,
    } as Row;
  }
  return {
    ...common,
    log_type: "game_event",
    game_id: "g",
    event_index: i,
    event_type: priority === Priority.LIFECYCLE ? "game_started" : "move",
    ...extra,
  } as Row;
}

function rows(n: number, priority: PriorityT = Priority.GRANULAR, from = 0): Row[] {
  return Array.from({ length: n }, (_, k) => row(from + k, priority));
}

async function queueKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("event_queue_v1/")).sort();
}

async function chunkOnDisk(tier: PriorityT, seq: number): Promise<Row[] | null> {
  const raw = await AsyncStorage.getItem(chunkKey(tier, seq));
  return raw === null ? null : (JSON.parse(raw) as Row[]);
}

/** Queue writes (set or remove) since the last clear, as [op, key]. */
function writes(): [string, string][] {
  return [
    ...setItem.mock.calls.map(([k]) => ["set", k as string] as [string, string]),
    ...removeItem.mock.calls.map(([k]) => ["remove", k as string] as [string, string]),
  ].filter(([, k]) => k.startsWith("event_queue_v1/"));
}

function bytesWritten(): number {
  return setItem.mock.calls
    .filter(([k]) => (k as string).startsWith("event_queue_v1/"))
    .reduce((n, [, v]) => n + (v as string).length, 0);
}

function clearSpies(): void {
  setItem.mockClear();
  removeItem.mockClear();
  removeMany.mockClear();
}

function move(store: EventStore, i: number) {
  return store.enqueueEvent({ game_id: "g", event_index: i, event_type: "move", payload: { i } });
}

/** Fail the next storage call `pick` matches with `message`, restoring the mock after `run`. */
async function failingOnce(
  mock: jest.Mock,
  pick: (key: string) => boolean,
  message: string,
  run: () => Promise<void>
): Promise<void> {
  const original = mock.getMockImplementation()!;
  let armed = true;
  mock.mockImplementation(async (key: string, ...rest: unknown[]) => {
    if (armed && pick(key)) {
      armed = false;
      throw new Error(message);
    }
    return original(key, ...rest);
  });
  try {
    await run();
    expect(armed).toBe(false);
  } finally {
    mock.mockImplementation(original);
  }
}

describe("EventStore — chunked on-disk format (#3333)", () => {
  let store: EventStore;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
    await store.stats(); // load the (empty) mirror
    clearSpies();
  });

  afterEach(() => {
    resetLogConfig();
  });

  // -------------------------------------------------------------------------
  // Chunk rollover
  // -------------------------------------------------------------------------

  describe("chunk rollover", () => {
    it("fills a tier's last chunk to CHUNK_MAX_ROWS, then opens the next: one write per save", async () => {
      for (let i = 0; i < CHUNK_MAX_ROWS + 1; i += 1) await move(store, i);
      expect(setItem).toHaveBeenCalledTimes(CHUNK_MAX_ROWS + 1);
      expect(await queueKeys()).toEqual([chunkKey(3, 0), chunkKey(3, 1)].sort());
      expect(await chunkOnDisk(3, 0)).toHaveLength(CHUNK_MAX_ROWS);
      expect(await chunkOnDisk(3, 1)).toHaveLength(1);
      // The save that rolled over wrote only the new chunk.
      expect(setItem.mock.calls.at(-1)?.[0]).toBe(chunkKey(3, 1));
    });

    it("a unit that doesn't fit in the last chunk goes whole into a new one, in one write", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS - 2));
      clearSpies();
      const unit = Array.from({ length: 5 }, (_, i) => ({
        game_id: "g",
        event_index: 100 + i,
        event_type: "move",
        payload: { i },
      }));
      await store.enqueueMany(unit);
      expect(writes()).toEqual([["set", chunkKey(3, 1)]]);
      expect(await chunkOnDisk(3, 0)).toHaveLength(CHUNK_MAX_ROWS - 2);
      expect(await chunkOnDisk(3, 1)).toHaveLength(5);
    });

    it("a batch bigger than a chunk is split across new chunks, each within the caps", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 2 + 7));
      expect(await queueKeys()).toEqual([chunkKey(3, 0), chunkKey(3, 1), chunkKey(3, 2)].sort());
      expect((await chunkOnDisk(3, 2))?.length).toBe(7);
      const peeked = await store.peek(1_000, everything);
      expect(peeked.map((r) => r.id)).toEqual(rows(CHUNK_MAX_ROWS * 2 + 7).map((r) => r.id));
    });

    it("rolls over on bytes too: a chunk never holds more than CHUNK_MAX_BYTES of rows", async () => {
      const big = "x".repeat(Math.floor(CHUNK_MAX_BYTES / 3));
      for (let i = 0; i < 4; i += 1) {
        await store.enqueueBugLog({
          bug_uuid: `b${i}`,
          bug_level: "warn",
          bug_source: "t",
          payload: { big },
        });
      }
      const keys = await queueKeys();
      expect(keys.length).toBeGreaterThan(1);
      for (const key of keys) {
        const raw = (await AsyncStorage.getItem(key)) ?? "";
        expect(raw.length).toBeLessThanOrEqual(CHUNK_MAX_BYTES + 64);
      }
      expect(await store.peek(10)).toHaveLength(4);
    });

    it("the bytes one save writes do not grow with the queue", async () => {
      // One save against a near-empty tier and one against a 90%-full queue,
      // each into a last chunk holding the same number of rows.
      const n = CHUNK_MAX_ROWS - 10;
      await store.seedRows(rows(n));
      clearSpies();
      await move(store, 0);
      const small = bytesWritten();

      await store.clearAll();
      const filler = Math.floor((logConfig.MAX_ROWS * 0.9) / CHUNK_MAX_ROWS) * CHUNK_MAX_ROWS;
      await store.seedRows(rows(filler + n));
      clearSpies();
      await move(store, 0);
      const large = bytesWritten();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(large).toBeLessThanOrEqual(small * 1.05);
      expect(large).toBeLessThanOrEqual(CHUNK_MAX_BYTES);
    });
  });

  // -------------------------------------------------------------------------
  // Eviction and TTL across chunks
  // -------------------------------------------------------------------------

  describe("eviction across chunks", () => {
    it("drops the oldest rows across chunk boundaries, removing emptied chunks and rewriting only the boundary one", async () => {
      logConfig.MAX_ROWS = CHUNK_MAX_ROWS * 3;
      await store.seedRows(rows(CHUNK_MAX_ROWS * 3));
      clearSpies();
      const evictCount = CHUNK_MAX_ROWS + 5;
      logConfig.MAX_ROWS = CHUNK_MAX_ROWS * 3 - evictCount;
      expect(await store.evictToCapacity()).toBe(evictCount);
      // Chunk 0 emptied → removed; chunk 1 lost 5 rows → rewritten; chunk 2 untouched.
      expect(writes().sort()).toEqual(
        [
          ["remove", chunkKey(3, 0)],
          ["set", chunkKey(3, 1)],
        ].sort()
      );
      expect(await chunkOnDisk(3, 0)).toBeNull();
      expect((await chunkOnDisk(3, 1))?.[0]?.id).toBe(row(evictCount).id);
      const expected = rows(CHUNK_MAX_ROWS * 3)
        .slice(evictCount)
        .map((r) => r.id);
      expect((await store.peek(1_000, everything)).map((r) => r.id)).toEqual(expected);
      expect((await new EventStore().peek(1_000, everything)).map((r) => r.id)).toEqual(expected);
    });

    it("an evicting save writes its own chunk and the oldest chunk of each tier it evicted from", async () => {
      logConfig.MAX_ROWS = CHUNK_MAX_ROWS * 4;
      await store.seedRows([
        ...rows(CHUNK_MAX_ROWS * 2, Priority.MID),
        ...rows(CHUNK_MAX_ROWS * 2, Priority.GRANULAR, 1_000), // newer than every mid row
      ]);
      clearSpies();
      await move(store, 9_999); // evicts the single oldest row: the first mid row
      expect(writes().sort()).toEqual(
        [
          ["set", chunkKey(2, 0)],
          ["set", chunkKey(3, 2)],
        ].sort()
      );
      expect((await store.stats()).byPriority).toMatchObject({ 2: CHUNK_MAX_ROWS * 2 - 1 });
    });

    it("keeps the #486 order: lifecycle rows go only once the pool is empty", async () => {
      logConfig.MAX_ROWS = CHUNK_MAX_ROWS + 10;
      await store.seedRows([
        ...rows(CHUNK_MAX_ROWS, Priority.LIFECYCLE),
        ...rows(10, Priority.MID, 5_000),
      ]);
      logConfig.MAX_ROWS = CHUNK_MAX_ROWS - 5;
      expect(await store.evictToCapacity()).toBe(15);
      const stats = await store.stats();
      expect(stats.byPriority).toMatchObject({ 1: CHUNK_MAX_ROWS - 5, 2: 0 });
      expect((await new EventStore().stats()).byPriority).toMatchObject({ 1: CHUNK_MAX_ROWS - 5 });
    });
  });

  describe("TTL sweep across chunks", () => {
    it("removes the expired chunks whole and rewrites only the one the cutoff falls in", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 3));
      clearSpies();
      const keep = CHUNK_MAX_ROWS + 10; // rows from this index on survive
      const cutoffAt = row(CHUNK_MAX_ROWS * 3 - keep).created_at;
      const removed = await store.sweepTTL(cutoffAt + logConfig.TTL_MS);
      expect(removed).toBe(CHUNK_MAX_ROWS * 3 - keep);
      expect(writes().sort()).toEqual(
        [
          ["remove", chunkKey(3, 0)],
          ["set", chunkKey(3, 1)],
        ].sort()
      );
      expect(await chunkOnDisk(3, 2)).toHaveLength(CHUNK_MAX_ROWS);
      expect(await new EventStore().peek(1_000, everything)).toHaveLength(keep);
    });
  });

  // -------------------------------------------------------------------------
  // Fragmentation
  // -------------------------------------------------------------------------

  describe("merging sparse chunks", () => {
    it("merges a chunk that shrank into its neighbour, rows moving up into the higher seq, order kept", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 3));
      // Leave 10 rows in chunk 0 and 10 in chunk 1: they now fit in one.
      const doomed = rows(CHUNK_MAX_ROWS * 2)
        .filter((_, i) => i % CHUNK_MAX_ROWS >= 10)
        .map((r) => r.id);
      clearSpies();
      await store.deleteByIds(doomed);
      expect(await chunkOnDisk(3, 0)).toBeNull();
      expect(await chunkOnDisk(3, 1)).toHaveLength(20);
      expect(await queueKeys()).toEqual([chunkKey(3, 1), chunkKey(3, 2)].sort());
      // The write landed before the removal (rows only leave once they are elsewhere).
      const order = writes().map(([op, k]) => `${op} ${k}`);
      expect(order.indexOf(`set ${chunkKey(3, 1)}`)).toBeLessThan(
        order.indexOf(`remove ${chunkKey(3, 0)}`)
      );
      const expected = rows(CHUNK_MAX_ROWS * 3)
        .map((r) => r.id)
        .filter((id) => !doomed.includes(id));
      expect((await new EventStore().peek(1_000, everything)).map((r) => r.id)).toEqual(expected);
    });

    it("keeps the key count bounded when every chunk keeps one dead-lettered row", async () => {
      const n = CHUNK_MAX_ROWS * 20;
      await store.seedRows(rows(n));
      const keepers = rows(n)
        .filter((_, i) => i % CHUNK_MAX_ROWS === 0)
        .map((r) => r.id);
      await store.markDeadLettered(keepers);
      const keep = new Set(keepers);
      await store.deleteByIds(
        rows(n)
          .map((r) => r.id)
          .filter((id) => !keep.has(id))
      );
      expect(await store.peek(1_000, everything)).toHaveLength(20);
      expect(await queueKeys()).toHaveLength(1);
    });

    it("a merge whose write fails removes nothing: the rows stay where the disk has them", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 2));
      const doomed = rows(CHUNK_MAX_ROWS * 2)
        .filter((_, i) => i % CHUNK_MAX_ROWS >= 10)
        .map((r) => r.id);
      await failingOnce(
        setItem,
        (k) => k === chunkKey(3, 1),
        "disk full",
        () => expect(store.deleteByIds(doomed)).rejects.toThrow("disk full")
      );
      expect(removeItem).not.toHaveBeenCalledWith(chunkKey(3, 0));
      expect(await chunkOnDisk(3, 0)).toHaveLength(CHUNK_MAX_ROWS);
      const mirror = (await store.peek(1_000, everything)).map((r) => r.id);
      expect(mirror).toHaveLength(CHUNK_MAX_ROWS * 2);
      expect((await new EventStore().peek(1_000, everything)).map((r) => r.id)).toEqual(mirror);
    });
  });

  // -------------------------------------------------------------------------
  // Crash safety and partial disk states
  // -------------------------------------------------------------------------

  describe("crash safety", () => {
    it("a row in two chunks (a crash between a merge's write and its removal) loads once, from the higher seq", async () => {
      const [a, b, c] = rows(3);
      await AsyncStorage.setItem(chunkKey(3, 4), JSON.stringify([a, b]));
      await AsyncStorage.setItem(chunkKey(3, 7), JSON.stringify([a, b, c]));
      const fresh = new EventStore();
      expect((await fresh.peek(10, everything)).map((r) => r.id)).toEqual([a!.id, b!.id, c!.id]);
      expect((await fresh.stats()).totalRows).toBe(3);
      // The load cleaned the disk up: the stale chunk is gone.
      expect(await queueKeys()).toEqual([chunkKey(3, 7)]);
      // And new rows go above the highest seq seen.
      await move(fresh, 0);
      expect((await chunkOnDisk(3, 7))?.length).toBe(4);
    });

    it("a partial duplicate keeps the rows only the lower chunk has", async () => {
      const [a, b, c] = rows(3);
      await AsyncStorage.setItem(chunkKey(3, 0), JSON.stringify([a, b]));
      await AsyncStorage.setItem(chunkKey(3, 1), JSON.stringify([b, c]));
      const fresh = new EventStore();
      expect((await fresh.peek(10, everything)).map((r) => r.id)).toEqual([a!.id, b!.id, c!.id]);
      expect((await chunkOnDisk(3, 0))?.map((r) => r.id)).toEqual([a!.id]);
    });

    it("a removal that fails after a merge landed drops the mirror; the next call reloads without duplicates", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 2));
      const doomed = rows(CHUNK_MAX_ROWS * 2)
        .filter((_, i) => i % CHUNK_MAX_ROWS >= 10)
        .map((r) => r.id);
      await failingOnce(
        removeItem,
        (k) => k === chunkKey(3, 0),
        "remove failed",
        () => expect(store.deleteByIds(doomed)).rejects.toThrow("remove failed")
      );
      const ids = (await store.peek(1_000, everything)).map((r) => r.id);
      // No row twice; the deleted rows chunk 0 still holds on disk are back (their delete didn't land).
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(CHUNK_MAX_ROWS + 10);
      expect((await store.stats()).totalRows).toBe(ids.length);
      expect((await new EventStore().peek(1_000, everything)).map((r) => r.id)).toEqual(ids);
    });

    it("loads whatever chunks a partial write left: gaps in the seqs, a corrupt chunk dropped", async () => {
      const [a, b, c] = rows(3);
      await AsyncStorage.setItem(chunkKey(3, 0), JSON.stringify([a]));
      await AsyncStorage.setItem(chunkKey(3, 2), "{not json");
      await AsyncStorage.setItem(chunkKey(3, 5), JSON.stringify([b, c]));
      await AsyncStorage.setItem(chunkKey(0, 3), JSON.stringify([row(9, Priority.BUG_LOG)]));
      const fresh = new EventStore();
      expect((await fresh.stats()).byPriority).toMatchObject({ 0: 1, 3: 3 });
      expect(await chunkOnDisk(3, 2)).toBeNull();
      expect(await AsyncStorage.getItem(chunkKey(3, 2))).toBeNull();
      // A new chunk takes a seq above every one on disk.
      await fresh.seedRows(rows(CHUNK_MAX_ROWS, Priority.GRANULAR, 100));
      expect(await queueKeys()).toContain(chunkKey(3, 6));
    });

    it("a load that fails part-way rejects, and the next call loads again", async () => {
      await store.seedRows(rows(CHUNK_MAX_ROWS * 2));
      const getMany = AsyncStorage.getMany as jest.Mock;
      const fresh = new EventStore();
      await failingOnce(
        getMany as jest.Mock,
        () => true,
        "read failed",
        () => expect(fresh.peek(10)).rejects.toThrow("read failed")
      );
      expect((await fresh.stats()).totalRows).toBe(CHUNK_MAX_ROWS * 2);
    });
  });

  // -------------------------------------------------------------------------
  // Migration from the #2959 format
  // -------------------------------------------------------------------------

  describe("migration from one key per tier (#2959)", () => {
    async function legacyDisk(): Promise<Row[]> {
      const granular = rows(CHUNK_MAX_ROWS * 2 + 5);
      const bugs = rows(2, Priority.BUG_LOG);
      const lifecycle = rows(1, Priority.LIFECYCLE);
      await AsyncStorage.setItem(legacyTierKey(3), JSON.stringify(granular));
      await AsyncStorage.setItem(legacyTierKey(0), JSON.stringify(bugs));
      await AsyncStorage.setItem(legacyTierKey(1), JSON.stringify(lifecycle));
      await AsyncStorage.setItem("event_queue_v1/meta", JSON.stringify({ warningLastShownAt: 5 }));
      return [...lifecycle, ...granular, ...bugs]; // peek order: P1, P2, P3, P0
    }

    it("loads the old tiers, rewrites them as chunks in order, and leaves no old key", async () => {
      const expected = await legacyDisk();
      const fresh = new EventStore();
      expect(await fresh.peek(1_000, everything)).toEqual(expected);
      expect(await queueKeys()).toEqual(
        [
          chunkKey(0, 0),
          chunkKey(1, 0),
          chunkKey(3, 0),
          chunkKey(3, 1),
          chunkKey(3, 2),
          "event_queue_v1/meta",
        ].sort()
      );
      // The meta row is untouched; the next launch reads chunks only.
      expect(await fresh.shouldShowCapacityWarning({ totalRows: 0, sizeBytes: 0 })).toBe(false);
      expect(await new EventStore().peek(1_000, everything)).toEqual(expected);
    });

    it("an interrupted migration (old key still there, some chunks written) finishes with every row once", async () => {
      const expected = await legacyDisk();
      // The first launch wrote chunk 0 of tier 3, then crashed.
      await AsyncStorage.setItem(chunkKey(3, 0), JSON.stringify(rows(CHUNK_MAX_ROWS)));
      const fresh = new EventStore();
      expect(await fresh.peek(1_000, everything)).toEqual(expected);
      expect(await AsyncStorage.getItem(legacyTierKey(3))).toBeNull();
      expect(await chunkOnDisk(3, 0)).toEqual(rows(CHUNK_MAX_ROWS));
      expect(await new EventStore().peek(1_000, everything)).toEqual(expected);
    });

    it("a migration that fails part-way rejects, keeps the old key, and completes on the next call", async () => {
      const expected = await legacyDisk();
      const fresh = new EventStore();
      await failingOnce(
        setItem,
        (k) => k === chunkKey(3, 1),
        "crash",
        () => expect(fresh.peek(1_000)).rejects.toThrow("crash")
      );
      // Written so far: chunk 0 of tier 0 and 1, chunk 0 of tier 3. Old keys all still there.
      expect(await AsyncStorage.getItem(legacyTierKey(3))).not.toBeNull();
      expect(await chunkOnDisk(3, 0)).toHaveLength(CHUNK_MAX_ROWS);
      // A relaunch (or the same store's next call) finishes the job.
      expect(await new EventStore().peek(1_000, everything)).toEqual(expected);
      expect(await fresh.peek(1_000, everything)).toEqual(expected);
      expect((await queueKeys()).filter((k) => k.includes("/tier/"))).toEqual([]);
      expect((await fresh.stats()).totalRows).toBe(expected.length);
    });

    it("a corrupt old tier is dropped, as before", async () => {
      await AsyncStorage.setItem(legacyTierKey(2), "{not json");
      expect(await new EventStore().peek(10)).toEqual([]);
      expect(await queueKeys()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // clearAll
  // -------------------------------------------------------------------------

  describe("clearAll", () => {
    it("removes every queue key — chunks of every tier, leftovers, old tier keys, meta — and nothing else", async () => {
      await store.seedRows([...rows(CHUNK_MAX_ROWS * 2 + 1), ...rows(3, Priority.BUG_LOG)]);
      await store.markWarningShown(5);
      // Keys the mirror doesn't know: a leftover chunk, a tier this build lacks, an old tier key.
      await AsyncStorage.setItem(chunkKey(3, 99), "[]");
      await AsyncStorage.setItem("event_queue_v1/chunk/9/0", "[]");
      await AsyncStorage.setItem(legacyTierKey(2), "[]");
      await AsyncStorage.setItem("pending_games_v1", "{}");
      await store.clearAll();
      expect(await queueKeys()).toEqual([]);
      expect(await AsyncStorage.getItem("pending_games_v1")).toBe("{}");
      expect((await store.stats()).totalRows).toBe(0);
      // The store starts over cleanly.
      await move(store, 0);
      expect(await queueKeys()).toEqual([chunkKey(3, 0)]);
    });

    it("a clearAll that fails drops the mirror, so the next call reads what is left", async () => {
      await store.seedRows(rows(5));
      await failingOnce(
        removeMany,
        () => true,
        "remove failed",
        () => expect(store.clearAll()).rejects.toThrow("remove failed")
      );
      expect((await store.stats()).totalRows).toBe(5);
    });
  });
});
