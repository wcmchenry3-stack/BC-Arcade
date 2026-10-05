/**
 * Bounded local event queue for #367.
 *
 * Storage engine: AsyncStorage, sharded by priority tier. Each tier lives
 * under its own key so an enqueue only rewrites the affected tier — at
 * 5,000 rows across 4 tiers the largest rewrite is ~1 MB, not 5 MB.
 *
 *   event_queue_v1/tier/0   → bug logs (P0, preserved longest)
 *   event_queue_v1/tier/1   → lifecycle (P1)
 *   event_queue_v1/tier/2   → mid (P2)
 *   event_queue_v1/tier/3   → granular events (P3, evicted first)
 *   event_queue_v1/meta     → { warningLastShownAt }
 *
 * In-memory mirror (#2959): the four tiers are loaded from AsyncStorage once,
 * by the first operation, and kept in memory for the life of the process.
 * Every mutation changes the mirror and writes the changed tier(s) back
 * (write-through), so the on-disk format is exactly what it always was. The
 * invariant is per tier: the mirror holds what the disk holds. A tier whose
 * write fails goes back to what the disk still has (`transact`); a mutation
 * that touches several tiers can therefore land in part — exactly what a
 * crash between two tier writes could do before the mirror — and the caller
 * sees the rejection either way.
 * `peek`, `stats`, `updateRows`, `deleteByIds` and `markDeadLettered` read
 * only the mirror; `readTier` runs only for the initial load (and, inside it,
 * for corruption recovery). `totalRows` and `sizeBytes` are kept up to date
 * per row, so the capacity check after an enqueue is O(1) while the queue is
 * under its caps. A game move therefore costs one write of its own tier — not
 * a re-read of that tier, a re-read of every tier and a re-serialisation of
 * every row to count bytes, which is what it cost before.
 *
 * `onStats(listener)` tells subscribers (the capacity-warning toast) the new
 * stats after each mutation, so nothing has to poll the queue.
 *
 * Eviction policy at cap (#486 redesign):
 *
 *   1. P1 (lifecycle) is protected — never evicted unless the entire
 *      non-P1 pool has already been drained. Lifecycle events are the
 *      load-bearing story of a game (started / ended / resumed); losing
 *      them silently corrupts analytics in a way no granular event can.
 *      The epic's "FIFO-evictable at the hard cap" language still holds —
 *      P1 is last-to-evict, not never-evict — so a pathological caller
 *      filling the queue with only lifecycle events still drains via FIFO.
 *
 *   2. The rest of the queue (P0 bug logs, P2 mid, P3 granular) is one
 *      age-based FIFO pool. Eviction drops the oldest rows across that
 *      combined pool until the overage is covered, ignoring tier. Newer
 *      rows survive regardless of tier — a fresh spam of P3 moves that
 *      arrives after 5,000 ancient bug logs should evict the ancient bugs,
 *      not the moves that just arrived.
 *
 *   3. logConfig.priorityForEvent still decides peek order (SyncWorker
 *      drains P1 → P2 → P3 → P0) and still feeds the capacity-warning
 *      signal. Only the eviction ordering changes.
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
import { generateUUID } from "./uuid";

const STORAGE_PREFIX = "event_queue_v1";
const META_KEY = `${STORAGE_PREFIX}/meta`;
const TIER_KEYS: Record<Priority, string> = {
  0: `${STORAGE_PREFIX}/tier/0`,
  1: `${STORAGE_PREFIX}/tier/1`,
  2: `${STORAGE_PREFIX}/tier/2`,
  3: `${STORAGE_PREFIX}/tier/3`,
};
const TIERS: Priority[] = [0, 1, 2, 3];
/** The order SyncWorker drains: lifecycle → mid → granular → bug logs. */
const PEEK_ORDER: Priority[] = [
  Priority.LIFECYCLE,
  Priority.MID,
  Priority.GRANULAR,
  Priority.BUG_LOG,
];
/** The age-based eviction pool (#486); P1 is the last resort. */
const POOL_TIERS: Priority[] = [Priority.BUG_LOG, Priority.MID, Priority.GRANULAR];

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

/** The mirrored tiers, once loaded. */
type Tiers = Record<Priority, Row[]>;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyTiers(): Tiers {
  return { 0: [], 1: [], 2: [], 3: [] };
}

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

  /** The in-memory mirror of the four tiers; null until the first operation loads it. */
  private tiers: Tiers | null = null;
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
  // Internal read/write helpers (per-tier)
  // -------------------------------------------------------------------------

  /** Initial load and corruption recovery only; every other read is of the mirror. */
  private async readTier(tier: Priority): Promise<Row[]> {
    const raw = await AsyncStorage.getItem(TIER_KEYS[tier]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Row[]) : [];
    } catch {
      // Corrupted tier — drop it. Better to lose that tier than to fail
      // every future write.
      await AsyncStorage.removeItem(TIER_KEYS[tier]);
      return [];
    }
  }

  private async writeTier(tier: Priority, rows: Row[]): Promise<void> {
    if (rows.length === 0) {
      await AsyncStorage.removeItem(TIER_KEYS[tier]);
      return;
    }
    await AsyncStorage.setItem(TIER_KEYS[tier], JSON.stringify(rows));
  }

  /**
   * Write every tier in `dirty` back to disk, all at once. Returns the tiers
   * whose write failed, with the reason; empty when every write landed.
   */
  private async commit(tiers: Tiers, dirty: Set<Priority>): Promise<Map<Priority, unknown>> {
    const pending = TIERS.filter((tier) => dirty.has(tier));
    const outcomes = await Promise.allSettled(
      pending.map((tier) => this.writeTier(tier, tiers[tier]))
    );
    const failed = new Map<Priority, unknown>();
    outcomes.forEach((outcome, i) => {
      const tier = pending[i];
      if (tier !== undefined && outcome.status === "rejected") failed.set(tier, outcome.reason);
    });
    return failed;
  }

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
    // A load that fails part-way (a native read error on one tier) leaves
    // `this.tiers` null, so the next call loads again: start the counters
    // from zero here, or the tiers read before the failure would count twice.
    this.resetCounters();
    const tiers = emptyTiers();
    for (const tier of TIERS) {
      const rows = await this.readTier(tier);
      tiers[tier] = rows;
      for (const row of rows) this.track(row);
    }
    this.tiers = tiers;
    return tiers;
  }

  /**
   * Run one memory mutation and write the tiers it dirtied (#2959). `fn` must
   * only replace tier arrays (copy-on-write), never change one in place, so
   * that a tier whose write failed can get its saved array back. The invariant
   * is per tier: the mirror holds what the disk holds. A tier whose write
   * landed keeps its new rows; a tier whose write failed goes back to what the
   * disk still has; the counters are recounted from the arrays. So a mutation
   * over several tiers can land in part — as it could before the mirror, when
   * a crash between two tier writes left the first on disk and not the second
   * — and the caller sees the rejection either way. Subscribers hear of what
   * landed. Call under the lock.
   */
  private async transact<T>(fn: (tiers: Tiers, dirty: Set<Priority>) => T): Promise<T> {
    const tiers = await this.mirror();
    const saved = this.save(tiers);
    const dirty = new Set<Priority>();
    let result: T;
    try {
      result = fn(tiers, dirty);
    } catch (e) {
      this.restore(tiers, saved);
      throw e;
    }
    const failed = await this.commit(tiers, dirty);
    if (failed.size > 0) {
      for (const tier of failed.keys()) tiers[tier] = saved.tiers[tier];
      this.rebuildCounters(tiers);
      if (failed.size < dirty.size) this.notify();
      const [reason] = failed.values();
      throw reason;
    }
    if (dirty.size > 0) this.notify();
    return result;
  }

  private save(tiers: Tiers): MirrorState {
    return {
      tiers: { 0: tiers[0], 1: tiers[1], 2: tiers[2], 3: tiers[3] },
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

  /** Account for a row entering the mirror; a row measured before is not measured again. */
  private track(row: Row): void {
    const n = this.bytes.get(row) ?? this.rowBytes(row);
    this.bytes.set(row, n);
    this.totalRows += 1;
    this.sizeBytes += n;
    this.byLogType[row.log_type] += 1;
    if (!this.oldestDirty && (this.oldestAt === null || row.created_at < this.oldestAt)) {
      this.oldestAt = row.created_at;
    }
  }

  /** Account for a row leaving the mirror. */
  private untrack(row: Row): void {
    this.totalRows -= 1;
    this.sizeBytes -= this.bytes.get(row) ?? this.rowBytes(row);
    this.byLogType[row.log_type] -= 1;
    this.bytes.delete(row);
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

  /** Recount from the arrays, after a commit that landed in part. */
  private rebuildCounters(tiers: Tiers): void {
    this.resetCounters();
    for (const tier of TIERS) {
      for (const row of tiers[tier]) this.track(row);
    }
  }

  private resetMirror(): void {
    this.tiers = emptyTiers();
    this.resetCounters();
    this.meta = { warningLastShownAt: null };
  }

  /**
   * Drop every mirrored row `drop` matches, writing back only the tiers that
   * changed. Returns how many rows went.
   */
  private removeWhere(drop: (row: Row) => boolean): Promise<number> {
    return this.transact((tiers, dirty) => {
      let removed = 0;
      for (const tier of TIERS) {
        const rows = tiers[tier];
        const kept: Row[] = [];
        for (const row of rows) {
          if (drop(row)) {
            this.untrack(row);
            removed += 1;
          } else {
            kept.push(row);
          }
        }
        if (kept.length !== rows.length) {
          tiers[tier] = kept;
          dirty.add(tier);
        }
      }
      return removed;
    });
  }

  /**
   * Replace every mirrored row `replace` returns a row for (null leaves it),
   * writing back only the tiers that changed. Returns how many were replaced.
   */
  private replaceWhere(replace: (row: Row) => Row | null): Promise<number> {
    return this.transact((tiers, dirty) => {
      let replaced = 0;
      for (const tier of TIERS) {
        const rows = tiers[tier];
        let copy: Row[] | null = null;
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          if (row === undefined) continue;
          const next = replace(row);
          if (next === null) continue;
          if (copy === null) copy = rows.slice();
          this.untrack(row);
          this.track(next);
          copy[i] = next;
          replaced += 1;
        }
        if (copy !== null) {
          tiers[tier] = copy;
          dirty.add(tier);
        }
      }
      return replaced;
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async enqueueEvent(input: {
    game_id: string;
    event_index: number;
    event_type: string;
    payload: Record<string, unknown>;
  }): Promise<GameEventRow> {
    return this.withLock(async () => {
      await this.maybeDelay();
      const priority = logConfig.priorityForEvent("game_event", input.event_type);
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
      await this.insert(row);
      return { ...row, payload: payload.returned };
    });
  }

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
      await this.insert(row);
      return { ...row, payload: payload.returned };
    });
  }

  /**
   * Append one row to its tier, evict to capacity, and write the tiers that
   * changed once. The callers return a copy of the row with the caller's own
   * payload: the mirror's object and its parsed payload are never handed out,
   * so nothing outside can change them (or the cached size) behind the
   * store's back.
   */
  private insert(row: Row): Promise<void> {
    return this.transact((tiers, dirty) => {
      tiers[row.priority] = tiers[row.priority].concat(row);
      this.track(row);
      dirty.add(row.priority);
      this.evictToCapacityUnlocked(tiers, dirty);
    });
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
        const rows = tiers[tier].slice();
        rows.sort((a, b) => a.created_at - b.created_at);
        for (const row of rows) {
          if (!opts.includeDeadLettered && row.dead_lettered) continue;
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

  async clearAll(): Promise<void> {
    return this.withLock(async () => {
      for (const tier of TIERS) await AsyncStorage.removeItem(TIER_KEYS[tier]);
      await AsyncStorage.removeItem(META_KEY);
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
    return this.withLock(() =>
      this.transact((tiers, dirty) => {
        const byTier = emptyTiers();
        // Copies, payload included: the caller keeps its objects, the mirror
        // keeps its own (a test fixture, so the round-trip per row is fine).
        for (const row of rows) {
          byTier[row.priority].push({
            ...row,
            payload: JSON.parse(JSON.stringify(row.payload)) as Record<string, unknown>,
          });
        }
        for (const tier of TIERS) {
          if (byTier[tier].length === 0) continue;
          tiers[tier] = tiers[tier].concat(byTier[tier]);
          for (const row of byTier[tier]) this.track(row);
          dirty.add(tier);
        }
        this.evictToCapacityUnlocked(tiers, dirty);
      })
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
   * #486 policy: age-based FIFO across the combined non-P1 pool, with P1
   * (lifecycle) as a last-resort drain once the pool is exhausted. See the
   * file header for the full rationale.
   */
  private evictToCapacityUnlocked(tiers: Tiers, dirty: Set<Priority>): number {
    const overage: Overage = {
      rows: this.totalRows - logConfig.MAX_ROWS,
      bytes: this.sizeBytes - logConfig.MAX_SIZE_BYTES,
    };
    if (!overCap(overage)) return 0;
    let evicted = this.evictPool(tiers, overage, dirty);
    // Last-resort: the whole non-P1 pool couldn't cover the overage.
    // Drop oldest P1 rows until the cap is met. This only fires when the
    // queue is pathologically full of lifecycle events; normal workloads
    // never touch this branch.
    if (overCap(overage)) evicted += this.evictLifecycle(tiers, overage, dirty);
    return evicted;
  }

  private evictPool(tiers: Tiers, overage: Overage, dirty: Set<Priority>): number {
    type Candidate = { tier: Priority; idx: number; row: Row };
    const pool: Candidate[] = [];
    for (const tier of POOL_TIERS) {
      tiers[tier].forEach((row, idx) => pool.push({ tier, idx, row }));
    }
    // Primary key: older first. Tiebreaker: when two rows share a
    // created_at (serial enqueues inside the same millisecond, common in
    // tests and during bursts), prefer evicting the row with the higher
    // priority *number* — i.e. drop P3 before P2 before P0, so bug logs
    // still win ties against granular events. Without this tiebreaker
    // the stable-sort insertion order would arbitrarily decide which
    // tier loses.
    pool.sort((a, b) => a.row.created_at - b.row.created_at || b.tier - a.tier);

    const dropped: Record<Priority, Set<number>> = {
      0: new Set(),
      1: new Set(),
      2: new Set(),
      3: new Set(),
    };
    let evicted = 0;
    for (const cand of pool) {
      if (!overCap(overage)) break;
      dropped[cand.tier].add(cand.idx);
      this.drop(cand.row, overage);
      evicted += 1;
    }
    for (const tier of POOL_TIERS) {
      const drop = dropped[tier];
      if (drop.size === 0) continue;
      tiers[tier] = tiers[tier].filter((_, i) => !drop.has(i));
      dirty.add(tier);
    }
    return evicted;
  }

  private evictLifecycle(tiers: Tiers, overage: Overage, dirty: Set<Priority>): number {
    const p1Rows = tiers[Priority.LIFECYCLE].slice();
    if (p1Rows.length === 0) return 0;
    p1Rows.sort((a, b) => a.created_at - b.created_at);
    let evicted = 0;
    while (evicted < p1Rows.length && overCap(overage)) {
      const r = p1Rows[evicted];
      if (r === undefined) break;
      this.drop(r, overage);
      evicted += 1;
    }
    if (evicted > 0) {
      tiers[Priority.LIFECYCLE] = p1Rows.slice(evicted);
      dirty.add(Priority.LIFECYCLE);
    }
    return evicted;
  }

  /** Take one row out of the stats and off the overage. */
  private drop(row: Row, overage: Overage): void {
    overage.bytes -= this.bytes.get(row) ?? this.rowBytes(row);
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
        for (const row of tiers[tier]) {
          if (oldest === null || row.created_at < oldest) oldest = row.created_at;
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
      byPriority: {
        0: tiers[0].length,
        1: tiers[1].length,
        2: tiers[2].length,
        3: tiers[3].length,
      },
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
   * object changes afterwards, the next write of the tier serialises what was
   * enqueued, as the disk held it before the mirror existed. The returned row
   * carries the caller's own object — the caller owns it, and gameEventClient
   * never reads the row — so nothing is parsed for it. An enqueue therefore
   * serialises three things: the payload here (the size cap needs it), the
   * row in `track` (its size) and its tier in `writeTier`; never the queue's
   * other rows.
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
    // from blowing the queue.
    const stub = { _truncated: true, _original_bytes: serialized.length };
    return { stored: stub, returned: { ...stub } };
  }
}

export const eventStore = new EventStore();
