/**
 * solitaire-leaderboard.spec.ts — GH #1143
 *
 * Leaderboard integration: inject a completed game (all 52 cards in
 * foundations, isComplete = true), intercept POST /solitaire/score, enter a
 * name, submit, and verify the rank confirmation.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, injectSolitaireState } from "./helpers/solitaire";

const allRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const card = (suit: string, rank: number) => ({ suit, rank, faceUp: true });

const WIN_STATE = {
  _v: 1,
  drawMode: 1 as const,
  tableau: [[], [], [], [], [], [], []],
  foundations: {
    spades: allRanks.map((r) => card("spades", r)),
    hearts: allRanks.map((r) => card("hearts", r)),
    diamonds: allRanks.map((r) => card("diamonds", r)),
    clubs: allRanks.map((r) => card("clubs", r)),
  },
  stock: [],
  waste: [],
  score: 1000,
  undoStack: [],
  isComplete: true,
  recycleCount: 0,
  events: [],
};

test.describe("Solitaire — leaderboard", () => {
  test("POST /solitaire/score intercepted and rank confirmation shown after submit", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/solitaire/**", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_name: "Tester", score: 1000, rank: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ scores: [] }),
        });
      }
    });

    await injectSolitaireState(page, WIN_STATE);
    await page.getByRole("button", { name: "Play Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Win modal appears because isComplete = true.
    await expect(page.getByText("You Won!")).toBeVisible({ timeout: 5_000 });

    await page.getByLabel("Your name").fill("Tester");

    const submitBtn = page.getByRole("button", { name: "Submit Score" });
    await expect(submitBtn).toBeEnabled({ timeout: 2_000 });
    await submitBtn.click();

    await expect(page.getByText("Saved! #1")).toBeVisible({ timeout: 5_000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["player_name"]).toBe("Tester");
    expect(capturedBody!["score"]).toBe(1000);
  });

  test("Submit Score button disabled when name field is empty", async ({
    page,
  }) => {
    await mockSolitaireApi(page);
    await injectSolitaireState(page, WIN_STATE);
    await page.getByRole("button", { name: "Play Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByText("You Won!")).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("button", { name: "Submit Score" }),
    ).toBeDisabled({ timeout: 2_000 });
  });
});
