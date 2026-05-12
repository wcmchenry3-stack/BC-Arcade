/**
 * Shared helpers for Yacht e2e tests.
 */

import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

/** Navigate from Home to Yacht game screen, clearing any saved state first. */
export async function gotoYacht(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
  await page.goto("/");
  await page.getByRole("button", { name: "Play Yacht" }).click();
  await page.getByText("Round 1 / 13").waitFor();
}

/** Set the Yacht RNG seed via the test hook (requires EXPO_PUBLIC_TEST_HOOKS=1 build). */
export async function setSeed(page: Page, seed: number): Promise<void> {
  await page.evaluate(
    (s) =>
      (window as { __yacht_setSeed?: (n: number) => void }).__yacht_setSeed?.(
        s,
      ),
    seed,
  );
}

/** Full GameState shape matching engine.ts. */
export interface InjectedGameState {
  dice: number[];
  held: boolean[];
  rolls_used: number;
  round: number;
  scores: Record<string, number | null>;
  game_over: boolean;
  upper_subtotal: number;
  upper_bonus: number;
  yacht_bonus_count: number;
  yacht_bonus_total: number;
  total_score: number;
}

/** Inject a pre-built GameState into localStorage, then reload the home page. */
export async function injectGameState(
  page: Page,
  state: InjectedGameState,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    (s) => localStorage.setItem("yacht_game_v1", JSON.stringify(s)),
    state,
  );
  await page.goto("/");
}

/** Return a scores record with every category null (unscored). */
export function blankScores(): Record<string, number | null> {
  return {
    ones: null,
    twos: null,
    threes: null,
    fours: null,
    fives: null,
    sixes: null,
    three_of_a_kind: null,
    four_of_a_kind: null,
    full_house: null,
    small_straight: null,
    large_straight: null,
    yacht: null,
    chance: null,
  };
}
