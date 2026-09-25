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
 * All operations are single-writer — the store itself is not concurrency-
 * safe within one JS runtime, but the FE is single-threaded so that's fine.
 * A mutex-free serial queue would be the upgrade path if that changes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowBytes(row: Row): number {
  // Approximate — JSON.stringify length is UTF-16 char count, and we treat
  // it as a size proxy. For ASCII payloads this matches byte count; for
  // non-ASCII it slightly under-counts, which is fine for a soft cap.
  return JSON.stringify(row).length;
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

  private async readMeta(): Promise<MetaState> {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return { warningLastShownAt: null };
    try {
      return JSON.parse(raw) as MetaState;
    } catch {
      return { warningLastShownAt: null };
    }
  }

  private async writeMeta(meta: MetaState): Promise<void> {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
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
      const row: GameEventRow = {
        id: generateUUID(),
        log_type: "game_event",
        game_id: input.game_id,
        event_index: input.event_index,
        event_type: input.event_type,
        payload: this.truncatePayload(input.payload, logConfig.MAX_EVENT_PAYLOAD_BYTES),
        created_at: Date.now(),
        priority,
        retry_count: 0,
        next_retry_at: null,
      };
      const tier = await this.readTier(priority);
      tier.push(row);
      await this.writeTier(priority, tier);
      await this.evictToCapacityUnlocked();
      return row;
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
      const row: BugLogRow = {
        id: generateUUID(),
        log_type: "bug_log",
        bug_uuid: input.bug_uuid,
        bug_level: input.bug_level,
        bug_source: input.bug_source,
        payload: this.truncatePayload(input.payload, logConfig.MAX_BUG_CONTEXT_BYTES),
        created_at: Date.now(),
        priority: Priority.BUG_LOG,
        retry_count: 0,
        next_retry_at: null,
      };
      const tier = await this.readTier(Priority.BUG_LOG);
      tier.push(row);
      await this.writeTier(Priority.BUG_LOG, tier);
      await this.evictToCapacityUnlocked();
      return row;
    });
  }

  /**
   * Peek the N oldest rows across tiers, ordered by (priority desc,
   * created_at asc). SyncWorker uses this to build batches. Deleted rows
   * are the caller's responsibility — we don't mark peeked rows in any way.
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
      const out: Row[] = [];
      for (const tier of [Priority.LIFECYCLE, Priority.MID, Priority.GRANULAR, Priority.BUG_LOG]) {
        const rows = (await this.readTier(tier)).slice();
        rows.sort((a, b) => a.created_at - b.created_at);
        for (const row of rows) {
          if (!opts.includeDeadLettered && row.dead_lettered) continue;
          if (!opts.includeFuture && row.next_retry_at !== null && row.next_retry_at > now) {
            continue;
          }
          out.push(row);
          if (out.length >= limit) return out;
        }
      }
      return out;
    });
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.withLock(async () => {
      const set = new Set(ids);
      let removed = 0;
      for (const tier of TIERS) {
        const rows = await this.readTier(tier);
        const kept = rows.filter((r) => !set.has(r.id));
        removed += rows.length - kept.length;
        if (kept.length !== rows.length) {
          await this.writeTier(tier, kept);
        }
      }
      return removed;
    });
  }

  /**
   * Delete every game-event row of the given games, dead-lettered or backed
   * off included. Used for sessions the player never started (#2654), whose
   * events never left the device. Returns the number of rows removed.
   */
  async deleteGameEvents(gameIds: string[]): Promise<number> {
    if (gameIds.length === 0) return 0;
    return this.withLock(async () => {
      const set = new Set(gameIds);
      let removed = 0;
      for (const tier of TIERS) {
        const rows = await this.readTier(tier);
        const kept = rows.filter((r) => !(r.log_type === "game_event" && set.has(r.game_id)));
        removed += rows.length - kept.length;
        if (kept.length !== rows.length) {
          await this.writeTier(tier, kept);
        }
      }
      return removed;
    });
  }

  /**
   * Update a batch of rows (e.g. after a 429 sets next_retry_at on them).
   * Rows are matched by id; missing rows are silently ignored.
   */
  async updateRows(updated: Row[]): Promise<void> {
    if (updated.length === 0) return;
    return this.withLock(async () => {
      const byId = new Map(updated.map((r) => [r.id, r]));
      for (const tier of TIERS) {
        const rows = await this.readTier(tier);
        let mutated = false;
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          if (row === undefined) continue;
          const replacement = byId.get(row.id);
          if (replacement) {
            rows[i] = replacement;
            mutated = true;
          }
        }
        if (mutated) await this.writeTier(tier, rows);
      }
    });
  }

  async sweepTTL(now: number = Date.now()): Promise<number> {
    return this.withLock(async () => {
      const cutoff = now - logConfig.TTL_MS;
      let removed = 0;
      for (const tier of TIERS) {
        const rows = await this.readTier(tier);
        const kept = rows.filter((r) => r.created_at >= cutoff);
        removed += rows.length - kept.length;
        if (kept.length !== rows.length) {
          await this.writeTier(tier, kept);
        }
      }
      return removed;
    });
  }

  async stats(): Promise<QueueStats> {
    return this.withLock(async () => this.statsUnlocked());
  }

  async clearAll(): Promise<void> {
    return this.withLock(async () => {
      for (const tier of TIERS) await AsyncStorage.removeItem(TIER_KEYS[tier]);
      await AsyncStorage.removeItem(META_KEY);
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
    return this.withLock(async () => {
      const byTier: Record<Priority, Row[]> = { 0: [], 1: [], 2: [], 3: [] };
      for (const row of rows) byTier[row.priority].push(row);
      for (const tier of TIERS) {
        if (byTier[tier].length === 0) continue;
        const existing = await this.readTier(tier);
        await this.writeTier(tier, existing.concat(byTier[tier]));
      }
      await this.evictToCapacityUnlocked();
    });
  }

  /** Capacity warning state (read/updated by gameEventClient). */
  async shouldShowCapacityWarning(stats?: QueueStats, now: number = Date.now()): Promise<boolean> {
    return this.withLock(async () => {
      const s = stats ?? (await this.statsUnlocked());
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
   * Public, lock-free entry point for tests and scenarios where the caller
   * already holds the lock. Callers outside the class should prefer
   * evictToCapacity().
   */
  async evictToCapacity(): Promise<number> {
    return this.withLock(async () => this.evictToCapacityUnlocked());
  }

  private async evictToCapacityUnlocked(): Promise<number> {
    // #486 policy: age-based FIFO across the combined non-P1 pool, with
    // P1 (lifecycle) as a last-resort drain once the pool is exhausted.
    // See the file header for the full rationale. All reads and writes
    // are batched one-per-tier so seeding 10k rows stays O(tiers) on
    // AsyncStorage rather than O(overage).
    const stats = await this.statsUnlocked();
    let overageRows = stats.totalRows - logConfig.MAX_ROWS;
    let overageBytes = stats.sizeBytes - logConfig.MAX_SIZE_BYTES;
    if (overageRows <= 0 && overageBytes <= 0) return 0;

    const poolTiers: Priority[] = [Priority.BUG_LOG, Priority.MID, Priority.GRANULAR];

    type TierEntry = { tier: Priority; rows: Row[]; dirty: boolean };
    const entries: Record<Priority, TierEntry | undefined> = {
      0: undefined,
      1: undefined,
      2: undefined,
      3: undefined,
    };

    type Candidate = { tier: Priority; idx: number; row: Row };
    const pool: Candidate[] = [];
    for (const tier of poolTiers) {
      const rows = await this.readTier(tier);
      if (rows.length === 0) continue;
      entries[tier] = { tier, rows, dirty: false };
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row !== undefined) pool.push({ tier, idx: i, row });
      }
    }
    // Primary key: older first. Tiebreaker: when two rows share a
    // created_at (serial enqueues inside the same millisecond, common in
    // tests and during bursts), prefer evicting the row with the higher
    // priority *number* — i.e. drop P3 before P2 before P0, so bug logs
    // still win ties against granular events. Without this tiebreaker
    // the stable-sort insertion order would arbitrarily decide which
    // tier loses.
    pool.sort((a, b) => a.row.created_at - b.row.created_at || b.tier - a.tier);

    let totalEvicted = 0;
    const dropped: Record<Priority, Set<number>> = {
      0: new Set(),
      1: new Set(),
      2: new Set(),
      3: new Set(),
    };

    for (const cand of pool) {
      if (overageRows <= 0 && overageBytes <= 0) break;
      dropped[cand.tier].add(cand.idx);
      overageBytes -= rowBytes(cand.row);
      overageRows -= 1;
      totalEvicted += 1;
    }

    for (const tier of poolTiers) {
      const entry = entries[tier];
      if (!entry) continue;
      const drop = dropped[tier];
      if (drop.size === 0) continue;
      entry.rows = entry.rows.filter((_, i) => !drop.has(i));
      entry.dirty = true;
    }

    // Last-resort: the whole non-P1 pool couldn't cover the overage.
    // Drop oldest P1 rows until the cap is met. This only fires when the
    // queue is pathologically full of lifecycle events; normal workloads
    // never touch this branch.
    if (overageRows > 0 || overageBytes > 0) {
      const p1Rows = (await this.readTier(Priority.LIFECYCLE)).slice();
      if (p1Rows.length > 0) {
        p1Rows.sort((a, b) => a.created_at - b.created_at);
        let drop = 0;
        while (drop < p1Rows.length && (overageRows > 0 || overageBytes > 0)) {
          const r = p1Rows[drop];
          if (r === undefined) break;
          overageBytes -= rowBytes(r);
          overageRows -= 1;
          drop += 1;
          totalEvicted += 1;
        }
        if (drop > 0) {
          await this.writeTier(Priority.LIFECYCLE, p1Rows.slice(drop));
        }
      }
    }

    for (const tier of poolTiers) {
      const entry = entries[tier];
      if (entry && entry.dirty) {
        await this.writeTier(tier, entry.rows);
      }
    }

    return totalEvicted;
  }

  private async statsUnlocked(): Promise<QueueStats> {
    const byPriority: Record<Priority, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const byLogType: Record<LogType, number> = { game_event: 0, bug_log: 0 };
    let totalRows = 0;
    let sizeBytes = 0;
    let oldestAt: number | null = null;

    for (const tier of TIERS) {
      const rows = await this.readTier(tier);
      byPriority[tier] += rows.length;
      totalRows += rows.length;
      for (const row of rows) {
        byLogType[row.log_type] += 1;
        sizeBytes += rowBytes(row);
        if (oldestAt === null || row.created_at < oldestAt) {
          oldestAt = row.created_at;
        }
      }
    }
    return { totalRows, sizeBytes, byLogType, byPriority, oldestAt };
  }

  private truncatePayload(
    payload: Record<string, unknown>,
    maxBytes: number
  ): Record<string, unknown> {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= maxBytes) return payload;
    // Oversized — replace with a stub. This preserves the enqueue contract
    // (payload is always an object) while preventing a single runaway row
    // from blowing the queue.
    return {
      _truncated: true,
      _original_bytes: serialized.length,
    };
  }
}

export const eventStore = new EventStore();
