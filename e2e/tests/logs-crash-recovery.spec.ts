/**
 * #481 scenario 9 — Crash recovery.
 *
 * Seeds 50 events into the queue without flushing, then "crashes" the
 * page via page.reload(). Asserts the seeded rows are still in the
 * queue on the next load. With the network online (default 200), the
 * next flush drains the queue cleanly.
 *
 * AsyncStorage is persisted by the browser (localStorage under the
 * hood in Expo Web), so reload preserves it as long as Playwright
 * doesn't clear storage between navigations — which it doesn't within
 * a single `page` instance.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  getBackoffUntil,
  inspectQueue,
  mockSyncEndpoints,
  resetLogConfig,
  triggerFlush,
  waitForLogstoreReady,
} from "./helpers/logstore";

test.describe("#481 scenario 9 — crash recovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("reload preserves queued rows and a subsequent flush drains them", async ({
    page,
  }) => {
    // Seed 50 events before any flush. No mock yet — we do NOT want the
    // running syncWorker interval to drain them before the reload.
    const gameId = await page.evaluate(() => {
      return (
        globalThis as unknown as {
          __gameEventClient_startGame: (t: string) => string;
        }
      ).__gameEventClient_startGame("yacht");
    });
    await page.evaluate(
      (args: { gameId: string; count: number }) => {
        const g = globalThis as unknown as {
          __gameEventClient_enqueueEvent: (
            id: string,
            ev: { type: string; data?: Record<string, unknown> },
          ) => void;
        };
        for (let i = 0; i < args.count; i += 1) {
          g.__gameEventClient_enqueueEvent(args.gameId, {
            type: "roll",
            data: { i },
          });
        }
      },
      { gameId, count: 49 },
    );

    // 1 game_started + 49 rolls = 50 rows queued.
    let stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(50);
    const beforeReload = stats;

    // "Crash" — reload. Playwright preserves storage for the same page.
    await page.reload();
    await waitForLogstoreReady(page);

    // All rows are still there. The exact count depends on whether the
    // reloaded NetworkProvider fires any auto-events on mount; assert the
    // queue didn't SHRINK (which would violate the crash-recovery
    // invariant — no row can be deleted pre-sync).
    stats = await inspectQueue(page);
    expect(stats.totalRows).toBeGreaterThanOrEqual(beforeReload.totalRows);
    expect(stats.byLogType.game_event).toBeGreaterThanOrEqual(
      beforeReload.byLogType.game_event,
    );

    // Install a 200 mock so the reloaded page's SyncWorker can drain.
    // (Without the mock it would hit the real localhost:8000 that isn't
    // running, get a network error, and back off.)
    const mock = mockSyncEndpoints(page);
    await mock.install();

    // The reloaded app already tried once: HomeScreen flushes on mount, and
    // since #2654 that flush waits for the pending games to load, so it really
    // POSTs the queued game to the unmocked backend, fails, and backs off.
    // Wait the backoff out (and any flush still in flight), then drain.
    await expect
      .poll(
        async () => {
          if ((await getBackoffUntil(page)) <= Date.now()) {
            await triggerFlush(page);
          }
          return (await inspectQueue(page)).totalRows;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
  });
});
