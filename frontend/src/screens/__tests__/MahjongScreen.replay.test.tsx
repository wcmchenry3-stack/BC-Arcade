/**
 * MahjongScreen — replay recording (#3285, epic #3273).
 *
 * What the screen hands the shared recorder as it is played: matches, undos,
 * hints and shuffles, in `moves` chunks; saved when the app leaves the
 * foreground, when the game ends or is left, and when the screen unmounts, and
 * never one event per action. The builders, the chunking and the golden replay
 * are tested in game/mahjong/__tests__/replay.test.ts.
 */

import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { GameRecorder } from "../../game/_shared/gameRecorder";
import { getAnyFreePair } from "../../game/mahjong/engine";
import type { MahjongState } from "../../game/mahjong/types";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockCanvasBoard: { tiles: readonly { id: number }[] } = { tiles: [] };
jest.mock("../../components/mahjong/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Pressable } = require("react-native");
  function MockGameCanvas({
    state,
    onTilePress,
  }: {
    state: { tiles: readonly { id: number }[] };
    onTilePress: (id: number) => void;
  }) {
    mockCanvasBoard.tiles = state.tiles;
    return (
      <View testID="game-canvas">
        {state.tiles.map((tile) => (
          <Pressable
            key={tile.id}
            accessibilityLabel={`mock-tile-${tile.id}`}
            onPress={() => onTilePress(tile.id)}
          />
        ))}
      </View>
    );
  }
  MockGameCanvas.displayName = "MockGameCanvas";
  return { __esModule: true, default: MockGameCanvas };
});

const mockNavListeners = new Map<string, Array<() => void>>();
const mockAddListener = jest.fn((event: string, handler: () => void) => {
  const arr = mockNavListeners.get(event) ?? [];
  arr.push(handler);
  mockNavListeners.set(event, arr);
  return () => {
    mockNavListeners.set(
      event,
      (mockNavListeners.get(event) ?? []).filter((h) => h !== handler)
    );
  };
});
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      popToTop: jest.fn(),
      goBack: jest.fn(),
      navigate: jest.fn(),
      setOptions: jest.fn(),
      addListener: mockAddListener,
    }),
    {
      useFocusEffect: (cb: () => () => void) => {
        const cleanup = cb();
        return cleanup;
      },
    }
  )
);

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  init: jest.fn(),
  wrap: <T,>(x: T) => x,
}));

type SavedEvent = { type: string; data: Record<string, unknown> };
const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvent = jest.fn();
// The recorder saves a unit's events in one call (#3274): [gameId, events].
const mockEnqueueEvents = jest.fn<undefined, [string, SavedEvent[]]>();
const mockCompleteGame = jest.fn();
// A killed process's session to continue (#2654) — none unless a test says so.
const mockResumeGame = jest.fn<string | null, [string, unknown?]>();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvent: lazy(() => mockEnqueueEvent),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: lazy(() => mockResumeGame),
  });
});

jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({
    getGameRank: () => Promise.resolve({ ranked: true, rank: 5, is_best: true, reason: null }),
  })
);
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () =>
  mockScreenDeps().mockDisplayNameSync({ flushDisplayNameSync: () => Promise.resolve(true) })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two free pairs in a row (ids 0+1, 2+3), 70 pairs already gone. */
function fourTiles(overrides: Partial<MahjongState> = {}): MahjongState {
  return {
    _v: 2,
    tiles: [
      { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
      { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 4, row: 0, layer: 0 },
      { id: 2, suit: "circles", rank: 2, faceId: 18, col: 8, row: 0, layer: 0 },
      { id: 3, suit: "circles", rank: 2, faceId: 18, col: 12, row: 0, layer: 0 },
    ],
    selected: null,
    pairsRemoved: 70,
    score: 700,
    shufflesLeft: 3,
    undoStack: [],
    isComplete: false,
    isDeadlocked: false,
    startedAt: null,
    accumulatedMs: 60_000,
    dealId: "AAAA",
    currentLayoutId: "pyramid",
    ...overrides,
  } as MahjongState;
}

/** The last pair on the board. */
function lastPair(): MahjongState {
  return fourTiles({ tiles: fourTiles().tiles.slice(0, 2), pairsRemoved: 71, score: 710 });
}

async function mountWith(saved: MahjongState) {
  await AsyncStorage.setItem("mahjong_game", JSON.stringify(saved));
  const api = await render(
    <ThemeProvider>
      <MahjongScreen />
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return api;
}

type Api = Awaited<ReturnType<typeof mountWith>>;

async function tap(api: Api, ...ids: number[]) {
  for (const id of ids) {
    await act(async () => {
      await fireEvent.press(api.getByLabelText(`mock-tile-${id}`));
    });
  }
}

async function press(api: Api, testID: string) {
  await act(async () => {
    await fireEvent.press(api.getByTestId(testID));
  });
}

/** Every `moves` event the recorder saved, in order, with the game it went to. */
function savedMoves(): { gameId: string; data: Record<string, unknown> }[] {
  return mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    events.filter((e) => e.type === "moves").map((e) => ({ gameId, data: e.data }))
  );
}
const entries = () => savedMoves().flatMap((e) => e.data.m as unknown[]);

let appStateSpy: jest.SpyInstance;
let appStateBase: number;
async function setAppState(status: AppStateStatus) {
  await act(async () => {
    for (const [type, listener] of appStateSpy.mock.calls.slice(appStateBase)) {
      if (type === "change") (listener as (s: AppStateStatus) => void)(status);
    }
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockNavListeners.clear();
  mockAddListener.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-1");
  mockEnqueueEvent.mockReset();
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockResumeGame.mockReset();
  // The killed process's session is resumed unless a test says otherwise.
  mockResumeGame.mockReturnValue("game-1");
  appStateSpy = jest.spyOn(AppState, "addEventListener");
  appStateBase = appStateSpy.mock.calls.length;
});

afterEach(() => {
  appStateSpy.mockRestore();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// What is recorded, and when it is saved
// ---------------------------------------------------------------------------

describe("MahjongScreen — replay recording (#3285)", () => {
  it("records matches, hints and undos in order and saves them in one event when the screen closes, never one per action", async () => {
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1); // a match
    await press(api, "mahjong-hint-button"); // a hint (2+3 are a free pair)
    await press(api, "mahjong-undo-button"); // takes the match back
    await tap(api, 0, 1); // matched again

    // Nothing is saved while the game is played: no per-action event, no batch.
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "moves")).toEqual([]);

    await api.unmount();
    const events = savedMoves();
    expect(events).toHaveLength(1);
    expect(events[0]!.gameId).toBe("game-1");
    expect(events[0]!.data).toEqual({
      v: 1,
      unit: 1,
      t_ms: expect.any(Number),
      m: [[0, 1], "h", "u", [0, 1]],
    });
  });

  it("records a shuffle with the order it produced", async () => {
    const api = await mountWith(fourTiles());
    await press(api, "mahjong-shuffle-button");
    await api.unmount();

    const [shuffle] = entries() as { s: number[]; f: number[] }[];
    expect(shuffle).toBeDefined();
    expect([...shuffle!.s].sort()).toEqual([0, 1, 2, 3]);
    expect([...shuffle!.f].sort()).toEqual([18, 18, 26, 26]);
    // the board the screen now shows is the one that order describes
    const shown = mockCanvasBoard.tiles as { id: number; col: number; faceId: number }[];
    expect(shown.map((t) => t.faceId)).toEqual(shuffle!.f);
    const before = fourTiles().tiles;
    expect(shown.map((t) => t.col)).toEqual(shuffle!.s.map((slot) => before[slot]!.col));
  });

  it("records no hint when there is none to show, and no undo with nothing to take back", async () => {
    const api = await mountWith(
      fourTiles({ tiles: fourTiles().tiles.slice(0, 1), pairsRemoved: 71 })
    );
    await tap(api, 0); // opens the session; one tile is no pair
    await press(api, "mahjong-hint-button"); // no hint
    await press(api, "mahjong-undo-button"); // disabled: nothing to undo
    await api.unmount();
    expect(entries()).toEqual([]);
  });

  it("saves what is waiting the moment the app goes to the background, without ending the game", async () => {
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();

    await setAppState("background");

    // synchronously, in the same step: a kill from here loses nothing more
    expect(savedMoves()).toHaveLength(1);
    expect(entries()).toEqual([[0, 1]]);
    expect(mockCompleteGame).not.toHaveBeenCalled();

    // the save carries the chunk count, so a resumed game carries on from it
    const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game")) ?? "{}");
    expect(saved.replayUnit).toBe(1);

    // the game goes on: the next chunk is the next unit
    await setAppState("active");
    await tap(api, 2, 3);
    await setAppState("background");
    expect(savedMoves().map((e) => e.data.unit)).toEqual([1, 2]);
    expect(entries()).toEqual([
      [0, 1],
      [2, 3],
    ]);
    await api.unmount();
  });

  it("saves the move that clears the board before the game is completed", async () => {
    const api = await mountWith(lastPair());
    await tap(api, 0, 1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(entries()).toEqual([[0, 1]]);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
    await api.unmount();
  });

  it("a game resumed after a kill numbers its next chunk after the saved count", async () => {
    mockResumeGame.mockReturnValue("killed-session");
    const api = await mountWith(fourTiles({ replayUnit: 4 }));
    await tap(api, 0, 1);
    await api.unmount();

    const events = savedMoves();
    expect(events).toHaveLength(1);
    expect(events[0]!.gameId).toBe("killed-session");
    expect(events[0]!.data.unit).toBe(5);
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("a saved count that is not a count is ignored: the chunks count from 1", async () => {
    mockResumeGame.mockReturnValue("killed-session");
    const api = await mountWith({ ...fourTiles(), replayUnit: "lots" } as unknown as MahjongState);
    await tap(api, 0, 1);
    await api.unmount();
    expect(savedMoves().map((e) => e.data.unit)).toEqual([1]);
  });

  it("a new deal saves the old game's chunk to the old game and counts its own chunks from 1", async () => {
    mockStartGame.mockReturnValueOnce("game-2"); // the first game is resumed as game-1
    const api = await mountWith(lastPair());
    await tap(api, 0, 1); // wins
    expect(entries()).toEqual([[0, 1]]);

    await act(async () => {
      await fireEvent.press(await api.findByRole("button", { name: "Play Again" }));
    });
    // a fresh deal: play one real pair of it
    const pair = getAnyFreePair(mockCanvasBoard.tiles as never)!;
    expect(pair).not.toBeNull();
    await tap(api, pair[0], pair[1]);
    await api.unmount();

    const events = savedMoves();
    expect(events.map((e) => e.gameId)).toEqual(["game-1", "game-2"]);
    expect(events.map((e) => e.data.unit)).toEqual([1, 1]);
    expect(events[1]!.data.m).toEqual([[expect.any(Number), expect.any(Number)]]);
  });

  it("records nothing for a restored game whose session could not be resumed: it has no deal seed", async () => {
    mockResumeGame.mockReturnValue(null);
    mockStartGame.mockReturnValue("game-new");
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1);
    await press(api, "mahjong-hint-button");
    await setAppState("background");
    await api.unmount();

    // a session did open (the game is still counted), with no seed in game_started
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![2]).not.toHaveProperty("seed");
    expect(savedMoves()).toEqual([]);
  });

  it("stays unrecorded when that game is loaded again and its session is resumed after another kill", async () => {
    mockResumeGame.mockReturnValue(null);
    mockStartGame.mockReturnValue("game-new");
    const first = await mountWith(fourTiles());
    await tap(first, 0, 1); // opens the unseeded session; the match is not recorded
    await setAppState("background"); // writes the save, with the blocked count
    const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game")) ?? "{}");
    expect(saved.replayUnit).toBe(20);
    await first.unmount();
    expect(savedMoves()).toEqual([]);

    // another launch: the unseeded session is resumed this time
    mockResumeGame.mockReturnValue("game-new");
    const second = await render(
      <ThemeProvider>
        <MahjongScreen />
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await press(second, "mahjong-hint-button");
    await tap(second, 2, 3); // the last pair: the game is won
    await setAppState("background");
    await second.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("a fresh deal after such a game records again (it has a seed)", async () => {
    mockResumeGame.mockReturnValue(null);
    mockStartGame.mockReturnValueOnce("game-old").mockReturnValueOnce("game-new");
    const api = await mountWith(lastPair());
    await tap(api, 0, 1); // wins, unrecorded
    await act(async () => {
      await fireEvent.press(await api.findByRole("button", { name: "Play Again" }));
    });
    const pair = getAnyFreePair(mockCanvasBoard.tiles as never)!;
    await tap(api, pair[0], pair[1]);
    await api.unmount();
    expect(mockStartGame.mock.calls[1]![2]).toHaveProperty("seed");
    expect(savedMoves().map((e) => e.gameId)).toEqual(["game-new"]);
  });

  it("does not use a unit up when the app only goes inactive (the notification shade, the app switcher)", async () => {
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1);
    await setAppState("inactive");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await setAppState("background");
    expect(savedMoves()).toHaveLength(1);
    await api.unmount();
  });

  it("saves the chunk when another screen covers the game (navigation blur)", async () => {
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(entries()).toEqual([[0, 1]]);
    await api.unmount();
  });

  it("takes its blur and app state listeners off when the screen unmounts", async () => {
    const removed = jest.fn();
    appStateSpy.mockImplementation(() => ({ remove: removed }) as never);
    const api = await mountWith(fourTiles());
    const blurBefore = mockNavListeners.get("blur")?.length ?? 0;
    expect(blurBefore).toBeGreaterThan(0);
    await api.unmount();
    expect(mockNavListeners.get("blur")?.length ?? 0).toBe(0);
    // every app state subscription the screen made was removed
    const changes = appStateSpy.mock.calls
      .slice(appStateBase)
      .filter(([type]) => type === "change");
    expect(changes.length).toBeGreaterThan(0);
    expect(removed).toHaveBeenCalledTimes(changes.length);
  });

  it("saves the chunk when the app goes to the background on a board whose clock is stopped (deadlocked)", async () => {
    // A free pair, and a pair stacked on one spot that can never be free: matching the first deadlocks.
    const api = await mountWith(
      fourTiles({
        shufflesLeft: 0,
        tiles: [
          { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
          { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 4, row: 0, layer: 0 },
          { id: 2, suit: "circles", rank: 2, faceId: 18, col: 8, row: 0, layer: 0 },
          { id: 3, suit: "circles", rank: 2, faceId: 18, col: 8, row: 0, layer: 1 },
        ],
      })
    );
    await tap(api, 0, 1);
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await setAppState("background");
    expect(entries()).toEqual([[0, 1]]);
    await api.unmount();
  });

  it("leaving a game by New Game saves its chunk to that game", async () => {
    mockStartGame.mockReturnValueOnce("game-1");
    const api = await mountWith(fourTiles());
    await tap(api, 0, 1);
    // the shell's New Game, from the overflow menu
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    const confirm = api.queryByLabelText("Start New");
    if (confirm) {
      await act(async () => {
        await fireEvent.press(confirm);
      });
    }
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    // saved before the abandon's game_ended
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
    await api.unmount();
    expect(savedMoves().map((e) => [e.gameId, e.data.m])).toEqual([["game-1", [[0, 1]]]]);
  });
});

// ---------------------------------------------------------------------------
// Isolation: recording never breaks play
// ---------------------------------------------------------------------------

describe("MahjongScreen — a recorder that throws does not break the game (#3285)", () => {
  it("matches, hint, undo, shuffle, leaving and the win still work when record() and flush() throw", async () => {
    jest.spyOn(GameRecorder.prototype, "record").mockImplementation(() => {
      throw new Error("recorder broke");
    });
    // The shared hook's own resume calls flush at mount: only the screen's calls throw.
    let mounted = false;
    jest.spyOn(GameRecorder.prototype, "flush").mockImplementation(() => {
      if (mounted) throw new Error("recorder broke");
    });
    const api = await mountWith(fourTiles({ pairsRemoved: 69 }));
    mounted = true;
    await tap(api, 0, 1);
    expect(api.queryByLabelText("mock-tile-0")).toBeNull(); // the pair left the board
    await press(api, "mahjong-hint-button");
    await press(api, "mahjong-undo-button"); // takes the match back
    expect(api.getByLabelText("mock-tile-0")).toBeTruthy(); // and came back
    await press(api, "mahjong-shuffle-button");
    await setAppState("background"); // flush throws inside the leave handler
    await setAppState("active");
    // the board is still playable to a win
    const [a, b] = getAnyFreePair(mockCanvasBoard.tiles as never)!;
    await tap(api, a, b);
    const rest = getAnyFreePair(mockCanvasBoard.tiles as never)!;
    await tap(api, rest[0], rest[1]);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1]).toEqual(expect.objectContaining({ outcome: "win" }));
    await api.unmount();
  });
});
