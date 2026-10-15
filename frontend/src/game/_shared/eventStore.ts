/**
 * Bounded local event queue for #367.
 *
 * Storage engine: AsyncStorage. Each priority tier is a run of fixed-size
 * chunks (#3333), one key per chunk:
 *
 *   event_queue_v1/chunk/<tier>/<seq>  → JSON array of rows, oldest first
 *   event_queue_v1/meta                → { warningLastShownAt }
 *
 * `<tier>` is the row's priority (0 bug logs, 1 lifecycle, 2 mid, 3 granular,
 * 4 replay; the list is `TIERS`) and `<seq>` a per-tier sequence number that only ever
 * grows: a tier's rows are its chunks' rows in `<seq>` order. A chunk holds at
 * most `CHUNK_MAX_ROWS` rows and `CHUNK_MAX_BYTES` of row JSON (one row bigger
 * than that gets a chunk of its own). New rows go into the tier's last chunk
 * when the whole batch fits there, and into new chunks when it does not, so
 * a save writes one key of at most a chunk plus its own rows — whatever the
 * size of the queue (~16 KB for a full chunk of typical rows). Before #3333
 * each tier was one key (`event_queue_v1/tier/<tier>`, #2959) and every save
 * rewrote its whole tier: ~1 MB per save at the cap. Those keys are migrated
 * on the first load (`loadTiers` in `eventStoreChunks.ts`, which holds the
 * format; this file holds the mirror and the queue's policy).
 *
 * Writes of several keys are not atomic (AsyncStorage's multi-key calls are
 * not atomic on Android either, so they are not used for writes), so the
 * format is made safe for a crash between any two writes:
 *
 *   - Rows only ever move to a chunk with a higher `<seq>` of the same tier
 *     (a sparse chunk is merged into its successor; migrated rows are
 *     appended), and the chunk they leave is removed only after the chunk they
 *     reach has been written (`commitOps` runs removals in a second phase,
 *     after every write of the tier landed).
 *   - So a crash can leave a row in two chunks, never in none. The load keeps
 *     the copy in the higher `<seq>` (the newer one), drops the other and
 *     writes the cleaned-up chunks back before the queue is used, so the disk
 *     again holds every row once.
 *   - New rows are not covered by that rule: a crash before a save landed
 *     loses the save, as it always could. A batch split over several new
 *     chunks (bigger than a chunk, or a seed) is written in parallel, so a
 *     crash mid-batch can lose any of those chunks — rows from the middle of
 *     the batch as well as its tail — while the others land.
 *
 * Adjacent chunks whose rows would fit in one are merged when either changes,
 * so a tier never holds more than about twice the chunks its rows need: at
 * the caps (5,000 rows / 5 MB) that is a few hundred keys at worst, ~80 in
 * practice.
 *
 * In-memory mirror (#2959): the chunks are loaded from AsyncStorage once, by
 * the first operation, and kept in memory for the life of the process. Every
 * mutation changes the mirror and writes the changed chunks back
 * (write-through). The invariant is per chunk: the mirror holds what the disk
 * holds. A chunk whose write fails goes back to what the disk still has
 * (`transact`); a mutation that touches several chunks can therefore land in
 * part — exactly what a crash between two writes could do — and the caller
 * sees the rejection either way. (A failure that would leave a row in two
 * chunks drops the mirror instead, and the next operation loads it again.)
 * `peek`, `stats`, `updateRows`, `deleteByIds` and `markDeadLettered` read
 * only the mirror; the disk is read only by the initial load. `totalRows` and
 * `sizeBytes` are kept up to date per row, so the capacity check after an
 * enqueue is O(1) while the queue is under its caps.
 *
 * `onStats(listener)` tells subscribers (the capacity-warning toast) the new
 * stats after each mutation, so nothing has to poll the queue.
 *
 * Eviction order at cap (#486, #3276), first evicted to last:
 *
 *   1. The pool: P0 bug logs, P2 mid and P3 granular, as one age-based FIFO.
 *      Eviction drops the oldest rows across the pool until the overage is
 *      covered, ignoring tier — a fresh spam of P3 rows evicts 5,000 ancient
 *      bug logs, not the rows that just arrived.
 *
 *   2. P4 replay, only once the pool is empty: the gameplay events that
 *      rebuild a game (the registry's `Priority.REPLAY` types: roll, score,
 *      move, ...). A replay with holes is useless, so a game's replay rows go
 *      together, the least recently active game first (the game whose
 *      LATEST row in the tier is oldest, so the game being played, which
 *      holds the newest rows, goes last, and only if it is the only one
 *      left). A game is dropped whole even when part of it would have covered
 *      the overage. The tier is walked once, and only when the pool could not
 *      cover the overage. The ids of the last 64 games evicted this way are
 *      kept in memory: a replay event enqueued later for one of them is
 *      dropped (enqueueEvent resolves null, enqueueMany leaves it out of the
 *      rows it returns) instead of stored as a suffix with no start.
 *
 *   3. P1 lifecycle (game_started / game_ended / hand_resolved) is protected:
 *      the last resort, oldest row first, once the pool and the replay tier
 *      are empty. The epic's "FIFO-evictable at the hard cap" language still
 *      holds — last-to-evict, not never-evict — so a caller filling the queue
 *      with only lifecycle events still drains via FIFO.
 *
 * Tiers on disk: the replay tier is new in #3276. Rows queued before it (the
 * gameplay types the registry now marks replay) sit in the P3 granular and P2
 * mid tiers and STAY THERE: they are not re-tiered on load; they evict as part
 * of the pool and leave as they are sent. A queue written by the previous
 * build loads unchanged, and the previous build leaves a tier-4 chunk key,
 * which it does not know, alone.
 *
 * logConfig.priorityForEvent (the registry's tier per event type) decides
 * peek order (SyncWorker drains P1 → P2 → P4 → P3 → P0) and feeds the
 * capacity-warning signal. Only the eviction ordering is described above.
 *
 * The oldest rows sit in a tier's first chunks, so eviction and the TTL sweep
 * rewrite only the chunks they remove from, and remove the ones they empty.
 *
 * Why this replaces the old "tier-walk high → low" policy: see #486. The
 * original P3-first walk couldn't satisfy scenario 13 of the #373
 * acceptance gate — specifically the case where a burst of 5,000 fresh P3
 * rows needs to survive at the expense of 5,000 older P0 rows. No pure
 * tier ordering resolves that without an age dimension.
 *
 * All operations are serialised through one lock (`withLock`): the FE is
 * single-threaded, but an enqueue and a flush interleave across awaits, and
 * the lock is what keeps the mirror and the disk in step.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { LogType, Priority, logConfig } from "./eventQueueConfig";
import {
  type Chunk,
  type ChunkContext,
  GAME_TIERS,
  LAST_RESORT_TIERS,
  META_KEY,
  type Op,
  PEEK_ORDER,
  POOL_TIERS,
  QUEUE_KEY_PREFIX,
  TIERS,
  type Tiers,
  appendRows,
  commitOps,
  compactChunks,
  diffTiers,
  emptyTiers,
  loadTiers,
  makeChunk,
  perTier,
  tierLength,
  tierRows,
} from "./eventStoreChunks";
import { sentryThrottle } from "./sentryThrottle";
import { generateUUID } from "./uuid";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface GameEventRow {
  id: string;
  log_type: "game_event";
  game_id: string;
  event_index: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: number;
  priority: Priority;
  retry_count: number;
  next_retry_at: number | null;
  /** Set by SyncWorker on terminal failure (400, 403, repeated 413 on a
   *  single row, etc). Dead-lettered rows are skipped by peek() but still
   *  consume queue slots, so they age out via priority eviction or TTL. */
  dead_lettered?: boolean;
}

export interface BugLogRow {
  id: string;
  log_type: "bug_log";
  bug_uuid: string;
  bug_level: "warn" | "error" | "fatal";
  bug_source: string;
  payload: Record<string, unknown>;
  created_at: number;
  priority: Priority;
  retry_count: number;
  next_retry_at: number | null;
  dead_lettered?: boolean;
}

export type Row = GameEventRow | BugLogRow;

interface MetaState {
  warningLastShownAt: number | null;
}

export interface QueueStats {
  totalRows: number;
  sizeBytes: number;
  byLogType: Record<LogType, number>;
  byPriority: Record<Priority, number>;
  oldestAt: number | null;
}

/**
 * What `onStats` reports after each change: the stats without `oldestAt`,
 * which is only found again by a pass over the rows once the oldest row has
 * left, and so is left to `stats()`.
 */
export type QueueCounts = Omit<QueueStats, "oldestAt">;

export type StatsListener = (stats: QueueCounts) => void;

/** What `transact` puts back after a failed write. */
interface MirrorState {
  tiers: Tiers;
  totalRows: number;
  sizeBytes: number;
  byLogType: Record<LogType, number>;
  oldestAt: number | null;
  oldestDirty: boolean;
}

/** How far over the caps the queue is; eviction stops once both are ≤ 0. */
interface Overage {
  rows: number;
  bytes: number;
}

/** How many evicted games are remembered (see `EventStore.evictedGames`). */
const EVICTED_GAMES_MAX = 64;

/** Row positions to drop, per tier: chunk index → row indexes. */
type Drops = Map<Priority, Map<number, Set<number>>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function overCap(overage: Overage): boolean {
  return overage.rows > 0 || overage.bytes > 0;
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  // Prevent interleaved enqueue/evict from reading stale tiers. All mutators
  // go through withLock.
  private lock: Promise<unknown> = Promise.resolve();

  // Test-only: when > 0, enqueue paths await this many ms before running.
  // Used by #482 scenario 8 (non-blocking proof) to simulate slow
  // AsyncStorage writes and assert that gameplay frame cadence is
  // unaffected. Gated at the test-hook layer; production never sets it.
  private syntheticDelayMs = 0;

  /** The in-memory mirror of every tier's chunks; null until the first operation loads it. */
  private tiers: Tiers | null = null;
  /** What the chunk arithmetic needs: the size cache and each tier's next `<seq>`. */
  private readonly ctx: ChunkContext = {
    sizeOf: (row) => this.sizeOf(row),
    nextSeq: perTier(() => 0),
  };
  /** Cached capacity-warning meta; null until first read. */
  private meta: MetaState | null = null;
  /** The size proxy of each mirrored row, computed once when the row enters the mirror. */
  private bytes = new WeakMap<Row, number>();
  // Incremental stats (#2959): kept per row so the capacity check is O(1).
  private totalRows = 0;
  private sizeBytes = 0;
  private byLogType: Record<LogType, number> = { game_event: 0, bug_log: 0 };
  /** Oldest `created_at` in the mirror; recomputed lazily after the oldest row leaves. */
  private oldestAt: number | null = null;
  private oldestDirty = false;
  private readonly listeners = new Set<StatsListener>();
  /**
   * Games whose replay rows were evicted whole in this process (#3276), at
   * most `EVICTED_GAMES_MAX`, oldest first. Their later replay rows are
   * dropped on enqueue: a replay missing its start is useless, and storing the
   * rest would only cost queue space. In memory only, like the mirror.
   */
  private readonly evictedGames = new Set<string>();
  /** Games evicted by the transaction in progress; committed to `evictedGames` once it lands. */
  private evictedNow: string[] = [];
  /** Set when the mirror was dropped after a change: the next load tells subscribers. */
  private pendingNotify = false;

  setSyntheticDelay(ms: number): void {
    this.syntheticDelayMs = Math.max(0, ms);
  }

  private async maybeDelay(): Promise<void> {
    if (this.syntheticDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.syntheticDelayMs));
    }
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    // Swallow errors for the lock chain — caller still sees the rejection.
    this.lock = next.catch(() => undefined);
    return next;
  }

  // -------------------------------------------------------------------------
  // Disk
  // -------------------------------------------------------------------------

  private async readMeta(): Promise<MetaState> {
    if (this.meta) return this.meta;
    const raw = await AsyncStorage.getItem(META_KEY);
    let meta: MetaState = { warningLastShownAt: null };
    if (raw) {
      try {
        meta = JSON.parse(raw) as MetaState;
      } catch {
        // Corrupt meta — the warning is simply not suppressed.
      }
    }
    this.meta = meta;
    return meta;
  }

  private async writeMeta(meta: MetaState): Promise<void> {
    this.meta = meta;
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  // -------------------------------------------------------------------------
  // The mirror
  // -------------------------------------------------------------------------

  /** The mirrored tiers, loading them from disk the first time. Call under the lock. */
  private async mirror(): Promise<Tiers> {
    if (this.tiers) return this.tiers;
    // A load that fails part-way (a native read or write error) leaves
    // `this.tiers` null, so the next call loads again: start the counters
    // from zero here, or rows tracked before the failure would count twice.
    this.resetCounters();
    const tiers = await loadTiers(this.ctx);
    this.resetCounters();
    for (const tier of TIERS) for (const row of tierRows(tiers[tier])) this.track(row);
    this.tiers = tiers;
    if (this.pendingNotify) {
      this.pendingNotify = false;
      this.notify();
    }
    return tiers;
  }

  /**
   * Run one memory mutation and write the chunks it changed (#2959). `fn`
   * must only replace tier arrays and chunk objects (copy-on-write), never
   * change one in place, and add each tier it replaced to `dirty`. The
   * invariant is per chunk: the mirror holds what the disk holds. A chunk
   * whose write landed keeps its new rows; a chunk whose write failed goes
   * back to what the disk still has; the counters are recounted from the
   * chunks. So a mutation over several chunks can land in part — as a crash
   * between two writes could leave it — and the caller sees the rejection
   * either way. Subscribers hear of what landed. Call under the lock.
   */
  private async transact<T>(fn: (tiers: Tiers, dirty: Set<Priority>) => T): Promise<T> {
    const tiers = await this.mirror();
    const saved = this.save(tiers);
    const dirty = new Set<Priority>();
    let result: T;
    this.evictedNow = [];
    try {
      result = fn(tiers, dirty);
      for (const tier of dirty) tiers[tier] = compactChunks(tiers[tier], saved.tiers[tier]);
    } catch (e) {
      this.evictedNow = [];
      this.restore(tiers, saved);
      throw e;
    }
    const ops = diffTiers(tiers, saved.tiers, dirty);
    const { failed, held } = await commitOps(ops);
    // Remember the games this eviction chose even when the commit failed in
    // part: some of their rows may be gone already, and a later suffix must
    // not be stored without them (#3276). A game whose rows all survived is
    // only cut short — still a clean prefix — and is evicted again next time.
    this.rememberEvictedGames();
    if (failed.size > 0) {
      const landed = this.recover(tiers, saved.tiers, ops, failed, held);
      if (this.tiers === null) {
        // The mirror was dropped (a row would be in two chunks): load it again
        // now, so subscribers hear the stats the disk now gives. A load that
        // fails here leaves that to the next one (`pendingNotify`).
        await this.mirror().catch(() => undefined);
      } else if (landed) {
        this.notify();
      }
      throw this.reportCommitFailures(failed);
    }
    if (ops.length > 0) this.notify();
    return result;
  }

  /**
   * After a commit that failed in part, set each touched tier to what its
   * keys now hold: the new chunk where the op landed, the saved one where it
   * did not. Should that leave a row in two chunks (rows moved into a chunk
   * that was written, out of one whose removal failed), the mirror is dropped
   * instead and the next operation loads it again, cleaning the disk up as a
   * crash would be. Returns whether any op landed.
   */
  private recover(
    tiers: Tiers,
    saved: Tiers,
    ops: readonly Op[],
    failed: ReadonlyMap<Op, unknown>,
    held: ReadonlySet<Op>
  ): boolean {
    const touched = new Set(ops.map((op) => op.tier));
    let duplicated = false;
    for (const tier of touched) {
      const now = new Map<number, Chunk>();
      for (const chunk of saved[tier]) now.set(chunk.seq, chunk);
      for (const op of ops) {
        if (op.tier !== tier || failed.has(op) || held.has(op)) continue;
        if (op.chunk === null) now.delete(op.seq);
        else now.set(op.seq, op.chunk);
      }
      const chunks = [...now.values()].sort((a, b) => a.seq - b.seq);
      const ids = new Set<string>();
      for (const row of tierRows(chunks)) {
        if (ids.has(row.id)) duplicated = true;
        ids.add(row.id);
      }
      tiers[tier] = chunks;
    }
    if (duplicated) {
      this.dropMirror();
    } else {
      this.rebuildCounters(tiers);
    }
    return failed.size + held.size < ops.length;
  }

  /**
   * The error a failed commit rejects with — the first tier's — after
   * reporting each other tier that failed, once (#3293): one event per tier,
   * not per chunk (a tier of 20 chunks on a full disk fails 20 writes), none
   * for the removals held back behind a failed write, a fixed fingerprint and
   * no ids, through the session throttle. The caller reports what it is
   * thrown, as every caller already does.
   */
  private reportCommitFailures(failed: ReadonlyMap<Op, unknown>): unknown {
    const byTier = new Map<Priority, unknown>();
    for (const [op, reason] of failed) if (!byTier.has(op.tier)) byTier.set(op.tier, reason);
    let first: unknown;
    let isFirst = true;
    for (const [tier, reason] of byTier) {
      if (isFirst) {
        first = reason;
        isFirst = false;
        continue;
      }
      if (!sentryThrottle.allow(`eventStore.commit.tier${tier}`, "error")) continue;
      Sentry.captureException(reason, {
        fingerprint: ["eventStore.commit"],
        tags: { subsystem: "eventStore", op: "commit", tier: String(tier) },
      });
    }
    return first;
  }

  /**
   * Forget the mirror, so the next operation loads it from disk again — and
   * tells subscribers the stats it then finds, since the queue may have
   * changed under them.
   */
  private dropMirror(): void {
    this.tiers = null;
    this.resetCounters();
    this.pendingNotify = true;
  }

  private save(tiers: Tiers): MirrorState {
    return {
      tiers: perTier((tier) => tiers[tier]),
      totalRows: this.totalRows,
      sizeBytes: this.sizeBytes,
      byLogType: { ...this.byLogType },
      oldestAt: this.oldestAt,
      oldestDirty: this.oldestDirty,
    };
  }

  private restore(tiers: Tiers, saved: MirrorState): void {
    for (const tier of TIERS) tiers[tier] = saved.tiers[tier];
    this.totalRows = saved.totalRows;
    this.sizeBytes = saved.sizeBytes;
    this.byLogType = { ...saved.byLogType };
    this.oldestAt = saved.oldestAt;
    this.oldestDirty = saved.oldestDirty;
    // `bytes` needs no restoring: a row put back without an entry is measured
    // again on demand, and entries for rows that never landed are unreachable.
  }

  /** The size proxy of one row. An instance method so tests can count the calls. */
  private rowBytes(row: Row): number {
    // Approximate — JSON.stringify length is UTF-16 char count, and we treat
    // it as a size proxy. For ASCII payloads this matches byte count; for
    // non-ASCII it slightly under-counts, which is fine for a soft cap.
    return JSON.stringify(row).length;
  }

  /** A row's size proxy, measured once and cached. */
  private sizeOf(row: Row): number {
    let n = this.bytes.get(row);
    if (n === undefined) {
      n = this.rowBytes(row);
      this.bytes.set(row, n);
    }
    return n;
  }

  /** Account for a row entering the mirror; a row measured before is not measured again. */
  private track(row: Row): void {
    const n = this.sizeOf(row);
    this.totalRows += 1;
    this.sizeBytes += n;
    this.byLogType[row.log_type] += 1;
    if (!this.oldestDirty && (this.oldestAt === null || row.created_at < this.oldestAt)) {
      this.oldestAt = row.created_at;
    }
  }

  /**
   * Account for a row leaving the mirror. Its size-cache entry stays: a row
   * put back by a failed commit is then not measured again, and the entry
   * goes with the row when the row is collected (the map is weak).
   */
  private untrack(row: Row): void {
    this.totalRows -= 1;
    this.sizeBytes -= this.sizeOf(row);
    this.byLogType[row.log_type] -= 1;
    if (this.totalRows === 0) {
      this.oldestAt = null;
      this.oldestDirty = false;
    } else if (row.created_at === this.oldestAt) {
      this.oldestDirty = true;
    }
  }

  /** Zero the counters. `bytes` is keyed by row object, so stale entries simply go unreachable. */
  private resetCounters(): void {
    this.totalRows = 0;
    this.sizeBytes = 0;
    this.byLogType = { game_event: 0, bug_log: 0 };
    this.oldestAt = null;
    this.oldestDirty = false;
  }

  /**
   * Recount from the chunks, after a commit that landed in part. Every row in
   * the mirror has a size-cache entry (`untrack` keeps them), so this is a
   * pure addition pass: nothing is serialised.
   */
  private rebuildCounters(tiers: Tiers): void {
    this.resetCounters();
    for (const tier of TIERS) {
      for (const row of tierRows(tiers[tier])) this.track(row);
    }
  }

  private resetMirror(): void {
    this.evictedGames.clear();
    this.tiers = emptyTiers();
    this.ctx.nextSeq = perTier(() => 0);
    this.resetCounters();
    this.meta = { warningLastShownAt: null };
    this.pendingNotify = false; // clearAll notifies itself
  }

  /**
   * Apply `edit` to every mirrored row: undefined keeps the row, null drops
   * it, a row replaces it in place. Only the chunks that changed are new
   * objects (and so written back). Returns how many rows were dropped or
   * replaced.
   */
  private editRows(
    tiers: Tiers,
    dirty: Set<Priority>,
    edit: (row: Row) => Row | null | undefined
  ): number {
    let changed = 0;
    for (const tier of TIERS) {
      const chunks = tiers[tier];
      let next: Chunk[] | null = null;
      for (let ci = 0; ci < chunks.length; ci += 1) {
        const chunk = chunks[ci];
        if (chunk === undefined) continue;
        let rows: Row[] | null = null;
        for (let ri = 0; ri < chunk.rows.length; ri += 1) {
          const row = chunk.rows[ri];
          if (row === undefined) continue;
          const out = edit(row);
          if (out === undefined) {
            rows?.push(row);
            continue;
          }
          if (rows === null) rows = chunk.rows.slice(0, ri);
          this.untrack(row);
          changed += 1;
          if (out !== null) {
            this.track(out);
            rows.push(out);
          }
        }
        if (rows === null) continue;
        if (next === null) next = chunks.slice();
        next[ci] = makeChunk(this.ctx, chunk.seq, rows);
      }
      if (next !== null) {
        tiers[tier] = next;
        dirty.add(tier);
      }
    }
    return changed;
  }

  /** Drop every mirrored row `drop` matches, writing back only the chunks that changed. */
  private removeWhere(drop: (row: Row) => boolean): Promise<number> {
    return this.transact((tiers, dirty) =>
      this.editRows(tiers, dirty, (row) => (drop(row) ? null : undefined))
    );
  }

  /**
   * Replace every mirrored row `replace` returns a row for (null leaves it),
   * writing back only the chunks that changed. Returns how many were replaced.
   */
  private replaceWhere(replace: (row: Row) => Row | null): Promise<number> {
    return this.transact((tiers, dirty) =>
      this.editRows(tiers, dirty, (row) => replace(row) ?? undefined)
    );
  }

  /** Drop the rows at `drops` (positions in the current chunks), per tier. */
  private dropAt(tiers: Tiers, dirty: Set<Priority>, drops: Drops): void {
    for (const [tier, byChunk] of drops) {
      if (byChunk.size === 0) continue;
      const next = tiers[tier].slice();
      for (const [ci, idx] of byChunk) {
        const chunk = next[ci];
        if (chunk === undefined) continue;
        next[ci] = makeChunk(
          this.ctx,
          chunk.seq,
          chunk.rows.filter((_, i) => !idx.has(i))
        );
      }
      tiers[tier] = next;
      dirty.add(tier);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Queue a game event. The row returned is the caller-facing view: its
   * `payload` is the object handed in (or the truncation stub when it was
   * oversized), not the JSON-normalised form — `undefined` fields and `Date`
   * instances survive in it. `peek()` and the disk hold the normalised form
   * (what `JSON.stringify` makes of it), owned by the store. See `ownPayload`.
   *
   * Resolves null, storing nothing, for a replay event of a game whose replay
   * rows the queue already evicted whole (#3276): the rest would be a useless
   * suffix. `enqueueMany` leaves such events out of the rows it returns.
   */
  async enqueueEvent(input: {
    game_id: string;
    event_index: number;
    event_type: string;
    payload: Record<string, unknown>;
  }): Promise<GameEventRow | null> {
    return this.withLock(async () => {
      await this.maybeDelay();
      const priority = logConfig.priorityForEvent("game_event", input.event_type);
      if (this.isDroppedReplay(priority, input.game_id)) return null;
      const payload = this.ownPayload(input.payload, logConfig.MAX_EVENT_PAYLOAD_BYTES);
      const row: GameEventRow = {
        id: generateUUID(),
        log_type: "game_event",
        game_id: input.game_id,
        event_index: input.event_index,
        event_type: input.event_type,
        payload: payload.stored,
        created_at: Date.now(),
        priority,
        retry_count: 0,
        next_retry_at: null,
      };
      await this.insertMany([row]);
      return { ...row, payload: payload.returned };
    });
  }

  /**
   * Queue several game events in one lock turn and one commit (#3274): the
   * events of each tier go into that tier's last chunk (or a new one) in one
   * write, so a unit of N events in one tier costs one AsyncStorage write,
   * not N, and writes about a chunk at most besides its own rows (#3333). A
   * batch spread over several tiers costs one write per tier touched. Rows
   * keep their order — the order given is the order within a tier — and
   * `event_index` is the caller's (gameEventClient reserves them
   * contiguously). One eviction pass runs after all are in. Same payload
   * contract as `enqueueEvent`, oversized stub included (GameRecorder sizes
   * its events before they get here).
   */
  async enqueueMany(
    inputs: readonly {
      game_id: string;
      event_index: number;
      event_type: string;
      payload: Record<string, unknown>;
    }[]
  ): Promise<GameEventRow[]> {
    if (inputs.length === 0) return [];
    return this.withLock(async () => {
      await this.maybeDelay();
      const now = Date.now();
      const rows: GameEventRow[] = [];
      const returned: GameEventRow[] = [];
      for (const input of inputs) {
        const priority = logConfig.priorityForEvent("game_event", input.event_type);
        if (this.isDroppedReplay(priority, input.game_id)) continue;
        const payload = this.ownPayload(input.payload, logConfig.MAX_EVENT_PAYLOAD_BYTES);
        const row: GameEventRow = {
          id: generateUUID(),
          log_type: "game_event",
          game_id: input.game_id,
          event_index: input.event_index,
          event_type: input.event_type,
          payload: payload.stored,
          created_at: now,
          priority,
          retry_count: 0,
          next_retry_at: null,
        };
        rows.push(row);
        returned.push({ ...row, payload: payload.returned });
      }
      if (rows.length > 0) await this.insertMany(rows);
      return returned;
    });
  }

  /** Whether a replay event belongs to a game the queue evicted whole (#3276). */
  private isDroppedReplay(priority: Priority, gameId: string): boolean {
    return priority === Priority.REPLAY && this.evictedGames.has(gameId);
  }

  /** Queue a bug log. Same return contract as `enqueueEvent`. */
  async enqueueBugLog(input: {
    bug_uuid: string;
    bug_level: "warn" | "error" | "fatal";
    bug_source: string;
    payload: Record<string, unknown>;
  }): Promise<BugLogRow> {
    return this.withLock(async () => {
      await this.maybeDelay();
      const payload = this.ownPayload(input.payload, logConfig.MAX_BUG_CONTEXT_BYTES);
      const row: BugLogRow = {
        id: generateUUID(),
        log_type: "bug_log",
        bug_uuid: input.bug_uuid,
        bug_level: input.bug_level,
        bug_source: input.bug_source,
        payload: payload.stored,
        created_at: Date.now(),
        priority: Priority.BUG_LOG,
        retry_count: 0,
        next_retry_at: null,
      };
      await this.insertMany([row]);
      return { ...row, payload: payload.returned };
    });
  }

  /**
   * Append rows to their tiers, evict to capacity, and write the chunks that
   * changed once. The callers return a copy of each row with the caller's own
   * payload: the mirror's object and its parsed payload are never handed out,
   * so nothing outside can change them (or the cached size) behind the
   * store's back.
   */
  private insertMany(rows: readonly Row[]): Promise<void> {
    return this.transact((tiers, dirty) => this.appendUnlocked(tiers, dirty, rows));
  }

  /** Append rows by tier (one `appended` per tier touched) and run one eviction pass. */
  private appendUnlocked(tiers: Tiers, dirty: Set<Priority>, rows: readonly Row[]): void {
    const byTier = perTier<Row[]>(() => []);
    for (const row of rows) byTier[row.priority].push(row);
    for (const tier of TIERS) {
      const added = byTier[tier];
      if (added.length === 0) continue;
      for (const row of added) this.track(row);
      tiers[tier] = appendRows(this.ctx, tier, tiers[tier], added);
      dirty.add(tier);
    }
    this.evictToCapacityUnlocked(tiers, dirty);
  }

  /**
   * Peek the N oldest rows across tiers, ordered by (priority desc,
   * created_at asc). SyncWorker uses this to build batches. Deleted rows
   * are the caller's responsibility — we don't mark peeked rows in any way.
   * The rows returned are copies: changing one changes nothing in the queue.
   *
   * Dead-lettered rows are skipped unless `includeDeadLettered` is set.
   * Rows with a future `next_retry_at` (set by backoff) are also skipped
   * unless `now` is explicitly advanced past them.
   */
  async peek(
    limit: number,
    opts: { includeDeadLettered?: boolean; includeFuture?: boolean; now?: number } = {}
  ): Promise<Row[]> {
    const now = opts.now ?? Date.now();
    return this.withLock(async () => {
      const tiers = await this.mirror();
      const out: Row[] = [];
      for (const tier of PEEK_ORDER) {
        const rows = tierRows(tiers[tier]);
        rows.sort((a, b) => a.created_at - b.created_at);
        for (const row of rows) {
          if (!opts.includeDeadLettered && row.dead_lettered) continue;
          // Rows a partly failed eviction left of a game evicted whole never
          // sync: they would upload a replay with holes (#3276). The next
          // eviction removes them first.
          if (row.log_type === "game_event" && this.isDroppedReplay(row.priority, row.game_id)) {
            continue;
          }
          if (!opts.includeFuture && row.next_retry_at !== null && row.next_retry_at > now) {
            continue;
          }
          out.push({ ...row });
          if (out.length >= limit) return out;
        }
      }
      return out;
    });
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const set = new Set(ids);
    return this.withLock(() => this.removeWhere((r) => set.has(r.id)));
  }

  /**
   * Drop every queued game-event row for one game, dead-lettered and
   * backed-off rows included. Used when a game is discarded before the
   * player started it (#2619). Returns how many rows were removed.
   */
  async deleteByGameId(gameId: string): Promise<number> {
    return this.deleteByGameIds([gameId]);
  }

  /**
   * `deleteByGameId` for several games in one pass over the tiers — the
   * startup sweep discards all of a killed process's untouched games at once
   * (#2654).
   */
  async deleteByGameIds(gameIds: string[]): Promise<number> {
    if (gameIds.length === 0) return 0;
    const ids = new Set(gameIds);
    return this.withLock(() =>
      this.removeWhere((r) => r.log_type === "game_event" && ids.has(r.game_id))
    );
  }

  /**
   * Update a batch of rows (e.g. after a 429 sets next_retry_at on them).
   * Rows are matched by id; missing rows are silently ignored.
   */
  async updateRows(updated: Row[]): Promise<void> {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((r) => [r.id, r]));
    await this.withLock(() =>
      this.replaceWhere((row) => {
        const replacement = byId.get(row.id);
        return replacement ? { ...replacement } : null;
      })
    );
  }

  /**
   * Flag rows as dead-lettered (#2959): they stay in the queue for eviction
   * or TTL to remove, but `peek` no longer returns them. Rows already flagged
   * are left alone. Returns how many rows were flagged.
   */
  async markDeadLettered(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const set = new Set(ids);
    return this.withLock(() =>
      this.replaceWhere((row) =>
        set.has(row.id) && !row.dead_lettered ? { ...row, dead_lettered: true } : null
      )
    );
  }

  /**
   * `markDeadLettered` for every queued row of the given games (#2959) —
   * parked (future-retry) rows included by construction, rows already flagged
   * left alone. SyncWorker uses it when the server refuses a game for good.
   * Returns how many rows were flagged.
   */
  async markDeadLetteredByGameIds(gameIds: string[]): Promise<number> {
    if (gameIds.length === 0) return 0;
    const ids = new Set(gameIds);
    return this.withLock(() =>
      this.replaceWhere((row) =>
        row.log_type === "game_event" && ids.has(row.game_id) && !row.dead_lettered
          ? { ...row, dead_lettered: true }
          : null
      )
    );
  }

  async sweepTTL(now: number = Date.now()): Promise<number> {
    const cutoff = now - logConfig.TTL_MS;
    return this.withLock(() => this.removeWhere((r) => r.created_at < cutoff));
  }

  async stats(): Promise<QueueStats> {
    return this.withLock(async () => this.statsUnlocked(await this.mirror()));
  }

  /**
   * Be told the queue's stats after every change (#2959). The listener runs
   * synchronously inside the mutating call, after the write; a throwing
   * listener is reported, never propagated. Returns the unsubscribe function.
   */
  onStats(listener: StatsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Remove every key of the queue — chunks (of any tier, mirrored or not),
   * #2959 tier keys and the meta row — found by a scan of the keys, so
   * nothing a crash or an older build left behind survives. On a failure the
   * mirror is dropped, so the next operation reads what is left.
   */
  async clearAll(): Promise<void> {
    return this.withLock(async () => {
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
          k.startsWith(QUEUE_KEY_PREFIX)
        );
        if (keys.length > 0) await AsyncStorage.removeMany(keys);
      } catch (e) {
        this.meta = null; // the meta key may be gone too
        this.dropMirror();
        throw e;
      }
      this.resetMirror();
      this.notify();
    });
  }

  /**
   * Test-only: bulk-insert raw rows into the appropriate tiers and run a
   * single eviction pass. Used by the #373 e2e harness to build large
   * fixtures cheaply — a normal enqueue path would re-enter the lock once
   * per row, and 10,000 rows times N ms of AsyncStorage write is infeasible.
   * Public on the class because the test-only gate lives at the window hook
   * layer, not here.
   */
  async seedRows(rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    // Copies, payload included: the caller keeps its objects, the mirror
    // keeps its own (a test fixture, so the round-trip per row is fine).
    const copies = rows.map((row): Row => ({
      ...row,
      payload: JSON.parse(JSON.stringify(row.payload)) as Record<string, unknown>,
    }));
    return this.withLock(() =>
      this.transact((tiers, dirty) => this.appendUnlocked(tiers, dirty, copies))
    );
  }

  /** Capacity warning state (read/updated by gameEventClient). */
  async shouldShowCapacityWarning(
    stats?: Pick<QueueStats, "totalRows" | "sizeBytes">,
    now: number = Date.now()
  ): Promise<boolean> {
    return this.withLock(async () => {
      const s = stats ?? this.statsUnlocked(await this.mirror());
      const ratio = Math.max(
        s.totalRows / logConfig.MAX_ROWS,
        s.sizeBytes / logConfig.MAX_SIZE_BYTES
      );
      if (ratio < logConfig.CAPACITY_WARNING_RATIO) return false;
      const meta = await this.readMeta();
      if (
        meta.warningLastShownAt !== null &&
        now - meta.warningLastShownAt < logConfig.CAPACITY_WARNING_SUPPRESS_MS
      ) {
        return false;
      }
      return true;
    });
  }

  async markWarningShown(now: number = Date.now()): Promise<void> {
    return this.withLock(async () => {
      await this.writeMeta({ warningLastShownAt: now });
    });
  }

  // -------------------------------------------------------------------------
  // Internal capacity enforcement
  // -------------------------------------------------------------------------

  /**
   * Public entry point for tests and scenarios that want an eviction pass on
   * its own; the enqueue and seed paths run one inside their own lock turn.
   */
  async evictToCapacity(): Promise<number> {
    return this.withLock(() =>
      this.transact((tiers, dirty) => this.evictToCapacityUnlocked(tiers, dirty))
    );
  }

  /**
   * Evict the mirror down to the caps and record the tiers that changed in
   * `dirty`; the caller writes them. Pure memory, and O(1) while the queue is
   * under its caps.
   *
   * #486 / #3276 policy: age-based FIFO across the pool, then replay games
   * whole (oldest first), with P1 (lifecycle) as a last-resort drain. See the
   * file header for the full rationale.
   */
  private evictToCapacityUnlocked(tiers: Tiers, dirty: Set<Priority>): number {
    const overage: Overage = {
      rows: this.totalRows - logConfig.MAX_ROWS,
      bytes: this.sizeBytes - logConfig.MAX_SIZE_BYTES,
    };
    if (!overCap(overage)) return 0;
    let evicted = this.evictOldest(tiers, POOL_TIERS, overage, dirty);
    // The pool couldn't cover the overage: drop replay games whole, the
    // oldest first (#3276).
    if (overCap(overage)) evicted += this.evictOldestGames(tiers, GAME_TIERS, overage, dirty);
    // Last-resort: drop oldest P1 rows until the cap is met. This only fires
    // when the queue is pathologically full of lifecycle events; normal
    // workloads never touch this branch.
    if (overCap(overage)) evicted += this.evictOldest(tiers, LAST_RESORT_TIERS, overage, dirty);
    return evicted;
  }

  /** Evict the oldest rows of `from` until the overage is covered or they run out. */
  private evictOldest(
    tiers: Tiers,
    from: readonly Priority[],
    overage: Overage,
    dirty: Set<Priority>
  ): number {
    type Candidate = { tier: Priority; ci: number; ri: number; row: Row };
    const pool: Candidate[] = [];
    for (const tier of from) {
      tiers[tier].forEach((chunk, ci) =>
        chunk.rows.forEach((row, ri) => pool.push({ tier, ci, ri, row }))
      );
    }
    // Primary key: older first. Tiebreaker: when two rows share a
    // created_at (serial enqueues inside the same millisecond, common in
    // tests and during bursts), prefer evicting the row with the higher
    // priority *number* — i.e. drop P3 before P2 before P0, so bug logs
    // still win ties against granular events. Without this tiebreaker
    // the stable-sort insertion order would arbitrarily decide which
    // tier loses. Within a tier, ties keep the tier's order.
    pool.sort((a, b) => a.row.created_at - b.row.created_at || b.tier - a.tier);

    const drops: Drops = new Map();
    let evicted = 0;
    for (const cand of pool) {
      if (!overCap(overage)) break;
      let byChunk = drops.get(cand.tier);
      if (byChunk === undefined) {
        byChunk = new Map();
        drops.set(cand.tier, byChunk);
      }
      let idx = byChunk.get(cand.ci);
      if (idx === undefined) {
        idx = new Set();
        byChunk.set(cand.ci, idx);
      }
      idx.add(cand.ri);
      this.drop(cand.row, overage);
      evicted += 1;
    }
    this.dropAt(tiers, dirty, drops);
    return evicted;
  }

  /**
   * Evict whole games from `from` (#3276), the least recently active first
   * (the game whose LATEST row in the tier comes first), until the overage is
   * covered or the tiers run out. Ordering by the latest row, not the first,
   * keeps the game being played — whose newest rows were just appended — for
   * last, and a finished game goes before it. One pass over the tiers' rows
   * groups them by game; a game is dropped in full once it is started on, and
   * its id is remembered (see `rememberEvictedGames`) so the rows it still
   * enqueues are dropped rather than stored as a useless suffix.
   */
  private evictOldestGames(
    tiers: Tiers,
    from: readonly Priority[],
    overage: Overage,
    dirty: Set<Priority>
  ): number {
    type Pos = { tier: Priority; ci: number; ri: number; row: Row };
    const games = new Map<string, { id: string | null; last: number; rows: Pos[] }>();
    let n = 0;
    for (const tier of from) {
      tiers[tier].forEach((chunk, ci) =>
        chunk.rows.forEach((row, ri) => {
          // A row with no game id (not expected in a replay tier) is its own "game".
          const id = row.log_type === "game_event" && row.game_id ? row.game_id : null;
          const key = id ?? `row:${row.id}`;
          let game = games.get(key);
          if (game === undefined) {
            game = { id, last: 0, rows: [] };
            games.set(key, game);
          }
          game.last = n;
          n += 1;
          game.rows.push({ tier, ci, ri, row });
        })
      );
    }
    // Remnants of games already evicted (a partly failed commit left them)
    // go first, then the least recently active game.
    const gone = (g: { id: string | null }) =>
      g.id !== null && this.evictedGames.has(g.id) ? 0 : 1;
    const order = [...games.values()].sort((x, y) => gone(x) - gone(y) || x.last - y.last);
    const drops: Drops = new Map();
    let evicted = 0;
    for (const game of order) {
      if (!overCap(overage)) break;
      if (game.id !== null) this.evictedNow.push(game.id);
      for (const cand of game.rows) {
        let byChunk = drops.get(cand.tier);
        if (byChunk === undefined) {
          byChunk = new Map();
          drops.set(cand.tier, byChunk);
        }
        let idx = byChunk.get(cand.ci);
        if (idx === undefined) {
          idx = new Set();
          byChunk.set(cand.ci, idx);
        }
        idx.add(cand.ri);
        this.drop(cand.row, overage);
        evicted += 1;
      }
    }
    this.dropAt(tiers, dirty, drops);
    return evicted;
  }

  /**
   * Remember the games `evictOldestGames` dropped, once their commit landed
   * (a failed commit puts the rows back, so their games are not evicted).
   * Bounded: the oldest id is forgotten past `EVICTED_GAMES_MAX`.
   */
  private rememberEvictedGames(): void {
    for (const id of this.evictedNow) {
      this.evictedGames.delete(id);
      this.evictedGames.add(id);
    }
    this.evictedNow = [];
    for (const id of this.evictedGames) {
      if (this.evictedGames.size <= EVICTED_GAMES_MAX) break;
      this.evictedGames.delete(id);
    }
  }

  /** Take one row out of the stats and off the overage. */
  private drop(row: Row, overage: Overage): void {
    overage.bytes -= this.sizeOf(row);
    overage.rows -= 1;
    this.untrack(row);
  }

  /**
   * The oldest `created_at` in the mirror. Kept up to date by inserts; after
   * the oldest row leaves it is found again by one pass over the rows, here,
   * on demand — never on the mutation itself (a flush deletes the oldest rows
   * chunk after chunk).
   */
  private resolveOldestAt(tiers: Tiers): number | null {
    if (this.oldestDirty) {
      let oldest: number | null = null;
      for (const tier of TIERS) {
        for (const chunk of tiers[tier]) {
          for (const row of chunk.rows) {
            if (oldest === null || row.created_at < oldest) oldest = row.created_at;
          }
        }
      }
      this.oldestAt = oldest;
      this.oldestDirty = false;
    }
    return this.oldestAt;
  }

  private statsUnlocked(tiers: Tiers): QueueStats {
    return { ...this.countsUnlocked(tiers), oldestAt: this.resolveOldestAt(tiers) };
  }

  private countsUnlocked(tiers: Tiers): QueueCounts {
    return {
      totalRows: this.totalRows,
      sizeBytes: this.sizeBytes,
      byLogType: { ...this.byLogType },
      byPriority: perTier((tier) => tierLength(tiers[tier])),
    };
  }

  /**
   * Tell every `onStats` subscriber the counts after a change. Call under the
   * lock. The counts are kept per row, so a change costs no pass over the rows;
   * `oldestAt` would, and is left to `stats()`.
   */
  private notify(): void {
    if (this.listeners.size === 0 || this.tiers === null) return;
    const stats = this.countsUnlocked(this.tiers);
    for (const listener of this.listeners) {
      try {
        listener(stats);
      } catch (e) {
        Sentry.captureException(e, { tags: { subsystem: "eventStore", op: "onStats" } });
      }
    }
  }

  /**
   * The payload the mirror keeps (`stored`) and the one handed back on the
   * returned row (`returned`). The mirror's is a JSON round-trip of the
   * caller's object, so the mirror owns what it holds: however the caller's
   * object changes afterwards, the next write of its chunk serialises what
   * was enqueued. The returned row carries the caller's own object — the
   * caller owns it, and gameEventClient never reads the row — so nothing is
   * parsed for it. An enqueue therefore serialises three things: the payload
   * here (the size cap needs it), the row in `sizeOf` (its size) and its
   * chunk in `writeOp`; never the queue's other chunks.
   */
  private ownPayload(
    payload: Record<string, unknown>,
    maxBytes: number
  ): { stored: Record<string, unknown>; returned: Record<string, unknown> } {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= maxBytes) {
      return { stored: JSON.parse(serialized) as Record<string, unknown>, returned: payload };
    }
    // Oversized — replace with a stub. This preserves the enqueue contract
    // (payload is always an object) while preventing a single runaway row
    // from blowing the queue. The mirror retains `stored` by reference, so
    // the returned stub is a copy (two fields; off the normal path).
    const stub = { _truncated: true, _original_bytes: serialized.length };
    return { stored: stub, returned: { ...stub } };
  }
}

export const eventStore = new EventStore();
