/**
 * SolitaireScreen header and board actions (#2957): the hint highlights, an
 * Auto-Complete cut short by a new game, navigation out of the game, and the
 * test-build deal that skips the draw-mode picker.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { Move, Rank, Suit } from "../../game/solitaire/types";
import {
  boardState,
  faceDown,
  faceUp,
  mountFresh,
  mountOn,
  pressLabel,
  tableauOf,
} from "./helpers/solitaireFixtures";

jest.setTimeout(15000);

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

const mockTestHooks = { enabled: false };
jest.mock("../../game/_shared/testHooks", () => ({
  areTestHooksEnabled: () => mockTestHooks.enabled,
}));

const BONUS_COLOR = "#4ade80";

const sequence = (suit: Suit, upTo: number) =>
  Array.from({ length: upTo }, (_, i) => faceUp(suit, (i + 1) as Rank));

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockPopToTop.mockClear();
  mockTestHooks.enabled = false;
});

describe("hint", () => {
  it("is disabled when the board has no useful move", async () => {
    const api = await mountOn(boardState());
    expect(api.getByLabelText("Hint").props.accessibilityState?.disabled).toBe(true);
  });

  it("marks the card to move and the empty column to move it to", async () => {
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceDown("clubs", 4), faceUp("spades", 13)]) })
    );
    expect(api.queryByTestId("solitaire-hint-source")).toBeNull();
    await pressLabel(api, "Hint");
    expect(api.getByTestId("solitaire-hint-source")).toBeTruthy();
    expect(api.getByLabelText("Empty tableau column 2")).toHaveStyle({ borderColor: BONUS_COLOR });
    expect(api.getByLabelText("Empty tableau column 3")).not.toHaveStyle({
      borderColor: BONUS_COLOR,
    });
  });

  it("marks a tableau card and the foundation it can go to", async () => {
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("spades", 1)]) }));
    await pressLabel(api, "Hint");
    expect(api.getByTestId("solitaire-hint-source")).toBeTruthy();
    expect(api.getByLabelText("Empty Spades foundation")).toHaveStyle({
      borderColor: BONUS_COLOR,
    });
    expect(api.getByLabelText("Empty Hearts foundation")).not.toHaveStyle({
      borderColor: BONUS_COLOR,
    });
  });

  it("marks the waste card's foundation", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("hearts", 1)] }));
    await pressLabel(api, "Hint");
    expect(api.getByLabelText("Empty Hearts foundation")).toHaveStyle({
      borderColor: BONUS_COLOR,
    });
    expect(api.getByLabelText("Empty Spades foundation")).not.toHaveStyle({
      borderColor: BONUS_COLOR,
    });
  });

  it("marks the column a waste card can go to", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("hearts", 13)] }));
    await pressLabel(api, "Hint");
    expect(api.getByLabelText("Empty tableau column 1")).toHaveStyle({
      borderColor: BONUS_COLOR,
    });
    expect(api.getByLabelText("Empty tableau column 2")).not.toHaveStyle({
      borderColor: BONUS_COLOR,
    });
  });

  it("marks the column for a hint that sends a foundation card back", async () => {
    // The hint engine never suggests this move; a saved game can still carry it.
    const hint: Move = { type: "foundation-to-tableau", fromSuit: "hearts", toCol: 2 };
    const api = await mountOn(
      boardState({
        hint,
        foundations: { spades: [], hearts: [faceUp("hearts", 1)], diamonds: [], clubs: [] },
      })
    );
    expect(api.getByLabelText("Empty tableau column 3")).toHaveStyle({
      borderColor: BONUS_COLOR,
    });
  });

  it("costs points", async () => {
    const api = await mountOn(boardState({ score: 20, tableau: tableauOf([faceUp("spades", 1)]) }));
    expect(api.getByLabelText("Score: 20")).toBeTruthy();
    await pressLabel(api, "Hint");
    expect(api.queryByLabelText("Score: 20")).toBeNull();
  });
});

describe("Auto-Complete cut short by a new game", () => {
  it("stops its next step, and leaves the draw-mode picker up with no saved game", async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      // Two clubs left on the waste: the tap plays the Queen and schedules the King.
      const api = await mountOn(
        boardState({
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
      expect(api.queryByTestId("solitaire-result")).toBeNull();

      await pressLabel(api, "More options");
      await act(async () => {
        await fireEvent.press(api.getByText("New Game"));
      });
      await pressLabel(api, "Start New");
      expect(api.getByLabelText("Draw 1")).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(api.getByLabelText("Draw 1")).toBeTruthy();
      expect(api.queryByTestId("solitaire-result")).toBeNull();
      await expect(AsyncStorage.getItem("solitaire_game")).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("leaving the game", () => {
  it("goes back to the lobby from the header", async () => {
    const api = await mountOn(boardState());
    await pressLabel(api, "Go back to home screen");
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("goes home from the result card", async () => {
    const api = await mountOn(
      boardState({
        isComplete: true,
        score: 820,
        foundations: {
          spades: sequence("spades", 13),
          hearts: sequence("hearts", 13),
          diamonds: sequence("diamonds", 13),
          clubs: sequence("clubs", 13),
        },
      })
    );
    await act(async () => {
      await fireEvent.press(api.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });
});

describe("test builds", () => {
  it("deal draw-1 straight away on a clean slot, with no picker", async () => {
    mockTestHooks.enabled = true;
    const api = await mountFresh();
    expect(api.getByLabelText("Score: 0")).toBeTruthy();
    expect(api.queryByLabelText("Draw 3")).toBeNull();
    expect(api.getByLabelText("Draw 1 from stock, 24 cards remaining")).toBeTruthy();
  });

  it("still show the picker in a normal build", async () => {
    const api = await mountFresh();
    expect(api.getByLabelText("Draw 1")).toBeTruthy();
    expect(api.getByLabelText("Draw 3")).toBeTruthy();
  });
});
