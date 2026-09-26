/**
 * Every visible game has a stats screen (#2635, plan Appendix C).
 *
 * Mahjong's Scoreboard item once led to an untranslated fallback because the
 * only test covered an unknown key. This suite iterates every game type and
 * checks that GameStatsScreen shows that game's stats under its translated
 * title, with no raw i18n keys.
 *
 * The menu side needs no test here: `GameShell`'s `gameType` prop is required,
 * so the type check fails for a game screen that doesn't say which game it
 * plays, and a screen that names its game gets the Stats item. The per-screen
 * suites press it and assert the navigation.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../theme/ThemeContext";
import GameStatsScreen from "../GameStatsScreen";
import type { GameTypeStats, StatsResponse } from "../../api/types";
import { BOARDS, GAME_TYPES, type GameType } from "../../api/vocab";
import { isGameVisible } from "../../entitlements/gameVisibility";
import { clearMyStatsCache } from "../../hooks/useMyStats";

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

function gameStats(gameType: GameType): GameTypeStats {
  return {
    last_played_at: "2026-09-20T12:00:00Z",
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
  clearMyStatsCache();
  mockGetMyStats.mockResolvedValue(allStats());
});

describe("every visible game has a stats screen (#2635)", () => {
  it("covers every game type", () => {
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
});
