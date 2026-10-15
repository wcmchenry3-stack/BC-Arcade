/**
 * SolitaireScreen replay recording (#3289): actions are logged in memory and
 * recorded in chunks; nothing is saved per tap or per Auto Complete step; the
 * app going to the background saves the chunk at once; a resumed game numbers
 * its chunks on from its save; a recording failure never reaches play.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent } from "@testing-library/react-native";
import { AppState } from "react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { AUTO_OFFSET, KIND } from "../../game/solitaire/replay";
import type { Rank, Suit } from "../../game/solitaire/types";
import {
  boardState,
  faceDown,
  faceUp,
  mountOn,
  pressLabel,
  tableauOf,
} from "./helpers/solitaireFixtures";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
const mockStartGame = jest.fn();
const mockEnqueueEvents = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
  });
});
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

// `recordChunk` is the one call the screen makes into the recorder for a chunk:
// one test makes it throw.
const mockRecordChunk = { throwing: false };
jest.mock("../../game/_shared/cards/moveLog", () => {
  const actual = jest.requireActual("../../game/_shared/cards/moveLog");
  return {
    ...actual,
    recordChunk: (...args: unknown[]) => {
      if (mockRecordChunk.throwing) throw new Error("recorder down");
      return actual.recordChunk(...args);
    },
  };
});

let appStateHandlers: ((state: string) => void)[] = [];

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-1");
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockRecordChunk.throwing = false;
  appStateHandlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    handler: (state: string) => void
  ) => {
    appStateHandlers.push(handler);
    return { remove: () => undefined };
  }) as never);
});

afterEach(() => jest.restoreAllMocks());

const goBackground = () =>
  act(async () => {
    for (const h of appStateHandlers) h("background");
  });

/** Every action the recorder handed the queue, in order: [gameId, s, unit, action]. */
function savedActions(): [string, number, number, number[]][] {
  return mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    (events as { type: string; data: { s: number; unit: number; m: number[][] } }[])
      .filter((e) => e.type === "moves")
      .flatMap((e) =>
        e.data.m.map((a): [string, number, number, number[]] => [
          gameId as string,
          e.data.s,
          e.data.unit,
          a,
        ])
      )
  );
}

const sequence = (suit: Suit, upTo: number) =>
  Array.from({ length: upTo }, (_, i) => faceUp(suit, (i + 1) as Rank));

/** A resumable board with stock cards to draw. */
const withStock = (extra: Parameters<typeof boardState>[0] = {}) =>
  boardState({
    stock: [faceDown("clubs", 5), faceDown("hearts", 9), faceDown("spades", 7)],
    tableau: tableauOf([faceUp("diamonds", 4)]),
    ...extra,
  });

const pressStock = () => async (api: Awaited<ReturnType<typeof mountOn>>) => {
  await act(async () => {
    await fireEvent.press(api.getByTestId("solitaire-stock-pile"));
  });
};

describe("recording a game", () => {
  it("saves nothing per tap: taps are logged in memory", async () => {
    const api = await mountOn(withStock());
    await pressStock()(api);
    await pressStock()(api);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("saves the chunk in progress at once when the app goes to the background", async () => {
    const api = await mountOn(withStock());
    await pressStock()(api);
    await pressStock()(api);
    await goBackground();
    // synchronous: no timer or idle task had to run
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(savedActions().map((a) => a[3])).toEqual([[KIND.draw], [KIND.draw]]);
    expect(savedActions()[0]).toEqual(["game-1", 0, 1, [KIND.draw]]);
  });

  it("an undo and a hint are actions too", async () => {
    const api = await mountOn(withStock({ tableau: tableauOf([faceUp("spades", 1)]) }));
    await pressStock()(api);
    await pressLabel(api, "Undo");
    await pressLabel(api, "Hint");
    await goBackground();
    expect(savedActions().map((a) => a[3])).toEqual([[KIND.draw], [KIND.undo], [KIND.hint]]);
  });

  it("a hint before the first action is not recorded", async () => {
    const api = await mountOn(withStock({ tableau: tableauOf([faceUp("spades", 1)]) }));
    await pressLabel(api, "Hint");
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("a resumed game numbers its chunks on from the count its save carried", async () => {
    const api = await mountOn(withStock({ recorded: 60 }));
    await pressStock()(api);
    await goBackground();
    expect(savedActions()).toEqual([["game-1", 60, 3, [KIND.draw]]]);
  });

  it("stamps the count on the saved game, so a second kill carries on too", async () => {
    const api = await mountOn(withStock({ recorded: 60 }));
    await pressStock()(api);
    await pressStock()(api);
    await act(async () => {
      await Promise.resolve();
    });
    const saved = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(saved.recorded).toBe(62);
    expect(api).toBeTruthy();
  });

  it("an undo does not take the count back (it is an action)", async () => {
    const api = await mountOn(withStock({ tableau: tableauOf([faceUp("spades", 1)]) }));
    await pressStock()(api);
    await pressLabel(api, "Undo");
    const saved = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(saved.recorded).toBe(2);
  });

  it("leaving the game saves the chunk in progress before the abandon", async () => {
    const api = await mountOn(withStock());
    await pressStock()(api);
    await api.unmount();
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.draw]]]);
    const order = [
      ...mockEnqueueEvents.mock.invocationCallOrder,
      ...mockCompleteGame.mock.invocationCallOrder,
    ];
    expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockCompleteGame.mock.invocationCallOrder)
    );
    expect(order.length).toBeGreaterThan(1);
  });
});

describe("Auto Complete", () => {
  it("records each step as an auto action with no save per card, and the win saves them once", async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const api = await mountOn(
        boardState({
          recorded: 10,
          foundations: {
            spades: sequence("spades", 13),
            hearts: sequence("hearts", 13),
            diamonds: sequence("diamonds", 13),
            clubs: sequence("clubs", 11),
          },
          waste: [faceUp("clubs", 13), faceUp("clubs", 12)],
        })
      );
      await pressLabel(api, "Auto-Complete");
      expect(mockEnqueueEvents).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      // the win completes the session: both steps saved together, once
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
      expect(savedActions().map((a) => a[3])).toEqual([
        [AUTO_OFFSET + KIND.wasteToFoundation],
        [AUTO_OFFSET + KIND.wasteToFoundation],
      ]);
      expect(savedActions()[0]?.[1]).toBe(10);
      // the events reach the queue before game_ended
      expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
        Math.min(...mockCompleteGame.mock.invocationCallOrder)
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("a recording failure", () => {
  it("never reaches play: the move is made, the next one too", async () => {
    mockRecordChunk.throwing = true;
    const api = await mountOn(withStock());
    await pressStock()(api);
    await expect(goBackground()).resolves.toBeUndefined();
    await pressStock()(api);
    expect(api.getByLabelText(/Draw 1 from stock, 1 cards remaining/)).toBeTruthy();
  });
});
