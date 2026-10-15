/**
 * #484 scenario 6 — Capacity warning UX.
 *
 * The last e2e scenario from the #373 acceptance gate (scenario 13 is
 * deferred to #486). Drives the real CapacityWarningToast component
 * that landed in #483.
 *
 * Flow:
 *   1. Override MAX_ROWS=100 and pin CAPACITY_WARNING_SUPPRESS_MS to a
 *      value that outlives the test so the 24h suppression actually
 *      gates on our dismiss event instead of racing wall clock.
 *   2. Seed 82 rows (82% fill) — crosses the 80% warning ratio.
 *   3. Wait for the toast's next poll cycle (the test build uses a
 *      500 ms interval instead of the production 30 s).
 *   4. Assert the toast becomes visible.
 *   5. Click Dismiss — markWarningShown() fires and activates the
 *      suppression window.
 *   6. Seed 10 more rows (92% fill — well above the threshold).
 *   7. Wait two poll cycles and assert the toast does NOT reappear.
 *
 * The test runs inside a single withLogConfigOverride block so any
 * failure path restores defaults on exit.
 */

import { test } from "@playwright/test";
import {
  clearLogstore,
  expect,
  seedEvents,
  waitForLogstoreReady,
  withLogConfigOverride,
} from "./helpers/logstore";

test.describe("#484 scenario 6 — capacity warning UX", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await clearLogstore(page);
    // NOTE: we intentionally do NOT call resetLogConfig here — the
    // override block below is the authority for this spec, and calling
    // reset before entering it would be a no-op anyway.
  });

  test("toast appears once at 82% and is suppressed after dismiss", async ({
    page,
  }) => {
    await withLogConfigOverride(
      page,
      {
        MAX_ROWS: 100,
        // Suppression window much larger than the test wall clock, so
        // the test's "toast doesn't reappear" assertion is gated on
        // markWarningShown() — not on the clock drifting.
        CAPACITY_WARNING_SUPPRESS_MS: 60_000,
      },
      async () => {
        // Seed 82 rows — crosses the 80% CAPACITY_WARNING_RATIO.
        await seedEvents(page, { count: 82, eventType: "diagnostic" });

        // Wait for the next poll cycle to render the toast. Test builds
        // run the toast's internal poll at 500 ms; give ourselves ~1.5 s
        // of headroom so CI jitter doesn't flake.
        const toast = page.getByTestId("capacity-warning-toast");
        await expect(toast).toBeVisible({ timeout: 2_000 });

        // Tap Dismiss — this calls markWarningShown() which writes
        // warningLastShownAt to AsyncStorage.
        await page.getByTestId("capacity-warning-dismiss").click();

        // Toast is hidden immediately.
        await expect(toast).toBeHidden();

        // Push the queue further over the threshold. With MAX_ROWS=100
        // we're now at 92% fill — the raw shouldShow() check would
        // return true if it weren't for the suppression window.
        await seedEvents(page, { count: 10, eventType: "diagnostic" });

        // Wait two poll cycles and assert the toast stays hidden.
        // 500 ms × 2 = 1 s plus a cushion.
        await page.waitForTimeout(1_300);
        await expect(toast).toBeHidden();
      },
    );
  });
});
