/**
 * Crash and failure fuzzing of the chunked event queue (#3333; from the
 * #3339 review, which ran it at 40 seeds and 5,370 crash points). Scaled
 * down to run in a few seconds in CI.
 *
 *   1. Crash at every write: each random operation is first run to count its
 *      storage writes, then replayed from the same disk with the process
 *      "dying" at each write in turn (that write and every later one never
 *      land). A fresh store over what is left must hold every row the
 *      operation kept, each in its before or after version, never twice,
 *      and must leave the disk with each row once.
 *   2. Random write failures (15% of queue writes throw, the process lives
 *      on): after each operation the store holds no row twice, its stats
 *      match its rows, and a fresh store over the disk reads exactly what
 *      the mirror holds.
 *
 * The AsyncStorage mock is replaced by an in-file map so writes can be
 * counted, failed and cut off. Seeds are fixed, so a failure reproduces.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type Row } from "../eventStore";
import { logConfig, resetLogConfig } from "../eventQueueConfig";

let mockUuidCounter = 0;
jest.mock("../uuid", () => ({ generateUUID: () => `u${mockUuidCounter++}` }));
let clock = 1_000_000;
jest.spyOn(Date, "now").mockImplementation(() => clock);
const disk = new Map<string, string>();
let crashAt = -1; // write index at which the process "dies"
let writeCount = 0;
let dead = false;
let snapshot: Map<string, string> | null = null;
let failProb = 0;
let rng = 1;
function rand(): number {
  rng = (rng * 1103515245 + 12345) & 0x7fffffff;
  return rng / 0x7fffffff;
}

function beforeWrite(): void {
  if (dead) throw new Error("DEAD");
  if (writeCount === crashAt) {
    snapshot = new Map(disk);
    dead = true;
    throw new Error("DEAD");
  }
  writeCount += 1;
  if (failProb > 0 && rand() < failProb) throw new Error("io fail");
}

function install(): void {
  const m = AsyncStorage as unknown as Record<string, jest.Mock>;
  m.getItem!.mockImplementation(async (k: string) => disk.get(k) ?? null);
  m.getMany!.mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, disk.get(k) ?? null]))
  );
  m.getAllKeys!.mockImplementation(async () => [...disk.keys()]);
  m.setItem!.mockImplementation(async (k: string, v: string) => {
    if (k.startsWith("event_queue_v1/")) beforeWrite();
    disk.set(k, v);
  });
  m.removeItem!.mockImplementation(async (k: string) => {
    if (k.startsWith("event_queue_v1/")) beforeWrite();
    disk.delete(k);
  });
  m.removeMany!.mockImplementation(async (keys: string[]) => {
    for (const k of keys) {
      beforeWrite();
      disk.delete(k);
    }
  });
}

const all = { includeDeadLettered: true, includeFuture: true };

function diskRows(d: Map<string, string>): Row[] {
  const out: Row[] = [];
  for (const [k, v] of d)
    if (k.startsWith("event_queue_v1/chunk/")) out.push(...(JSON.parse(v) as Row[]));
  return out;
}

type Op = (s: EventStore, ids: string[]) => Promise<unknown>;

function pickOp(): Op {
  const r = rand();
  if (r < 0.45) {
    return (s) => {
      const n = 1 + Math.floor(rand() * (rand() < 0.2 ? 150 : 8));
      const types = ["move", "score", "game_started", "hand_resolved"];
      return s.enqueueMany(
        Array.from({ length: n }, (_, i) => ({
          game_id: "g" + Math.floor(rand() * 3),
          event_index: i,
          event_type: types[Math.floor(rand() * types.length)]!,
          payload: { pad: "x".repeat(Math.floor(rand() * (rand() < 0.1 ? 7000 : 400))) },
        }))
      );
    };
  }
  if (r < 0.55) {
    return (s) =>
      s.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "warn",
        bug_source: "t",
        payload: { pad: "y".repeat(Math.floor(rand() * 15000)) },
      });
  }
  if (r < 0.75) {
    return (s, ids) => {
      // a flush: delete a run of oldest-ish rows, or random ones
      const pick =
        rand() < 0.5 ? ids.slice(0, Math.floor(rand() * 80)) : ids.filter(() => rand() < 0.2);
      return s.deleteByIds(pick);
    };
  }
  if (r < 0.85) {
    return async (s) => {
      const rows = await s.peek(1000, all);
      const upd = rows
        .filter(() => rand() < 0.1)
        .map((x) => ({ ...x, retry_count: x.retry_count + 1 }));
      return s.updateRows(upd);
    };
  }
  if (r < 0.92) return (s, ids) => s.markDeadLettered(ids.filter(() => rand() < 0.1));
  return (s) => s.sweepTTL(Date.now() + logConfig.TTL_MS - Math.floor(rand() * 50));
}

function byId(rows: Row[]): Map<string, string> {
  return new Map(rows.map((r) => [r.id, JSON.stringify(r)]));
}

const CRASH_SEEDS = 8;
const CRASH_STEPS = 45;
const FAILURE_SEEDS = 8;
const FAILURE_STEPS = 80;

describe("EventStore — crash and failure fuzzing (#3333)", () => {
  beforeEach(() => {
    disk.clear();
    install();
    resetLogConfig();
    logConfig.MAX_ROWS = 600;
    logConfig.MAX_SIZE_BYTES = 400_000;
  });

  it("crash at every write point never loses or duplicates", async () => {
    let checked = 0;
    for (let seed = 1; seed <= CRASH_SEEDS; seed += 1) {
      rng = seed;
      disk.clear();
      dead = false;
      crashAt = -1;
      failProb = 0;
      let store = new EventStore();
      for (let step = 0; step < CRASH_STEPS; step += 1) {
        const before = byId(await store.peek(100_000, all));
        const ids = [...before.keys()];
        const op = pickOp();
        const rngState = rng;
        const diskBefore = new Map(disk);
        clock += 10;
        const uuidBefore = mockUuidCounter;
        // dry run to learn the after-state and the number of writes
        writeCount = 0;
        await op(store, ids);
        const after = byId(await store.peek(100_000, all));
        const nWrites = writeCount;
        const diskAfter = new Map(disk);
        // replay with a crash at each write
        for (let k = 0; k < nWrites; k += 1) {
          disk.clear();
          for (const [kk, v] of diskBefore) disk.set(kk, v);
          const s2 = new EventStore();
          await s2.peek(1); // load
          rng = rngState;
          const op2 = pickOp();
          void op2;
          rng = rngState;
          mockUuidCounter = uuidBefore;
          writeCount = 0;
          crashAt = k;
          dead = false;
          snapshot = null;
          await op(s2, ids).catch(() => undefined);
          crashAt = -1;
          dead = false;
          const snap = snapshot ?? new Map(disk);
          disk.clear();
          for (const [kk, v] of snap) disk.set(kk, v);
          const s3 = new EventStore();
          const got = await s3.peek(100_000, all);
          const gotIds = got.map((r) => r.id);
          expect(new Set(gotIds).size).toBe(gotIds.length);
          for (const r of got) {
            const js = JSON.stringify(r);
            const ok = before.get(r.id) === js || after.get(r.id) === js;
            if (!ok)
              throw new Error(
                `seed ${seed} step ${step} crash ${k}: row ${r.id} has neither version`
              );
          }
          for (const id of before.keys()) {
            if (after.has(id) && !gotIds.includes(id))
              throw new Error(`seed ${seed} step ${step} crash ${k}: LOST ${id}`);
          }
          // disk now clean
          const dr = diskRows(disk).map((r) => r.id);
          expect(new Set(dr).size).toBe(dr.length);
          checked += 1;
        }
        disk.clear();
        for (const [kk, v] of diskAfter) disk.set(kk, v);
        store = new EventStore();
        mockUuidCounter = uuidBefore + 100000;
      }
    }
    process.stdout.write(`crash points checked: ${checked}\n`);
  }, 600_000);

  it("random write failures keep mirror == disk, no dups", async () => {
    let maxKeys = 0;
    for (let seed = 1; seed <= FAILURE_SEEDS; seed += 1) {
      rng = seed * 7919;
      disk.clear();
      dead = false;
      crashAt = -1;
      const store = new EventStore();
      for (let step = 0; step < FAILURE_STEPS; step += 1) {
        const ids = (await store.peek(100_000, all).catch(() => [] as Row[])).map((r) => r.id);
        clock += 10;
        failProb = 0.15;
        await pickOp()(store, ids).catch(() => undefined);
        failProb = 0;
        const mine = await store.peek(100_000, all);
        const st = await store.stats();
        const fresh = await new EventStore().peek(100_000, all);
        const m = mine.map((r) => r.id);
        expect(new Set(m).size).toBe(m.length);
        expect(st.totalRows).toBe(m.length);
        if (JSON.stringify(mine) !== JSON.stringify(fresh)) {
          throw new Error(
            `seed ${seed} step ${step}: mirror != disk (${mine.length} vs ${fresh.length})`
          );
        }
        const keys = [...disk.keys()].filter((k) => k.includes("/chunk/")).length;
        maxKeys = Math.max(maxKeys, keys);
      }
    }
    process.stdout.write(`max chunk keys: ${maxKeys}\n`);
  }, 600_000);
});
