/**
 * SolitaireScreen replay recording (#3289): actions are logged in memory and
 * recorded in chunks; nothing is saved per tap or per Auto Complete step; the
 * app going to the background saves the chunk at once; a resumed game numbers
 * its chunks on from its save; a recording failure never reaches play.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent } from "@testing-library/react-native";
import { AppState } from "react-native";

import { MAX_RECORDED_ACTIONS, MAX_RECORDED_ROWS } from "../../game/_shared/cards/moveLog";
import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { AUTO_OFFSET, KIND } from "../../game/solitaire/replay";
import type { Rank, Suit } from "../../game/solitaire/types";
import {
  boardState,
  faceDown,
  faceUp,
  mountFresh,
  mountOn,
  pressLabel,
  tableauOf,
} from "./helpers/solitaireFixtures";

// Handlers the screen registered for the navigation `blur` event (another screen covering the game).
const mockBlurHandlers: (() => void)[] = [];
const goBlur = () =>
  act(async () => {
    for (const h of [...mockBlurHandlers]) h();
  });

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn((type: string, cb: () => void) => {
      if (type === "blur") mockBlurHandlers.push(cb);
      return jest.fn();
    }),
  }))
);
const mockStartGame = jest.fn();
const mockResumeGame = jest.fn();
const mockEnqueueEvents = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    resumeGame: lazy(() => mockResumeGame),
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
  // A killed app's open session is there to continue, unless a test says otherwise.
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue("game-1");
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockRecordChunk.throwing = false;
  appStateHandlers = [];
  mockBlurHandlers.length = 0;
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

const menuNewGame = async (api: Awaited<ReturnType<typeof mountOn>>) => {
  await pressLabel(api, "More options");
  await act(async () => {
    await fireEvent.press(api.getByText("New Game"));
  });
  await pressLabel(api, "Start New");
};

describe("a game that is not recorded, and one that is", () => {
  it("does not record a move the engine refuses", async () => {
    const api = await mountOn(
      withStock({ waste: [faceUp("hearts", 5)], tableau: tableauOf([faceUp("spades", 9)]) })
    );
    await pressLabel(api, "5 of Hearts");
    await pressLabel(api, "Empty Hearts foundation"); // a 5 cannot start a foundation
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await pressStock()(api);
    await goBackground();
    expect(savedActions().map((a) => a[3])).toEqual([[KIND.draw]]);
  });

  it("New Game mid-chunk saves the old game's chunk to it, and the new game counts from 0", async () => {
    mockStartGame.mockReturnValueOnce("game-2");
    const api = await mountOn(withStock());
    await pressStock()(api);
    await menuNewGame(api);
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.draw]]]);
    expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockCompleteGame.mock.invocationCallOrder)
    );
    await pressLabel(api, "Draw 1");
    await pressStock()(api);
    await goBackground();
    expect(savedActions().slice(1)).toEqual([["game-2", 0, 1, [KIND.draw]]]);
  });

  it("Play Again after a win starts a new game that counts from 0", async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      mockStartGame.mockReturnValueOnce("game-2");
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
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(savedActions().map((a) => a[0])).toEqual(["game-1", "game-1"]);
      await act(async () => {
        jest.advanceTimersByTime(10_000); // the win cascade, then the result card
      });
      await act(async () => {
        await fireEvent.press(api.getByRole("button", { name: "Play Again" }));
      });
      await pressStock()(api);
      await goBackground();
      const last = savedActions().at(-1);
      expect(last).toEqual(["game-2", 0, 1, [KIND.draw]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("is not recorded when the original session was not resumed: its new session has no seed", async () => {
    mockResumeGame.mockReturnValue(null);
    const api = await mountOn(withStock({ recorded: 60 }));
    await pressStock()(api);
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    // play and the session are as before: the move was made and a session opened
    expect(api.getByLabelText(/Draw 1 from stock, 1 cards remaining/)).toBeTruthy();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await api.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("an undo or a hint on such a game opens no session and records nothing", async () => {
    mockResumeGame.mockReturnValue(null);
    const api = await mountOn(
      withStock({
        recorded: 4,
        tableau: tableauOf([faceUp("spades", 1)]),
        undoStack: [withStock()],
      })
    );
    await pressLabel(api, "Hint");
    await pressLabel(api, "Undo");
    await goBackground();
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("is not recorded for a save with no count but some history, even when its session resumes", async () => {
    const api = await mountOn(withStock({ undoStack: [withStock()] }));
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    const saved = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(saved.recorded).toBeUndefined();
  });

  it.each([-1, 2.5, "7"])("treats a corrupt count (%p) like a missing one", async (bad) => {
    const api = await mountOn({
      ...withStock({ undoStack: [withStock()] }),
      recorded: bad,
    } as never);
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("a save with no count and no history is recorded from 0", async () => {
    const api = await mountOn(withStock());
    await pressStock()(api);
    await goBackground();
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.draw]]]);
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
    await goBackground(); // a throw here would fail the test
    await pressStock()(api);
    expect(api.getByLabelText(/Draw 1 from stock, 1 cards remaining/)).toBeTruthy();
  });
});

describe("a game that stopped recording stays stopped after another kill", () => {
  const latestSave = async () => JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");

  it("drops the count when the original session was not resumed, so the next resume is not recorded", async () => {
    mockResumeGame.mockReturnValue(null);
    const first = await mountOn(withStock({ recorded: 5, recordedRows: 1 }));
    await pressStock()(first);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    const save = await latestSave();
    expect(save.recorded).toBeUndefined();
    expect(save.recordedRows).toBeUndefined();
    await first.unmount();

    // Killed again; this time the new, seedless session is the one that resumes.
    mockResumeGame.mockReturnValue("game-2");
    const second = await mountFresh();
    await pressStock()(second);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect((await latestSave()).recorded).toBeUndefined();
  });

  it("an undo on such a game does not bring an older count back", async () => {
    mockResumeGame.mockReturnValue(null);
    const stamped = withStock({ recorded: 3, recordedRows: 1 });
    const api = await mountOn(withStock({ recorded: 5, recordedRows: 1, undoStack: [stamped] }));
    await pressLabel(api, "Undo");
    const save = await latestSave();
    expect(save.recorded).toBeUndefined();
    expect(save.recordedRows).toBeUndefined();
  });
});

describe("a game's recording is bounded across kills", () => {
  it("a game saved at the action limit records nothing more, and keeps its count", async () => {
    const api = await mountOn(withStock({ recorded: MAX_RECORDED_ACTIONS, recordedRows: 40 }));
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    const save = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(save.recorded).toBe(MAX_RECORDED_ACTIONS);
    expect(save.recordedRows).toBe(40);
  });

  it("a game saved at the row limit records nothing more", async () => {
    const api = await mountOn(withStock({ recorded: 200, recordedRows: MAX_RECORDED_ROWS }));
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("a corrupt row count counts as the limit", async () => {
    const api = await mountOn({ ...withStock({ recorded: 5 }), recordedRows: "x" } as never);
    await pressStock()(api);
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("stops at the limit inside a game: the last action is the 1,200th", async () => {
    const api = await mountOn(withStock({ recorded: MAX_RECORDED_ACTIONS - 1, recordedRows: 47 }));
    await pressStock()(api);
    await pressStock()(api);
    await goBackground();
    expect(savedActions()).toEqual([["game-1", MAX_RECORDED_ACTIONS - 1, 48, [KIND.draw]]]);
    const save = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(save.recorded).toBe(MAX_RECORDED_ACTIONS);
  });

  it("counts the rows a background flush cuts short, and saves them with the game", async () => {
    const api = await mountOn(withStock({ recorded: 10, recordedRows: 2 }));
    await pressStock()(api);
    await goBackground();
    await pressStock()(api);
    await goBackground();
    expect(savedActions().map((a) => [a[1], a[3]])).toEqual([
      [10, [KIND.draw]],
      [11, [KIND.draw]],
    ]);
    const save = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "{}");
    expect(save.recordedRows).toBe(3); // the second row was cut after this save
  });
});

describe("when the chunk in progress is saved", () => {
  it("on blur (another screen covers the game), not on inactive", async () => {
    const api = await mountOn(withStock());
    await pressStock()(api);
    await act(async () => {
      for (const h of appStateHandlers) h("inactive");
    });
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await goBlur();
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.draw]]]);
    expect(api).toBeDefined();
  });
});
