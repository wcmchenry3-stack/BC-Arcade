import { readFileSync } from "fs";
import { join } from "path";
import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const STORAGE_KEY = "@sort/progress";
const CATALOG_VERSION_KEY = "@sort/catalog_version";

// The levels ship in the app (#2761): the specs play the catalog's own
// level 1, read from the same file the app bundles, so a new catalog only
// changes which bottles these name, not what the specs check.
interface CatalogFile {
  version: number;
  legend: string[];
  levels: [string, number][];
}
const CATALOG: CatalogFile = JSON.parse(
  readFileSync(
    join(__dirname, "../../../frontend/src/game/sort/levels.catalog.json"),
    "utf8",
  ),
);

export const CATALOG_VERSION = CATALOG.version;

/** Catalog level `id`'s bottles (bottom first, colour names). */
export function catalogLevel(id: number): string[][] {
  const [bottles] = CATALOG.levels[id - 1];
  return bottles
    .split(",")
    .map((b) => Array.from(b, (ch) => CATALOG.legend[ch.charCodeAt(0) - 65]));
}

function topRun(bottle: string[]): number {
  let n = 0;
  while (n < bottle.length && bottle[bottle.length - 1 - n] === bottle[bottle.length - 1]) n++;
  return n;
}

const LEVEL_1 = catalogLevel(1);
const FULL = LEVEL_1.map((b, i) => (b.length > 0 ? i + 1 : 0)).filter(Boolean);
const EMPTY = LEVEL_1.map((b, i) => (b.length === 0 ? i + 1 : 0)).filter(Boolean);

/**
 * Level 1's first full bottle poured into its first empty one (1-based
 * bottle numbers, as the labels read): `units` move, its top run.
 */
export const LEVEL_1_POUR = {
  from: FULL[0],
  to: EMPTY[0],
  units: topRun(LEVEL_1[FULL[0] - 1]),
};

/** Two of level 1's full bottles whose top colours differ: no pour between them. */
export const LEVEL_1_BLOCKED = (() => {
  const from = FULL[0];
  const top = (n: number) => LEVEL_1[n - 1][LEVEL_1[n - 1].length - 1];
  const to = FULL.find((n) => n !== from && top(n) !== top(from));
  if (to === undefined) throw new Error("catalog level 1 has no blocked pour");
  return { from, to };
})();

export async function mockSortApi(page: Page): Promise<void> {
  // The shared leaderboard screen reads the generic board (#2625, #2633).
  await mockSortBoard(page, []);
  // The app never calls /sort/* since the catalog (#2761); answer anything
  // that does with a 404 so a regression shows up as a failure.
  await page.route("**/sort/**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not Found" }),
    });
  });
}

/** `GET /games/leaderboard/sort` (#2618) answering with `entries`. */
export async function mockSortBoard(
  page: Page,
  entries: unknown[],
): Promise<void> {
  await page.route("**/games/leaderboard/sort*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        game_type: "sort",
        partition: {},
        label_key: "level",
        entries,
      }),
    });
  });
}

// Navigate from Home to the Sort Puzzle level-select screen, as a new player.
export async function gotoSort(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
}

// Inject a SortProgress value into localStorage, as a save of the current
// catalog (its version next to it, so it isn't migrated from the random
// levels), then reload to home so the caller can navigate to the sort
// screen with the injected state active.
export async function injectSortProgress(
  page: Page,
  partial: Record<string, unknown>,
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([key, state, versionKey, version]) => {
      localStorage.setItem(key as string, JSON.stringify(state));
      localStorage.setItem(versionKey as string, String(version));
    },
    [STORAGE_KEY, partial, CATALOG_VERSION_KEY, CATALOG_VERSION] as const,
  );
  await page.goto("/");
}

// A save from before the catalog (#2761): progress with no catalog version.
export async function injectLegacySortSave(
  page: Page,
  progress: Record<string, unknown>,
  bestMoves: Record<string, number>,
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([key, state, bests, versionKey]) => {
      localStorage.setItem(key as string, JSON.stringify(state));
      localStorage.setItem("@sort/best_moves", JSON.stringify(bests));
      localStorage.removeItem(versionKey as string);
    },
    [STORAGE_KEY, progress, bestMoves, CATALOG_VERSION_KEY] as const,
  );
  await page.goto("/");
}
