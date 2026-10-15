/**
 * The event queue's on-disk format (#3333): each priority tier is a run of
 * fixed-size chunks, one AsyncStorage key per chunk. See the header of
 * `eventStore.ts` for the format and its crash-safety rules; this module
 * holds the keys, the chunk arithmetic, the commit and the load (with the
 * migration from the #2959 one-key-per-tier format). `EventStore` keeps the
 * in-memory mirror and the queue's policy.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { Priority } from "./eventQueueConfig";
import type { Row } from "./eventStore";

const STORAGE_PREFIX = "event_queue_v1";
/** Every key of the queue starts with this (what `clearAll` scans for). */
export const QUEUE_KEY_PREFIX = `${STORAGE_PREFIX}/`;
export const META_KEY = `${STORAGE_PREFIX}/meta`;
const CHUNK_PREFIX = `${STORAGE_PREFIX}/chunk/`;
/** The #2959 format, one key per tier: read and removed by the migration in `loadTiers`. */
const LEGACY_TIER_PREFIX = `${STORAGE_PREFIX}/tier/`;

/**
 * The tiers, as data: every per-tier structure and key is derived from this
 * list, so a new tier is a new entry here plus its place in
 * `PEEK_ORDER` and the eviction lists below (as the replay tier was in #3276).
 */
export const TIERS: readonly Priority[] = [
  Priority.BUG_LOG,
  Priority.LIFECYCLE,
  Priority.MID,
  Priority.GRANULAR,
  Priority.REPLAY,
];
/** The order SyncWorker drains: lifecycle → mid → replay → granular → bug logs. */
export const PEEK_ORDER: readonly Priority[] = [
  Priority.LIFECYCLE,
  Priority.MID,
  Priority.REPLAY,
  Priority.GRANULAR,
  Priority.BUG_LOG,
];
/** The age-based eviction pool (#486). */
export const POOL_TIERS: readonly Priority[] = [Priority.BUG_LOG, Priority.MID, Priority.GRANULAR];
/**
 * Evicted after the pool, a whole game at a time, the game whose first row is
 * oldest first (#3276): a replay with some of its rows gone is useless.
 */
export const GAME_TIERS: readonly Priority[] = [Priority.REPLAY];
/** Evicted only once the pool and the game tiers are empty (#486). */
export const LAST_RESORT_TIERS: readonly Priority[] = [Priority.LIFECYCLE];

/**
 * Most rows in one chunk. With rows of ~250 B a full chunk is ~16 KB: the
 * most a save rewrites besides its own rows (and the most an eviction
 * rewrites per tier), with ~80 keys at the 5,000-row cap. Bytes written grow
 * linearly with this (the replay bench measured 100 rows at ~1.7× the bytes
 * of 64), key count inversely.
 * @internal exported for tests.
 */
export const CHUNK_MAX_ROWS = 64;
/**
 * Most row JSON (UTF-16 units, the `rowBytes` proxy) in one chunk, so a tier
 * of large rows (bug logs carry up to 16 KB of context) still writes small
 * keys. A single row bigger than this gets a chunk of its own.
 * @internal exported for tests.
 */
export const CHUNK_MAX_BYTES = 32 * 1024;
/**
 * Chunk keys read per `getMany` at load. `CHUNK_MAX_BYTES` counts UTF-16 code
 * units (the `rowBytes` proxy), not stored bytes: as UTF-8 a code unit is at
 * most 3 bytes, so one batch is at most 16 × 32 K × 3 ≈ 1.5 MB in the worst
 * case (all non-ASCII payloads), ~512 KB for ASCII ones — under Android's
 * 2 MB CursorWindow either way. (A single row over `CHUNK_MAX_BYTES` gets a
 * chunk of its own; the payload caps keep any row far below that bound.)
 */
const READ_BATCH = 16;

export function chunkKey(tier: Priority, seq: number): string {
  return `${CHUNK_PREFIX}${tier}/${seq}`;
}

/** @internal exported for tests. */
export function legacyTierKey(tier: Priority): string {
  return `${LEGACY_TIER_PREFIX}${tier}`;
}

/** The tier and seq of a chunk key of a known tier, or null. */
function parseChunkKey(key: string): { tier: Priority; seq: number } | null {
  if (!key.startsWith(CHUNK_PREFIX)) return null;
  const [tierPart, seqPart, ...rest] = key.slice(CHUNK_PREFIX.length).split("/");
  if (rest.length > 0 || tierPart === undefined || seqPart === undefined) return null;
  if (!/^\d+$/.test(tierPart) || !/^\d+$/.test(seqPart)) return null;
  const tier = Number(tierPart) as Priority;
  if (!TIERS.includes(tier)) return null; // a tier this build doesn't know: left alone
  return { tier, seq: Number(seqPart) };
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

/**
 * One stored chunk, as the mirror holds it. Never changed in place: a
 * mutation makes a new object (copy-on-write), so a chunk whose object is
 * unchanged is one the disk already holds.
 */
export interface Chunk {
  readonly seq: number;
  readonly rows: readonly Row[];
  /** Sum of the rows' size proxies. */
  readonly bytes: number;
}

/** Every tier's chunks, in `<seq>` order. */
export type Tiers = Record<Priority, readonly Chunk[]>;

/** One key write of a commit. */
export interface Op {
  readonly tier: Priority;
  readonly seq: number;
  /** The chunk to write, or null to remove the key. */
  readonly chunk: Chunk | null;
}

/** What the chunk arithmetic needs from the store. */
export interface ChunkContext {
  /** A row's size proxy (cached by the store). */
  readonly sizeOf: (row: Row) => number;
  /** The next `<seq>` of each tier: above every chunk key it has on disk. */
  nextSeq: Record<Priority, number>;
}

export function perTier<T>(make: (tier: Priority) => T): Record<Priority, T> {
  const out = {} as Record<Priority, T>;
  for (const tier of TIERS) out[tier] = make(tier);
  return out;
}

export function emptyTiers(): Tiers {
  return perTier(() => []);
}

export function tierRows(chunks: readonly Chunk[]): Row[] {
  const out: Row[] = [];
  for (const chunk of chunks) for (const row of chunk.rows) out.push(row);
  return out;
}

export function tierLength(chunks: readonly Chunk[]): number {
  let n = 0;
  for (const chunk of chunks) n += chunk.rows.length;
  return n;
}

function fits(a: Chunk, b: Chunk): boolean {
  return a.rows.length + b.rows.length <= CHUNK_MAX_ROWS && a.bytes + b.bytes <= CHUNK_MAX_BYTES;
}

export function makeChunk(ctx: ChunkContext, seq: number, rows: readonly Row[]): Chunk {
  let bytes = 0;
  for (const row of rows) bytes += ctx.sizeOf(row);
  return { seq, rows, bytes };
}

/**
 * The tier's chunks with `rows` appended: all into the last chunk when they
 * fit there, else into new chunks (filled in order, each within the caps).
 * One batch therefore writes one key in the common case — the last chunk, or
 * one new chunk — and never more than a chunk plus its own rows.
 */
export function appendRows(
  ctx: ChunkContext,
  tier: Priority,
  chunks: readonly Chunk[],
  rows: readonly Row[]
): Chunk[] {
  const out = chunks.slice();
  let added = 0;
  for (const row of rows) added += ctx.sizeOf(row);
  const last = out[out.length - 1];
  if (
    last !== undefined &&
    last.rows.length + rows.length <= CHUNK_MAX_ROWS &&
    last.bytes + added <= CHUNK_MAX_BYTES
  ) {
    out[out.length - 1] = {
      seq: last.seq,
      rows: last.rows.concat(rows),
      bytes: last.bytes + added,
    };
    return out;
  }
  let current: Row[] = [];
  let currentBytes = 0;
  for (const row of rows) {
    const n = ctx.sizeOf(row);
    if (
      current.length > 0 &&
      (current.length >= CHUNK_MAX_ROWS || currentBytes + n > CHUNK_MAX_BYTES)
    ) {
      out.push({ seq: ctx.nextSeq[tier]++, rows: current, bytes: currentBytes });
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += n;
  }
  if (current.length > 0)
    out.push({ seq: ctx.nextSeq[tier]++, rows: current, bytes: currentBytes });
  return out;
}

/**
 * Drop the empty chunks of a changed tier and merge each pair of adjacent
 * chunks that fit in one, when either of them changed (or a chunk between
 * them went). The rows of the lower chunk move into the higher one's key,
 * which keeps the crash rule (rows only move up). The pass keeps the tier's
 * standing invariant — no two adjacent chunks fit in one — so a tier never
 * holds more than about twice the chunks its rows need.
 */
export function compactChunks(chunks: readonly Chunk[], saved: readonly Chunk[]): Chunk[] {
  const old = new Set(saved);
  const out: Chunk[] = [];
  let gap = false;
  for (const chunk of chunks) {
    if (chunk.rows.length === 0) {
      gap = true;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev !== undefined && (gap || !old.has(prev) || !old.has(chunk)) && fits(prev, chunk)) {
      out[out.length - 1] = {
        seq: chunk.seq,
        rows: prev.rows.concat(chunk.rows),
        bytes: prev.bytes + chunk.bytes,
      };
    } else {
      out.push(chunk);
    }
    gap = false;
  }
  return out;
}

/** The key writes that take the disk from `saved` to `tiers`, for the dirty tiers. */
export function diffTiers(tiers: Tiers, saved: Tiers, dirty: ReadonlySet<Priority>): Op[] {
  const ops: Op[] = [];
  for (const tier of TIERS) {
    if (!dirty.has(tier)) continue;
    const before = new Map(saved[tier].map((chunk) => [chunk.seq, chunk]));
    const after = new Set<number>();
    for (const chunk of tiers[tier]) {
      after.add(chunk.seq);
      if (before.get(chunk.seq) !== chunk) ops.push({ tier, seq: chunk.seq, chunk });
    }
    for (const seq of before.keys()) {
      if (!after.has(seq)) ops.push({ tier, seq, chunk: null });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

async function writeOp(op: Op): Promise<void> {
  const key = chunkKey(op.tier, op.seq);
  if (op.chunk === null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(op.chunk.rows));
}

/** What `commitOps` did not land. */
export interface CommitResult {
  /** The ops that were run and failed, with the reason. */
  readonly failed: Map<Op, unknown>;
  /** Removals not run because a write of their tier failed (no error of their own). */
  readonly held: Set<Op>;
}

/**
 * Write `ops`: every chunk write first, together; then the removals of each
 * tier whose writes all landed — a removed chunk's rows may have moved into
 * one just written, and must not leave the disk before they reach it.
 */
export async function commitOps(ops: readonly Op[]): Promise<CommitResult> {
  const failed = new Map<Op, unknown>();
  const held = new Set<Op>();
  const writes = ops.filter((op) => op.chunk !== null);
  const outcomes = await Promise.allSettled(writes.map(writeOp));
  const blocked = new Set<Priority>();
  outcomes.forEach((outcome, i) => {
    const op = writes[i];
    if (op === undefined || outcome.status === "fulfilled") return;
    failed.set(op, outcome.reason);
    blocked.add(op.tier);
  });
  const runnable: Op[] = [];
  for (const op of ops) {
    if (op.chunk !== null) continue;
    if (blocked.has(op.tier)) held.add(op);
    else runnable.push(op);
  }
  const removed = await Promise.allSettled(runnable.map(writeOp));
  removed.forEach((outcome, i) => {
    const op = runnable[i];
    if (op !== undefined && outcome.status === "rejected") failed.set(op, outcome.reason);
  });
  return { failed, held };
}

function parseRows(raw: string | null | undefined): Row[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Row[]) : null;
  } catch {
    return null;
  }
}

/** Read chunk keys in batches of `READ_BATCH`. */
async function readChunks(keys: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = keys.slice(i, i + READ_BATCH);
    const values = await AsyncStorage.getMany(batch);
    for (const key of batch) out.set(key, values[key] ?? null);
  }
  return out;
}

interface Found {
  readonly chunks: Record<Priority, { seq: number; key: string }[]>;
  readonly legacy: { tier: Priority; key: string }[];
}

async function listKeys(): Promise<Found> {
  const chunks = perTier<{ seq: number; key: string }[]>(() => []);
  const legacy: { tier: Priority; key: string }[] = [];
  const legacyKeys = new Map(TIERS.map((tier) => [legacyTierKey(tier), tier]));
  for (const key of await AsyncStorage.getAllKeys()) {
    const parsed = parseChunkKey(key);
    if (parsed) chunks[parsed.tier].push({ seq: parsed.seq, key });
    const legacyTier = legacyKeys.get(key);
    if (legacyTier !== undefined) legacy.push({ tier: legacyTier, key });
  }
  for (const tier of TIERS) chunks[tier].sort((a, b) => a.seq - b.seq);
  return { chunks, legacy };
}

/**
 * Read every chunk from disk and bring the disk to one copy of each row in
 * the current format before the queue is used. Sets `ctx.nextSeq`.
 *
 *   1. A row found in two chunks of a tier (a crash between a merge's write
 *      and its removal) keeps the copy in the higher `<seq>`; the lower
 *      chunk is rewritten without it, or removed once empty.
 *   2. A tier still in the #2959 format (`event_queue_v1/tier/<tier>`) has
 *      its rows appended as chunks — skipping any a crashed earlier
 *      migration already wrote, which therefore sit in chunks too — and its
 *      old key is removed only after every chunk landed.
 *   3. A key that is not valid JSON is dropped (better to lose those rows
 *      than to fail every future write), as the #2959 format did.
 *
 * Writes run one at a time, chunk writes in `<seq>` order before removals,
 * so a crash at any point leaves a disk this same load recovers from: the
 * migrated rows are then a prefix of the old tier, and the next load appends
 * the rest in order. Any failure rejects, to be tried again by the caller.
 */
export async function loadTiers(ctx: ChunkContext): Promise<Tiers> {
  const found = await listKeys();
  const values = await readChunks(TIERS.flatMap((tier) => found.chunks[tier].map((f) => f.key)));
  const tiers = emptyTiers();
  const sets: Op[] = [];
  const removes: string[] = [];
  for (const tier of TIERS) {
    const entries = found.chunks[tier];
    ctx.nextSeq[tier] = (entries[entries.length - 1]?.seq ?? -1) + 1;
    // Newest first, so the copy of a row in the higher seq is the one kept.
    const seen = new Set<string>();
    const chunks: Chunk[] = [];
    for (const entry of entries.slice().reverse()) {
      const rows = parseRows(values.get(entry.key));
      const kept = (rows ?? []).filter((row) => !seen.has(row.id));
      for (const row of rows ?? []) seen.add(row.id);
      if (kept.length === 0) {
        removes.push(entry.key); // corrupt, or every row is in a newer chunk
        continue;
      }
      const chunk = makeChunk(ctx, entry.seq, kept);
      if (rows !== null && kept.length !== rows.length) sets.push({ tier, seq: entry.seq, chunk });
      chunks.push(chunk);
    }
    tiers[tier] = chunks.reverse();
  }

  for (const { tier, key } of found.legacy) {
    // Read alone: a #2959 tier can be ~1 MB, too big to batch.
    const rows = parseRows(await AsyncStorage.getItem(key)) ?? [];
    const present = new Set(tierRows(tiers[tier]).map((row) => row.id));
    const missing = rows.filter((row) => !present.has(row.id));
    if (missing.length > 0) {
      const before = new Set(tiers[tier]);
      tiers[tier] = appendRows(ctx, tier, tiers[tier], missing);
      for (const chunk of tiers[tier]) {
        if (!before.has(chunk)) sets.push({ tier, seq: chunk.seq, chunk });
      }
    }
    removes.push(key);
  }

  sets.sort((a, b) => a.tier - b.tier || a.seq - b.seq);
  for (const op of sets) await writeOp(op);
  for (const key of removes) await AsyncStorage.removeItem(key);
  return tiers;
}
