/**
 * Extended Playwright fixtures.
 *
 * The `page` fixture is wrapped to auto-install the /entitlements mock so
 * premium games show as unlocked on every test that uses the default page.
 * Tests that create pages via browser.newContext() must still call
 * installEntitlementsMock() manually.
 */

import { test as base } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";

export const test = base.extend({
  page: async ({ page }, use) => {
    await installEntitlementsMock(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
