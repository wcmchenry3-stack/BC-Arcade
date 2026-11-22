/**
 * @jest-environment jsdom
 *
 * #3578: 2048's tile sounds. Reopening a saved game doesn't replay its last move's merge and
 * spawn (a save keeps the tiles' flags); a fresh deal still plays its spawn.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/twenty48/storage";
import type { Twenty48State } from "../../game/twenty48/types";

const mockPlays: string[] = [];
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (key: string) => ({ play: () => (mockPlays.push(key), true), stop: jest.fn() }),
}));
jest.mock("../../game/_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => ({
    play: () => (mockPlays.push(keys[0]!), true),
  }),
}));

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockShellNavigate }), { actual: true })
);
jest.mock("../../game/twenty48/storage", () => ({
  saveGame: jest.fn(() => Promise.resolve()),
  clearGame: jest.fn(() => Promise.resolve()),
  loadGame: jest.fn().mockResolvedValue(null),
  saveBestScore: jest.fn(),
  loadBestScore: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({ startGame: jest.fn().mockReturnValue("game-id") })
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync({}));

const nav = {
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
  addListener: jest.fn(() => () => {}),
} as unknown as Parameters<typeof Twenty48Screen>[0]["navigation"];

// A save written right after a merge: one merged tile and one spawned tile, flags still set.
const SAVED: Twenty48State = {
  board: [
    [4, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 2],
  ],
  tiles: [
    { id: 1, value: 4, row: 0, col: 0, prevRow: 0, prevCol: 1, isNew: false, isMerge: true },
    { id: 2, value: 2, row: 3, col: 3, prevRow: null, prevCol: null, isNew: true, isMerge: false },
  ],
  score: 4,
  scoreDelta: 4,
  game_over: false,
  has_won: false,
  startedAt: null,
  accumulatedMs: 0,
};

const tileSounds = () => mockPlays.filter((k) => k.startsWith("twenty48.tile"));

beforeEach(() => {
  mockPlays.length = 0;
});

async function open(saved: Twenty48State | null) {
  (loadGame as jest.Mock).mockResolvedValueOnce(saved);
  const r = await render(
    <ThemeProvider>
      <Twenty48Screen navigation={nav} />
    </ThemeProvider>
  );
  await waitFor(() => expect(r.getAllByText(/^\d+$/).length).toBeGreaterThan(0)); // board is up
  return r;
}

it("reopening a saved game doesn't replay its last move's merge and spawn", async () => {
  await open(SAVED);
  expect(tileSounds()).toEqual([]);
});

it("a fresh deal still plays its spawn as its tiles appear", async () => {
  await open(null);
  expect(tileSounds()).toEqual(["twenty48.tileSpawn"]);
});
