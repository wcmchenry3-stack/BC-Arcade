/**
 * #482 scenario 7 — Manual clear via Settings.
 *
 * Drives the real Settings "Clear local logs" flow:
 *   1. Seed the queue with events + bug logs
 *   2. Navigate to the Settings tab
 *   3. Tap Clear — confirm modal opens
 *   4. Tap Cancel — modal closes, queue unchanged
 *   5. Tap Clear again, then Confirm — modal closes, queue empty,
 *      success toast visible
 *
 * The UI shipped in #367d (SettingsScreen — testIDs
 * clear-logs-button, clear-logs-cancel, clear-logs-confirm).
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

test.describe("#482 scenario 7 — manual clear from Settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForLogstoreReady(page);
    await resetLogConfig(page);
    await clearLogstore(page);
  });

  test("Cancel leaves the queue intact; Confirm empties it and shows the toast", async ({
    page,
  }) => {
    // Seed a mix of events + bug logs so we can verify the clear covers
    // both log types.
    await seedEvents(page, { count: 20, eventType: "diagnostic" });
    await seedBugLogs(page, { count: 5 });

    let stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(25);

    // Navigate to the Settings tab.
    await page.getByRole("tab", { name: "Settings" }).click();

    // Open the confirm modal.
    await page.getByTestId("clear-logs-button").click();

    // Cancel — queue unchanged.
    await page.getByTestId("clear-logs-cancel").click();
    stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(25);

    // Re-open the modal and confirm this time.
    await page.getByTestId("clear-logs-button").click();
    await page.getByTestId("clear-logs-confirm").click();

    // Queue is empty and the success toast is visible.
    stats = await inspectQueue(page);
    expect(stats.totalRows).toBe(0);
    await expect(page.getByText("Logs cleared")).toBeVisible();
  });
});
