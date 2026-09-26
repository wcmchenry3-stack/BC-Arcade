/**
 * Every visible game has a stats screen (#2635, plan Appendix C).
 *
 * Mahjong's Scoreboard item once led to an untranslated fallback because the
 * only test covered an unknown key. This suite iterates every game type:
 *
 * 1. GameStatsScreen shows that game's stats under its translated title, with
 *    no raw i18n keys.
 * 2. Every game screen passes `onOpenStats` to each `GameShell` it renders
 *    with a menu, so the ⋯ menu has a "Stats" item. The screens are checked
 *    in their source (rendering all twelve needs each suite's own mocks); the
 *    per-screen suites press the item and assert the navigation.
 */

import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { act, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../theme/ThemeContext";
import GameStatsScreen from "../GameStatsScreen";
import type { GameTypeStats, StatsResponse } from "../../api/types";
import { BOARDS, GAME_TYPES, type GameType } from "../../api/vocab";
import { isGameVisible } from "../../entitlements/gameVisibility";
import { __resetMyStatsCacheForTests } from "../../hooks/useMyStats";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockGetMyStats = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getMyStats: () => mockGetMyStats() },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => Promise.resolve(),
}));
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

/**
 * The screens that render each game's ⋯ menu. A `Record` over `GameType`, so
 * a new game type fails the type check until its screens are listed here.
 * Mahjong's layout inspector and detail screens are developer tools, and
 * Blackjack's victory and run-history screens have no game menu.
 */
const GAME_SCREENS: Record<GameType, readonly string[]> = {
  yacht: ["GameScreen.tsx"],
  twenty48: ["Twenty48Screen.tsx"],
  blackjack: ["BlackjackBettingScreen.tsx", "BlackjackTableScreen.tsx"],
  cascade: ["CascadeScreen.tsx"],
  solitaire: ["SolitaireScreen.tsx"],
  hearts: ["HeartsScreen.tsx"],
  sudoku: ["SudokuScreen.tsx"],
  mahjong: ["MahjongScreen.tsx"],
  starswarm: ["StarSwarmScreen.tsx"],
  freecell: ["FreeCellScreen.tsx"],
  sort: ["SortScreen.tsx"],
  daily_word: ["DailyWordScreen.tsx"],
};

/**
 * The opening `<GameShell …>` tags in a source file. A `>` inside `{…}` (an
 * arrow function, a comparison) does not end the tag.
 */
function gameShellTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<GameShell", from);
    if (start === -1) return tags;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    tags.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

/** A shell that only shows a spinner (`loading` with no value): GameShell hides its menu. */
const isLoadingOnly = (tag: string): boolean => /\sloading(?=[\s/>])/.test(tag);

function gameStats(gameType: GameType): GameTypeStats {
  return {
    played: 6,
    best: null,
    avg: null,
    last_played_at: "2026-09-20T12:00:00Z",
    best_chips: null,
    current_chips: null,
    sessions: 6,
    completed: 5,
    won: 3,
    lost: 1,
    tied: 1,
    current_win_streak: 1,
    best_win_streak: 2,
    time_played_ms: 90 * 60_000,
    best_value: 42,
    best_label_key: BOARDS[gameType]?.labelKey ?? "score",
    extras: {},
  };
}

function allStats(): StatsResponse {
  return {
    total_games: 0,
    by_game: Object.fromEntries(GAME_TYPES.map((g) => [g, gameStats(g)])),
    favorite_game: null,
    arcade_xp: 0,
    arcade_level: 1,
    xp_into_level: 0,
    xp_for_next_level: 100,
    streak_days: 0,
  };
}

/** Every string on screen. */
function renderedTexts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "children" in node) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return out;
}

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as React.ComponentProps<
  typeof GameStatsScreen
>["navigation"];

beforeEach(() => {
  __resetMyStatsCacheForTests();
  mockGetMyStats.mockResolvedValue(allStats());
});

describe("every visible game has a stats screen (#2635)", () => {
  it("covers every game type", () => {
    expect(Object.keys(GAME_SCREENS).sort()).toEqual([...GAME_TYPES].sort());
    // Jest runs as a dev build: every game is visible, so none is skipped below.
    expect(GAME_TYPES.every((g) => isGameVisible(g))).toBe(true);
  });

  it.each(GAME_TYPES.filter((g) => isGameVisible(g)))(
    "%s: the stats screen shows the game's own stats, translated",
    async (gameType) => {
      await render(
        <ThemeProvider>
          <GameStatsScreen route={{ params: { gameType } }} navigation={navigation} />
        </ThemeProvider>
      );
      await act(async () => {});

      const title = i18n.t(`${gameType}:game.title`);
      expect(title).not.toBe("game.title");
      expect(screen.getAllByRole("header").some((h) => h.props.children === `${title} Stats`)).toBe(
        true
      );
      expect(screen.getByTestId("game-stats-tile-sessions")).toBeTruthy();
      expect(screen.getByTestId("game-stats-tile-best").props.accessibilityLabel).not.toMatch(
        /: 42$/
      ); // labelled ("42 pts", "42 moves", "Level 42"), not the bare number
      expect(screen.queryByText(/No scoreboard available/)).toBeNull();

      // No raw keys (e.g. "stats:tile.wins", "tile.best") anywhere on screen.
      const texts = renderedTexts();
      expect(texts).toContain("Sessions");
      const raw = texts.filter((s) => /^[\w-]+:[\w.]+$|^[a-z]+\.[a-zA-Z.]+$/.test(s));
      expect(raw).toEqual([]);
    }
  );

  it.each(GAME_TYPES)("%s: every game menu on its screens has a Stats item", (gameType) => {
    for (const file of GAME_SCREENS[gameType]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source).toContain(`useGameStatsLink(navigation, "${gameType}")`);
      const menus = gameShellTags(source).filter((tag) => !isLoadingOnly(tag));
      expect(menus.length).toBeGreaterThan(0);
      for (const tag of menus) {
        expect({ file, tag, hasStats: /\sonOpenStats=\{/.test(tag) }).toEqual({
          file,
          tag,
          hasStats: true,
        });
      }
    }
  });
});

describe("gameShellTags", () => {
  it("reads a tag past arrow functions and treats a bare `loading` as spinner-only", () => {
    const tags = gameShellTags(
      `<GameShell title="a" onBack={() => x > 1} loading />
       <GameShell loading={busy} onOpenStats={openStats}>`
    );
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain("x > 1");
    expect(isLoadingOnly(tags[0]!)).toBe(true);
    expect(isLoadingOnly(tags[1]!)).toBe(false);
  });
});
