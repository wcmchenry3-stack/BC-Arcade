/**
 * AsyncStorage-backed queue of pending score submissions.
 *
 * When a game finishes while the device is offline (or a submission fails
 * for any reason), the score is enqueued locally. The queue is flushed
 * automatically when network connectivity returns — see NetworkContext.
 *
 * Items are removed on success, so a replay only happens when a submission
 * succeeds but its response is lost. What a replay does depends on the route:
 *
 * - **The display name is not in this queue.** It is one per player on the
 *   server (`PUT /players/me`, #2624, synced by `displayNameSync.ts`) and every
 *   board reads it from there, so there is no per-game name left to submit
 *   twice. Games on the session boards (Solitaire, Sudoku, FreeCell and
 *   Cascade since #2632) queue nothing here: their result cards only read the
 *   synced game's rank (`sessionBoardAdapter`).
 * - **Lost-response duplicates (#155) remain only for the legacy per-game
 *   `POST /<game>/score` handlers**, which insert a new leaderboard row on
 *   every call: Mahjong (`/mahjong/score`), Hearts (`/hearts/score`) and Star
 *   Swarm (`/starswarm/score`). A replay can add at most one duplicate row to
 *   that game's legacy board (never to the generic boards, which exclude those
 *   `*-anon` rows). Phase 2 of #2519 removes these handlers (Sort's went with
 *   #2625; Solitaire's and FreeCell's with #2632) and #2644 the routes.
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

  async clearAll(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  /** For tests only. */
  async _reset(): Promise<void> {
    await this.clearAll();
  }
}

export const scoreQueue = new ScoreQueue();
