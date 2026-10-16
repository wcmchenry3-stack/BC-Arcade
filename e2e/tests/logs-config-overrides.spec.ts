/**
 * #480 scenario 12 — Configurable thresholds verification.
 *
 * Proves runtime overrides actually flow through to eventStore (MAX_ROWS)
 * and bugReportLimiter (burst + refill). Doubles as a regression gate if
 * anyone refactors logConfig consumption from live-read to frozen-const.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  inspectQueue,
  reportBug,
  resetLogConfig,
  seedEvents,
  waitForLogstoreReady,
  withLogConfigOverride,
} from "./helpers/logstore";

test.describe("#480 scenario 12 — logConfig runtime overrides", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("MAX_ROWS override clamps the queue", async ({ page }) => {
    await withLogConfigOverride(page, { MAX_ROWS: 100 }, async () => {
      await seedEvents(page, { count: 200, eventType: "diagnostic" });
      const stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(100);
    });
  });

  test("REPORT_BUG rate limit clamps the number of bug logs that land", async ({
    page,
  }) => {
    // Override BOTH the per-minute rate AND the burst allowance. The
    // initial token count = burst, so without this override the first 20
    // reports would always succeed (default burst), not 3.
    await withLogConfigOverride(
      page,
      {
        REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE: 3,
        REPORT_BUG_BURST_ALLOWANCE: 3,
      },
      async () => {
        for (let i = 0; i < 10; i += 1) {
          await reportBug(page, { source: "runaway" });
        }
        // reportBug is fire-and-forget internally; let the AsyncStorage
        // writes land before reading stats.
        await page.waitForTimeout(100);
        const stats = await inspectQueue(page);
        expect(stats.byLogType.bug_log).toBe(3);
      },
    );
  });

  test("combined override: 100 event cap + 3 bug log burst, mixed seed", async ({
    page,
  }) => {
    await withLogConfigOverride(
      page,
      {
        MAX_ROWS: 100,
        REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE: 3,
        REPORT_BUG_BURST_ALLOWANCE: 3,
      },
      async () => {
        // 200 events + 10 bug reports. Expected:
        //   queue total capped at 100
        //   bug logs land = 3 (rest dropped by limiter before enqueue)
        //   game events = 97 (because of the hard cap)
        await seedEvents(page, { count: 200, eventType: "diagnostic" });
        for (let i = 0; i < 10; i += 1) {
          await reportBug(page, { source: "runaway" });
        }
        await page.waitForTimeout(100);

        const stats = await inspectQueue(page);
        expect(stats.totalRows).toBe(100);
        expect(stats.byLogType.bug_log).toBe(3);
        expect(stats.byLogType.game_event).toBe(97);
      },
    );
  });

  test("reset restores defaults — follow-up seed respects the normal cap", async ({
    page,
  }) => {
    await withLogConfigOverride(page, { MAX_ROWS: 10 }, async () => {
      await seedEvents(page, { count: 50 });
      expect((await inspectQueue(page)).totalRows).toBe(10);
    });
    // After the override, default MAX_ROWS=5000 is in effect.
    await clearLogstore(page);
    await seedEvents(page, { count: 50 });
    expect((await inspectQueue(page)).totalRows).toBe(50);
  });
});
