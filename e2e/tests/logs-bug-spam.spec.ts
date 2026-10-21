/**
 * #373 scenario 13 — runaway bug-log pressure doesn't starve lifecycle or
 * fresh granular events.
 *
 * This scenario was deferred from #480 and motivated the eviction-policy
 * rewrite in #486. See the file header on `frontend/src/game/_shared/
 * eventStore.ts` for the policy in force.
 *
 * Two phases:
 *
 *   Part 1 — bug spam crowds the queue to the cap.
 *     Seed 1 `game_ended` (P1 lifecycle) + 4,999 bug logs (P0), exactly
 *     hitting MAX_ROWS = 5,000. Seed 100 more bug logs. Eviction must
 *     drop the 100 OLDEST bug logs while the lifecycle row survives —
 *     P1 is protected and the 100 new bugs are the newest pool rows.
 *
 *   Part 2 — fresh granular burst arrives after the bug backlog.
 *     From Part 1's 1 P1 + 4,999 P0, enqueue 5,000 P3 `move` events.
 *     Queue swells to 10,000 → evict 5,000. Under age-based pool
 *     eviction, the 5,000 oldest pool rows are all 4,999 bug logs plus
 *     1 granular — but the assertion from the epic is that the final
 *     queue is "1 P1 + 0 P0 + 4,999 P3". In other words, every bug log
 *     must be gone and the newest granular burst must dominate.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  inspectQueue,
  resetLogConfig,
  seedBugLogs,
  seedEvents,
  waitForLogstoreReady,
} from "./helpers/logstore";

test.describe("#373 scenario 13 — runaway bug-log pressure (#486)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("age-based pool eviction protects lifecycle and favors fresh events", async ({
    page,
  }) => {
    // Stagger timestamps so the seed order equals the age order.
    // TTL is 7 days; every slot stays comfortably within the past.
    const now = Date.now();
    const SLOT = 10_000_000;
    const tP1 = now - 4 * SLOT;
    const tBugsOld = now - 3 * SLOT;
    const tBugsNew = now - 2 * SLOT;
    const tMoves = now - 1 * SLOT;

    // ---- Part 1 ----------------------------------------------------------
    // 1 P1 game_ended + 4,999 bug logs = 5,000 (exactly at cap).
    await seedEvents(page, {
      count: 1,
      priority: 1,
      eventType: "game_ended",
      createdAt: tP1,
    });
    await seedBugLogs(page, { count: 4999, createdAt: tBugsOld });

    let stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(5000);
    expect(stats.byPriority[1]).toBe(1);
    expect(stats.byPriority[0]).toBe(4999);

    // +100 bug logs — queue is 5,100 → evict 100 oldest pool rows.
    // Expectation: 100 oldest bugs gone, the 100 new bugs survive, the
    // lone lifecycle event is untouched.
    await seedBugLogs(page, { count: 100, createdAt: tBugsNew });

    stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(5000);
    expect(stats.byPriority[1]).toBe(1); // game_ended preserved
    expect(stats.byPriority[0]).toBe(4999); // 4899 old + 100 new bugs
    expect(stats.byPriority[3]).toBe(0);
    expect(stats.byPriority[2]).toBe(0);

    // ---- Part 2 ----------------------------------------------------------
    // +5,000 P3 move events — queue is 10,000 → evict 5,000 oldest pool
    // rows. Those are every bug log + 1 of the newly-added moves.
    // Final queue: 1 P1 + 0 P0 + 4,999 P3.
    await seedEvents(page, {
      count: 5000,
      priority: 3,
      eventType: "diagnostic",
      createdAt: tMoves,
    });

    stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(5000);
    expect(stats.byPriority[1]).toBe(1); // game_ended still present
    expect(stats.byPriority[0]).toBe(0); // all bug logs evicted
    expect(stats.byPriority[2]).toBe(0);
    expect(stats.byPriority[3]).toBe(4999); // fresh move burst dominates
    expect(stats.byLogType.bug_log).toBe(0);
    expect(stats.byLogType.game_event).toBe(5000);
  });
});
