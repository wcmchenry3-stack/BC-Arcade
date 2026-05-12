/**
 * AsyncStorage-backed queue of pending score submissions.
 *
 * When a game finishes while the device is offline (or a submission fails
 * for any reason), the score is enqueued locally. The queue is flushed
 * automatically when network connectivity returns — see NetworkContext.
 *
 * Each pending item has a client-generated UUID v4 that will eventually
 * serve as the backend idempotency key (`game_id`, see issue #155) so
 * retries cannot create duplicate leaderboard rows. Until #155 lands,
 * the queue tracks its own `synced` flag (by removing items on success)
 * which is sufficient except in the rare case where a submission succeeds
 * but its response is lost — that case produces at most one duplicate row.
 *
 * The queue is agnostic about per-game submission details: each game
 * registers a handler via `registerHandler()`. `flush()` looks up the
 * right handler per item by its `game_type`.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { GameType, PendingSubmission, SubmitHandler } from "./types";
import { generateUUID } from "./uuid";

const STORAGE_KEY = "pending_score_queue_v1";
const MAX_SCORE_ATTEMPTS = 5;

export interface FlushResult {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export class ScoreQueue {
  private handlers = new Map<GameType, SubmitHandler>();
  private flushInProgress = false;

  registerHandler(gameType: GameType, handler: SubmitHandler): void {
    this.handlers.set(gameType, handler);
  }

  /** For tests only. */
  clearHandlers(): void {
    this.handlers.clear();
  }

  private async read(): Promise<PendingSubmission[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "scoreQueue", op: "read" } });
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      return [];
    }
  }

  private async write(items: PendingSubmission[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "scoreQueue", op: "write" } });
    }
  }

  async enqueue(
    gameType: GameType,
    payload: Record<string, unknown>,
    playedAt: Date = new Date()
  ): Promise<PendingSubmission> {
    const item: PendingSubmission = {
      id: generateUUID(),
      game_type: gameType,
      payload,
      played_at: playedAt.toISOString(),
      attempts: 0,
    };
    const queue = await this.read();
    queue.push(item);
    await this.write(queue);
    Sentry.addBreadcrumb({
      category: "scoreQueue",
      message: `enqueued ${gameType} score (queue size: ${queue.length})`,
      level: "info",
    });
    return item;
  }

  async peek(): Promise<PendingSubmission[]> {
    return this.read();
  }

  async size(): Promise<number> {
    return (await this.read()).length;
  }

  /**
   * Attempt to submit every pending item via its registered handler.
   * Successful items are removed; failed items stay in the queue with
   * an incremented attempt count and are retried on the next flush.
   *
   * Concurrent flush calls are a no-op beyond the first.
   */
  async flush(): Promise<FlushResult> {
    if (this.flushInProgress) {
      return { attempted: 0, succeeded: 0, failed: 0, remaining: await this.size() };
    }
    this.flushInProgress = true;
    try {
      const items = await this.read();
      if (items.length === 0) {
        return { attempted: 0, succeeded: 0, failed: 0, remaining: 0 };
      }
      const remaining: PendingSubmission[] = [];
      let succeeded = 0;
      let failed = 0;
      for (const item of items) {
        const handler = this.handlers.get(item.game_type);
        if (!handler) {
          // No handler registered — keep item for later but don't count as an
          // attempt (it never had a chance to succeed).
          remaining.push(item);
          continue;
        }
        try {
          await handler(item);
          succeeded += 1;
        } catch (e) {
          failed += 1;
          const nextAttempts = item.attempts + 1;
          if (nextAttempts >= MAX_SCORE_ATTEMPTS) {
            Sentry.captureMessage(
              `scoreQueue: dead-lettering ${item.game_type} score after ${nextAttempts} attempts`,
              {
                level: "warning",
                extra: { item, error: e instanceof Error ? e.message : String(e) },
              }
            );
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            remaining.push({ ...item, attempts: nextAttempts, last_error: msg });
          }
        }
      }
      await this.write(remaining);
      Sentry.addBreadcrumb({
        category: "scoreQueue",
        message: `flushed: ${succeeded} ok, ${failed} failed, ${remaining.length} remaining`,
        level: succeeded > 0 || failed === 0 ? "info" : "warning",
      });
      return {
        attempted: succeeded + failed,
        succeeded,
        failed,
        remaining: remaining.length,
      };
    } finally {
      this.flushInProgress = false;
    }
  }

  async dropByGameType(gameType: GameType): Promise<void> {
    // Skip if flush is in progress — reading/writing here would race with flush's
    // own read→process→write cycle and the drop could be overwritten.
    if (this.flushInProgress) return;
    const items = await this.read();
    const filtered = items.filter((item) => item.game_type !== gameType);
    if (filtered.length !== items.length) {
      await this.write(filtered);
    }
  }

  /** For tests only. */
  async _reset(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const scoreQueue = new ScoreQueue();
