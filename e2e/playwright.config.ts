import { defineConfig, devices } from "@playwright/test";
import { join } from "path";

/**
 * Playwright E2E configuration.
 *
 * Named projects allow CI to run only the impacted game suite on dev PRs
 * while always running the full suite on main PRs / pushes.
 *
 * Projects:
 *   yacht       — yacht-*.spec.ts
 *   blackjack   — blackjack-*.spec.ts
 *   twenty48    — twenty48-*.spec.ts
 *   mahjong     — mahjong-*.spec.ts
 *   freecell    — freecell-*.spec.ts
 *   hearts      — hearts-*.spec.ts
 *   solitaire   — solitaire-*.spec.ts
 *   sudoku      — sudoku-*.spec.ts
 *   sort        — sort-*.spec.ts
 *   daily_word  — daily-word-*.spec.ts
 *   cross       — accessibility.spec.ts, cascade-flow.spec.ts, ui-preferences.spec.ts
 *   logs-budget — logs-*.spec.ts (#373 acceptance gate, CPU-throttled to
 *                  approximate mid-tier mobile device performance)
 *
 * In CI the e2e job passes --project flags based on dorny/paths-filter output.
 * Locally, `npx playwright test` runs all projects (no --project flag needed).
 *
 * The webServer serves the pre-built Expo Web static export from
 * frontend/dist/.  In CI the build step runs separately before this job.
 * Locally, run `cd frontend && npx expo export --platform web` once first.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report" }],
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : "list",
  use: {
    baseURL: "http://localhost:8081",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "yacht",
      testMatch: "yacht-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "blackjack",
      testMatch: "blackjack-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "twenty48",
      testMatch: "twenty48-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cascade",
      testMatch: "cascade-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mahjong",
      testMatch: "mahjong-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "freecell",
      testMatch: "freecell-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "starswarm",
      testMatch: "starswarm-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "hearts",
      testMatch: "hearts-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "solitaire",
      testMatch: "solitaire-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "sudoku",
      testMatch: "sudoku-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "sort",
      testMatch: "sort-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "daily_word",
      testMatch: "daily-word-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cross",
      testMatch: ["accessibility.spec.ts", "ui-preferences.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // #373 acceptance gate — bounded queue + SyncWorker correctness under
      // CPU throttling that approximates a mid-tier mobile device. CPU
      // throttling is applied per spec via `page.emulateCPUThrottling(4)`
      // in a beforeEach hook in the logs-*.spec.ts files (Playwright does
      // not expose CPU throttling as a project-level option yet).
      name: "logs-budget",
      testMatch: "logs-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx serve dist -p 8081 --single",
    url: "http://localhost:8081",
    reuseExistingServer: !process.env.CI,
    cwd: join(__dirname, "..", "frontend"),
    timeout: 60_000,
  },
});
