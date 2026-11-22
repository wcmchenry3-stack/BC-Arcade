/**
 * lobby-tile-text-fit.spec.ts — #4006
 *
 * Expo Web always reports `fontScale: 1`, so the lobby overflow tests in
 * i18n-overflow.spec.ts can only check the default text size. This spec measures every
 * game's lobby description, in every locale, set in the app's own Manrope at the real sizes,
 * in the narrowest two-column tile (360 pt window): it must fit the 3 lines a tile reserves at
 * the default size, and the 5 lines it reserves at the 1.5x font-scale cap
 * (LOBBY_DESCRIPTION_LINES / _LARGE and LOBBY_MAX_FONT_SCALE in
 * frontend/src/components/home/lobbyColumns.ts). A string that needs more fails here, before
 * it is clamped with an ellipsis on a phone with large text. The lobby status strings that
 * replace a description (#4008) are held to the same limit.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const FRONTEND = join(__dirname, "..", "..", "frontend");
const LOCALES_DIR = join(FRONTEND, "src", "i18n", "locales");
const FONT = join(
  FRONTEND,
  "node_modules",
  "@expo-google-fonts",
  "manrope",
  "400Regular",
  "Manrope_400Regular.ttf",
);
const GAMES = [
  "yacht",
  "cascade",
  "blackjack",
  "twenty48",
  "solitaire",
  "freecell",
  "hearts",
  "sudoku",
  "starswarm",
  "mahjong",
  "sort",
  "daily_word",
];

// Mirrors lobbyColumns.ts and HomeScreen.tsx styles.
const DESCRIPTION_SIZE = 12;
const DESCRIPTION_LINE_HEIGHT = 16;
const LINES_DEFAULT = 3;
const LINES_LARGE = 5;
const MAX_FONT_SCALE = 1.5;
// 360 pt window, 2 columns: (360 - 2 * 16 gutter - 16 gap) / 2 = 156 pt tile; the description
// has 12 pt of horizontal padding on each side.
const TEXT_WIDTH = (360 - 32 - 16) / 2 - 24;

type Item = { locale: string; game: string; text: string };

function descriptions(): Item[] {
  const items: Item[] = [];
  for (const locale of readdirSync(LOCALES_DIR)) {
    if (locale.startsWith("_") || locale.endsWith(".json")) continue;
    for (const game of GAMES) {
      const file = join(LOCALES_DIR, locale, `${game}.json`);
      let json: Record<string, string>;
      try {
        json = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      const text = json["game.description"];
      if (text) items.push({ locale, game, text });
    }
    items.push(...statuses(locale));
  }
  return items;
}

// The status that replaces a description (#4008) sits in the same slot, so it must fit the same
// lines. Measured with the longest values a tile shows: a 7-digit score, an h:mm:ss time, a
// 4-digit move count (formatted with grouping separators; the widest locale separators are
// close to these).
function statuses(locale: string): Item[] {
  let json: Record<string, string>;
  try {
    json = JSON.parse(
      readFileSync(join(LOCALES_DIR, locale, "common.json"), "utf8"),
    );
  } catch {
    return [];
  }
  const fill = (key: string, value: string) =>
    (json[key] ?? "").replace("{{value}}", value);
  return [
    {
      locale,
      game: "status.inProgress",
      text: json["home.status.inProgress"] ?? "",
    },
    {
      locale,
      game: "status.doneToday",
      text: json["home.status.doneToday"] ?? "",
    },
    {
      locale,
      game: "status.best",
      text: fill("home.status.best", "1,234,567"),
    },
    {
      locale,
      game: "status.bestTime",
      text: fill("home.status.best", "1:23:45"),
    },
    {
      locale,
      game: "status.bestMoves",
      text: fill("home.status.bestMoves", "1,234"),
    },
  ].filter((item) => item.text !== "");
}

test.describe("Lobby tile descriptions fit their reserved lines (#4006)", () => {
  const items = descriptions();

  test("every locale has descriptions to measure", () => {
    expect(new Set(items.map((i) => i.locale)).size).toBeGreaterThanOrEqual(13);
  });

  for (const [label, scale, maxLines] of [
    ["default text size", 1, LINES_DEFAULT],
    ["1.5x font-scale cap", MAX_FONT_SCALE, LINES_LARGE],
  ] as const) {
    test(`fits ${maxLines} lines at the ${label}`, async ({ page }) => {
      const font = readFileSync(FONT).toString("base64");
      const size = DESCRIPTION_SIZE * scale;
      const lineHeight = DESCRIPTION_LINE_HEIGHT * scale;
      await page.setContent(
        `<style>@font-face{font-family:Manrope;src:url(data:font/ttf;base64,${font})}` +
          `div{font-family:Manrope;font-size:${size}px;line-height:${lineHeight}px;` +
          `width:${TEXT_WIDTH}px;text-align:center;display:inline-block}</style><body></body>`,
      );
      // Load the face explicitly: with no text on the page yet, fonts.ready alone resolves
      // before Manrope is fetched and the measurement silently uses a narrower fallback.
      await page.evaluate(async (px) => {
        await document.fonts.load(`${px}px Manrope`);
        await document.fonts.ready;
      }, size);
      expect(
        await page.evaluate(
          (px) => document.fonts.check(`${px}px Manrope`),
          size,
        ),
      ).toBe(true);
      const tooLong = await page.evaluate(
        ({ items, lineHeight, maxLines }) =>
          items
            .map(({ locale, game, text }) => {
              const d = document.createElement("div");
              d.textContent = text;
              document.body.appendChild(d);
              const lines = Math.round(
                d.getBoundingClientRect().height / lineHeight,
              );
              d.remove();
              return { locale, game, lines, text };
            })
            .filter((r) => r.lines > maxLines),
        { items, lineHeight, maxLines },
      );
      expect(
        tooLong,
        `descriptions needing more than ${maxLines} lines`,
      ).toEqual([]);
    });
  }
});
