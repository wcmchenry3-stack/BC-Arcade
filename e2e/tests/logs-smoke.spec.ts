/**
 * #479 — logstore e2e foundation smoke test.
 *
 * This spec is NOT one of the 13 acceptance-gate scenarios from #373. It
 * exists to prove every hook in `testHooks.ts` + every helper in
 * `helpers/logstore.ts` is wired correctly end-to-end. It should run fast
 * and stay green on every change to the harness.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  getBackoffUntil,
  inspectQueue,
  resetLogConfig,
  seedBugLogs,
  seedEvents,
  seedEvictionFixture,
  triggerFlush,
  waitForLogstoreReady,
  withLogConfigOverride,
} from "./helpers/logstore";

test.describe("#479 logstore e2e foundation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("queue starts empty on a fresh load", async ({ page }) => {
    const stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(0);
    expect(stats.sizeBytes).toBe(0);
    expect(stats.byPriority).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 });
  });

  test("seedEvents adds rows at the inferred priority", async ({ page }) => {
    await seedEvents(page, { count: 7, eventType: "diagnostic" });
    const stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(7);
    expect(stats.byPriority[3]).toBe(7); // GRANULAR
  });

  test("seedBugLogs adds rows at P0 and counts under bug_log log type", async ({
    page,
  }) => {
    await seedBugLogs(page, { count: 3 });
    const stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(3);
    expect(stats.byPriority[0]).toBe(3);
    expect(stats.byLogType.bug_log).toBe(3);
    expect(stats.byLogType.game_event).toBe(0);
  });

  test("seedEvictionFixture distributes rows across all four tiers", async ({
    page,
  }) => {
    await seedEvictionFixture(page, { p3: 10, p2: 5, p1: 3, p0: 2 });
    const stats = await inspectQueue(page);
    expect(stats.byPriority[3]).toBe(10);
    expect(stats.byPriority[2]).toBe(5);
    expect(stats.byPriority[1]).toBe(3);
    expect(stats.byPriority[0]).toBe(2);
    expect(stats.totalRows).toBe(20);
  });

  test("withLogConfigOverride mutates the runtime config and resets after", async ({
    page,
  }) => {
    await withLogConfigOverride(page, { MAX_ROWS: 25 }, async () => {
      // Confirm the override is live by seeding 200 rows and expecting eviction
      // to clamp to 25. This is the same mechanism #480 scenario 12 uses.
      await seedEvents(page, { count: 200, eventType: "diagnostic" });
      const stats = await inspectQueue(page);
      expect(stats.totalRows).toBe(25);
    });
    // After the override, config is reset. Seed again and verify the default
    // (5,000) cap is in effect — 200 rows should NOT be clamped.
    await clearLogstore(page);
    await seedEvents(page, { count: 200, eventType: "diagnostic" });
    const stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(200);
  });

  test("clearLogstore empties the queue", async ({ page }) => {
    await seedEvents(page, { count: 50 });
    await seedBugLogs(page, { count: 10 });
    let stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(60);
    await clearLogstore(page);
    stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(0);
  });

  test("triggerFlush resolves without throwing on an empty queue", async ({
    page,
  }) => {
    await triggerFlush(page);
    expect(await getBackoffUntil(page)).toBeGreaterThanOrEqual(0);
  });
});
