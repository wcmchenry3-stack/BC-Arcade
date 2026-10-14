/**
 * daily-word-accents.spec.ts — GH #3241
 *
 * French (fr-CA app language) and Spanish (es) Daily Word on web, where every
 * puzzle language is offered. Players type plain letters (plus Ñ for es); the
 * server folds the accents and answers with the list's `display` spelling,
 * which the submitted row and the answer reveal show. All APIs are mocked.
 *
 * The native-store fallback to English cannot be reached from web; Jest covers
 * it (todayMeta.test.ts).
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";

type Lang = "fr" | "es";

const PUZZLE_ID: Record<Lang, string> = {
  fr: "2026-10-13:fr:1",
  es: "2026-10-13:es:1",
};

interface Scenario {
  /** Folded answer and its accented display. */
  answer: string;
  display: string;
}

/** Mock the Daily Word API per requested language. */
async function mockApi(
  page: Page,
  scenarios: Record<Lang, Scenario>,
  guessStatus: "correct" | "absent",
): Promise<void> {
  await installEntitlementsMock(page);
  await page.route("**/daily-word/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/daily-word/today")) {
      const lang = (url.searchParams.get("lang") ?? "en") as string;
      return json({
        puzzle_id:
          lang === "fr" || lang === "es"
            ? PUZZLE_ID[lang]
            : `2026-10-13:${lang}`,
        word_length: 5,
      });
    }
    if (url.pathname.endsWith("/daily-word/guess")) {
      const body = route.request().postDataJSON() as {
        puzzle_id: string;
        guess: string;
      };
      const lang = body.puzzle_id.split(":")[1] as Lang;
      const scenario = scenarios[lang];
      return json({
        tiles: Array.from(scenario.answer, (letter) => ({
          letter,
          status: guessStatus,
        })),
        display: scenario.display,
        guesses_used: 1,
        guesses_remaining: 5,
      });
    }
    if (url.pathname.endsWith("/daily-word/answer")) {
      const lang = (url.searchParams.get("puzzle_id") ?? "").split(
        ":",
      )[1] as Lang;
      const scenario = scenarios[lang];
      return json({ answer: scenario.answer, display: scenario.display });
    }
    return json({});
  });
}

async function openDailyWord(
  page: Page,
  locale: "fr-CA" | "es",
): Promise<void> {
  await page.getByRole("tab").last().click();
  await page.getByTestId("lang-switcher-select").selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.getByRole("tab").first().click();
  await page.getByTestId("game-tile-daily_word").click();
  await page.getByTestId("daily-word-row-0").waitFor({ timeout: 10_000 });
}

async function typeWord(page: Page, word: string): Promise<void> {
  for (const ch of word) {
    await page.getByTestId(`daily-word-key-${ch}`).click();
  }
}

async function expectRow(page: Page, row: number, word: string): Promise<void> {
  const letters = Array.from(word);
  for (let col = 0; col < letters.length; col++) {
    await expect(page.getByTestId(`tile-${row}-${col}`)).toHaveText(
      letters[col]!,
      {
        timeout: 5_000,
      },
    );
  }
}

const SCENARIOS: Record<Lang, Scenario> = {
  fr: { answer: "etait", display: "était" },
  es: { answer: "ñandu", display: "ñandú" },
};

test.describe("Daily Word — French and Spanish accents (web)", () => {
  test("fr-CA: typing etait wins and the row shows ÉTAIT", async ({ page }) => {
    await mockApi(page, SCENARIOS, "correct");
    await page.goto("/");
    await page.getByTestId("game-tile-yacht").waitFor();
    await openDailyWord(page, "fr-CA");

    // QWERTY, French labels, no Ñ.
    await expect(page.getByTestId("daily-word-key-q")).toBeVisible();
    await expect(page.getByTestId("daily-word-key-ñ")).toHaveCount(0);
    await expect(page.getByTestId("daily-word-key-enter")).toContainText(
      "Entrée",
    );

    await typeWord(page, "etait");
    await expectRow(page, 0, "ETAIT");
    await page.getByTestId("daily-word-key-enter").click();

    await expectRow(page, 0, "ÉTAIT");
    await expect(page.getByTestId("daily-word-result")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("es: the Ñ key types ñ and the row shows ÑANDÚ", async ({ page }) => {
    await mockApi(page, SCENARIOS, "correct");
    await page.goto("/");
    await page.getByTestId("game-tile-yacht").waitFor();
    await openDailyWord(page, "es");

    await expect(page.getByTestId("daily-word-key-ñ")).toBeVisible();
    await expect(page.getByTestId("daily-word-key-enter")).toContainText(
      "Enviar",
    );

    await page.getByTestId("daily-word-key-ñ").click();
    await typeWord(page, "andu");
    await expectRow(page, 0, "ÑANDU");
    await page.getByTestId("daily-word-key-enter").click();

    await expectRow(page, 0, "ÑANDÚ");
    await expect(page.getByTestId("daily-word-result")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("es: the loss card reveals the answer with its accent", async ({
    page,
  }) => {
    const scenarios: Record<Lang, Scenario> = {
      ...SCENARIOS,
      es: { answer: "arbol", display: "árbol" },
    };
    await mockApi(page, scenarios, "absent");
    // A finished, lost board for today's puzzle; the answer comes from /answer.
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        `daily_word_board_${PUZZLE_ID.es}`,
        JSON.stringify({
          _v: 1,
          puzzle_id: PUZZLE_ID.es,
          word_length: 5,
          language: "es",
          rows: Array.from({ length: 6 }, () => ({
            tiles: Array.from("ninos", (letter) => ({
              letter,
              status: "absent",
            })),
            submitted: true,
          })),
          current_row: 6,
          keyboard_state: {},
          is_complete: true,
          won: false,
          completed_at: "2026-10-13T12:00:00.000Z",
        }),
      ],
    );
    await page.goto("/");
    await page.getByTestId("game-tile-yacht").waitFor();
    await openDailyWord(page, "es");

    await expect(page.getByText("La palabra era ÁRBOL")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("fr-CA: a restored board keeps its accents", async ({ page }) => {
    await mockApi(page, SCENARIOS, "correct");
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        `daily_word_board_${PUZZLE_ID.fr}`,
        JSON.stringify({
          _v: 1,
          puzzle_id: PUZZLE_ID.fr,
          word_length: 5,
          language: "fr",
          rows: [
            {
              tiles: [
                { letter: "e", status: "correct", display: "é" },
                { letter: "t", status: "correct" },
                { letter: "a", status: "correct" },
                { letter: "i", status: "correct" },
                { letter: "t", status: "correct" },
              ],
              submitted: true,
            },
            ...Array.from({ length: 5 }, () => ({
              tiles: Array.from({ length: 5 }, () => ({
                letter: "",
                status: "empty",
              })),
              submitted: false,
            })),
          ],
          current_row: 1,
          keyboard_state: {
            e: "correct",
            t: "correct",
            a: "correct",
            i: "correct",
          },
          is_complete: false,
          won: false,
          completed_at: null,
        }),
      ],
    );
    await page.goto("/");
    await page.getByTestId("game-tile-yacht").waitFor();
    await openDailyWord(page, "fr-CA");

    await expectRow(page, 0, "ÉTAIT");
  });
});
