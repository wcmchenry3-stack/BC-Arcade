/**
 * #480 scenario 5 — TTL sweep.
 *
 * Seeds 100 events with a created_at 8 days in the past and 100 events
 * from "yesterday" (within the 7-day TTL window). Runs the sweep and
 * asserts that only the recent 100 events remain.
 *
 * NOTE on production wiring: eventStore.sweepTTL() is exposed via the
 * #479 test hook (__eventStore_sweepTTL) but is NOT yet called from any
 * foreground / lifecycle effect in production code. Wiring a "sweep on
 * provider mount" or "sweep on visibilitychange=visible" is a separate
 * follow-up — this spec validates the sweep logic in isolation, not the
 * production trigger.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  inspectQueue,
  resetLogConfig,
  seedEvents,
  sweepTTL,
  waitForLogstoreReady,
  withLogConfigOverride,
} from "./helpers/logstore";

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe("#480 scenario 5 — TTL sweep", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("sweepTTL drops rows older than TTL_MS and keeps recent rows", async ({
    page,
  }) => {
    // Pin TTL to 7 days so the assertion is clock-independent.
    await withLogConfigOverride(page, { TTL_MS: 7 * DAY_MS }, async () => {
      const now = Date.now();
      const eightDaysAgo = now - 8 * DAY_MS;
      const yesterday = now - DAY_MS;

      // 100 stale rows (8 days old) + 100 recent rows (yesterday).
      await seedEvents(page, {
        count: 100,
        eventType: "diagnostic",
        createdAt: eightDaysAgo,
        gameId: "stale",
      });
      await seedEvents(page, {
        count: 100,
        eventType: "diagnostic",
        createdAt: yesterday,
        gameId: "recent",
      });

      let stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(200);

      // Run the sweep — pin `now` so the cutoff math is deterministic and
      // doesn't race wall-clock drift between seed and sweep.
      const removed = await sweepTTL(page, now);
      expect(removed).toBe(100);

      stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(100);
      // The 100 survivors are all the "recent" rows, so oldest_at should
      // equal the yesterday timestamp (seed adds +i offset per row).
      expect(stats.oldestAt).toBeGreaterThanOrEqual(yesterday);
      expect(stats.oldestAt).toBeLessThan(yesterday + 200);
    });
  });

  test("sweepTTL is a no-op when every row is within the TTL window", async ({
    page,
  }) => {
    await withLogConfigOverride(page, { TTL_MS: 7 * DAY_MS }, async () => {
      const now = Date.now();
      await seedEvents(page, { count: 50, createdAt: now - DAY_MS });
      const removed = await sweepTTL(page, now);
      expect(removed).toBe(0);
      const stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(50);
    });
  });

  test("sweepTTL respects a runtime TTL override", async ({ page }) => {
    // Shrink TTL to 1 hour; rows seeded 2 hours ago are stale.
    await withLogConfigOverride(page, { TTL_MS: 60 * 60 * 1000 }, async () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      await seedEvents(page, { count: 20, createdAt: twoHoursAgo });
      const removed = await sweepTTL(page, now);
      expect(removed).toBe(20);
      const stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(0);
    });
  });
});
