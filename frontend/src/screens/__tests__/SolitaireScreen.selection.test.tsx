/**
 * SolitaireScreen taps (#2957): the foundation, tableau, empty-column and waste
 * presses of the selection state machine, with the invalid-move feedback each
 * rejected tap gives. Each test resumes a hand-built board (helpers/solitaireFixtures)
 * and taps cards by their accessibility labels.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { playedCount } from "../../test-utils/mockScreenDeps";
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
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

// Sounds by name, so a test can tell the invalid-move buzz from a card placement.
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const invalidBuzzes = () => playedCount(mockPlayed, "solitaire.invalidMove");

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
});

describe("foundation taps", () => {
  const spadesAndHearts = { spades: [faceUp("spades", 1)], hearts: [faceUp("hearts", 1)] };

  it("selects a non-empty foundation, and a second tap deselects it", async () => {
    const api = await mountOn(
      boardState({
        foundations: { ...boardState().foundations, ...spadesAndHearts },
      })
    );
    await pressLabel(api, "A of Spades");
    expect(api.getByLabelText("A of Spades (selected)")).toBeTruthy();
    await pressLabel(api, "A of Spades (selected)");
    expect(api.queryByLabelText("A of Spades (selected)")).toBeNull();
    expect(invalidBuzzes()).toBe(0);
  });

  it("leaves an empty foundation alone when nothing is selected", async () => {
    const api = await mountOn(boardState());
    await pressLabel(api, "Empty Hearts foundation");
    expect(invalidBuzzes()).toBe(0);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("rejects a tap on another foundation while one is selected, keeping the selection", async () => {
    const api = await mountOn(
      boardState({ foundations: { ...boardState().foundations, ...spadesAndHearts } })
    );
    await pressLabel(api, "A of Spades");
    await pressLabel(api, "A of Hearts");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("A of Spades (selected)")).toBeTruthy();
  });

  it("sends the selected waste card to its foundation", async () => {
    const api = await mountOn(
      boardState({
        waste: [faceUp("spades", 2)],
        foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] },
      })
    );
    await pressLabel(api, "2 of Spades");
    await pressLabel(api, "A of Spades");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(invalidBuzzes()).toBe(0);
    expect(api.queryByLabelText("2 of Spades (selected)")).toBeNull();
  });

  it("rejects a waste card that does not fit the foundation", async () => {
    const api = await mountOn(
      boardState({
        waste: [faceUp("diamonds", 5)],
        foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] },
      })
    );
    await pressLabel(api, "5 of Diamonds");
    await pressLabel(api, "A of Spades");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("sends the selected top tableau card to its foundation", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("spades", 2)]),
        foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] },
      })
    );
    await pressLabel(api, "2 of Spades");
    await pressLabel(api, "A of Spades");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(invalidBuzzes()).toBe(0);
  });

  it("rejects a selected tableau card that is not on top", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("spades", 9), faceUp("hearts", 8)]),
        foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] },
      })
    );
    await pressLabel(api, "9 of Spades");
    await pressLabel(api, "A of Spades");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("rejects a selected top tableau card that is not next on the foundation", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("diamonds", 5)]),
        foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] },
      })
    );
    await pressLabel(api, "5 of Diamonds");
    await pressLabel(api, "A of Spades");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });
});

describe("tableau taps", () => {
  it("sends the top card to its foundation on a double tap", async () => {
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("spades", 1)]) }));
    await pressLabel(api, "A of Spades");
    await pressLabel(api, "A of Spades (selected)");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.queryByLabelText("Empty Spades foundation")).toBeNull();
    expect(invalidBuzzes()).toBe(0);
  });

  it("rejects a double tap on a card that cannot go to the foundation", async () => {
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("diamonds", 5)]) }));
    await pressLabel(api, "5 of Diamonds");
    await pressLabel(api, "5 of Diamonds (selected)");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("rejects the selected waste card on a column it does not fit, keeping it selected", async () => {
    const api = await mountOn(
      boardState({
        waste: [faceUp("hearts", 5)],
        tableau: tableauOf([faceUp("clubs", 9)]),
      })
    );
    await pressLabel(api, "5 of Hearts");
    await pressLabel(api, "9 of Clubs");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
    expect(api.getByText("5 of Hearts (selected)")).toBeTruthy();
  });

  it("returns the selected foundation card to a column it fits", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("spades", 2)]),
        foundations: { ...boardState().foundations, hearts: [faceUp("hearts", 1)] },
      })
    );
    await pressLabel(api, "A of Hearts");
    await pressLabel(api, "2 of Spades");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(invalidBuzzes()).toBe(0);
    expect(api.getByLabelText("Empty Hearts foundation")).toBeTruthy();
  });

  it("rejects the selected foundation card on a column it does not fit", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("hearts", 3)]),
        foundations: { ...boardState().foundations, hearts: [faceUp("hearts", 1)] },
      })
    );
    await pressLabel(api, "A of Hearts");
    await pressLabel(api, "3 of Hearts");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
    expect(api.getByLabelText("A of Hearts (selected)")).toBeTruthy();
  });

  it("deselects a card tapped again, when it is not the top card", async () => {
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceUp("spades", 9), faceUp("hearts", 8)]) })
    );
    await pressLabel(api, "9 of Spades");
    expect(api.getByLabelText("9 of Spades (selected)")).toBeTruthy();
    await pressLabel(api, "9 of Spades (selected)");
    expect(api.queryByLabelText("9 of Spades (selected)")).toBeNull();
    expect(invalidBuzzes()).toBe(0);
  });

  it("moves the selection to another card of the same column", async () => {
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceUp("spades", 9), faceUp("hearts", 8)]) })
    );
    // Selecting the 9 selects the run it heads, 8 included.
    await pressLabel(api, "9 of Spades");
    expect(api.getByLabelText("9 of Spades (selected)")).toBeTruthy();
    expect(api.getByLabelText("8 of Hearts (selected)")).toBeTruthy();
    // Tapping the 8 narrows the selection to it.
    await pressLabel(api, "8 of Hearts (selected)");
    expect(api.getByLabelText("8 of Hearts (selected)")).toBeTruthy();
    expect(api.getByLabelText("9 of Spades")).toBeTruthy();
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("ignores a face-down card when nothing is selected", async () => {
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceDown("clubs", 4), faceUp("hearts", 3)]) })
    );
    await pressLabel(api, "Face-down card");
    expect(api.queryByLabelText(/selected/i)).toBeNull();
  });

  it("shows the selected card in the live region", async () => {
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("hearts", 3)]) }));
    await pressLabel(api, "3 of Hearts");
    expect(api.getByText("3 of Hearts (selected)")).toBeTruthy();
  });

  it("shows the selected foundation card in the live region", async () => {
    const api = await mountOn(
      boardState({ foundations: { ...boardState().foundations, clubs: [faceUp("clubs", 1)] } })
    );
    await pressLabel(api, "A of Clubs");
    expect(api.getByText("A of Clubs (selected)")).toBeTruthy();
  });
});

describe("empty column taps", () => {
  it("places a selected waste king", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("hearts", 13)] }));
    await pressLabel(api, "K of Hearts");
    await pressLabel(api, "Empty tableau column 1");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(invalidBuzzes()).toBe(0);
  });

  it("rejects a selected waste card that is not a king", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("hearts", 5)] }));
    await pressLabel(api, "5 of Hearts");
    await pressLabel(api, "Empty tableau column 1");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("places a selected foundation king", async () => {
    const api = await mountOn(
      boardState({ foundations: { ...boardState().foundations, hearts: [faceUp("hearts", 13)] } })
    );
    await pressLabel(api, "K of Hearts");
    await pressLabel(api, "Empty tableau column 1");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(invalidBuzzes()).toBe(0);
  });

  it("rejects a selected foundation card that is not a king", async () => {
    const api = await mountOn(
      boardState({ foundations: { ...boardState().foundations, spades: [faceUp("spades", 1)] } })
    );
    await pressLabel(api, "A of Spades");
    await pressLabel(api, "Empty tableau column 1");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("places a selected tableau king, turning up the card under it", async () => {
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceDown("clubs", 4), faceUp("spades", 13)]) })
    );
    await pressLabel(api, "K of Spades");
    await pressLabel(api, "Empty tableau column 2");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.getByLabelText("4 of Clubs")).toBeTruthy();
  });

  it("rejects a selected tableau card that is not a king", async () => {
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("diamonds", 5)]) }));
    await pressLabel(api, "5 of Diamonds");
    await pressLabel(api, "Empty tableau column 2");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });
});

describe("stock and waste taps", () => {
  it("does nothing when the stock and the waste are both empty", async () => {
    const api = await mountOn(boardState());
    await pressLabel(api, "Recycle waste back to stock (draw 1)");
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("recycles the waste into the stock when the stock runs out", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("hearts", 5), faceUp("clubs", 7)] }));
    await pressLabel(api, "Recycle waste back to stock (draw 1)");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.getByLabelText("Draw 1 from stock, 2 cards remaining")).toBeTruthy();
  });

  it("rejects a double tap on a waste card that cannot go to the foundation", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("diamonds", 5)] }));
    await pressLabel(api, "5 of Diamonds");
    await pressLabel(api, "5 of Diamonds");
    expect(invalidBuzzes()).toBe(1);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("deselects a waste card tapped again after the double-tap window", async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const api = await mountOn(boardState({ waste: [faceUp("diamonds", 5)] }));
      await pressLabel(api, "5 of Diamonds");
      expect(api.getByText("5 of Diamonds (selected)")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      await pressLabel(api, "5 of Diamonds");
      expect(api.queryByText("5 of Diamonds (selected)")).toBeNull();
      expect(invalidBuzzes()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("restoring a saved game (#3093)", () => {
  it("plays no sound for the last move's saved events", async () => {
    await mountOn(
      boardState({
        events: ["cardPlace", "cardFlip", "foundationComplete", "gameWin"],
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockPlayed).toEqual([]);
  });
});
