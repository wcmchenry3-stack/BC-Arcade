/**
 * HeartsScreen hand flow (#2957): passing, the trick animation hand-off between
 * the human and the AI loop, the between-hands card, the event overlays and
 * their sounds, the rename modal, blur-time saving, the debug panel and the
 * header's back and New Game. Each test resumes a hand-built game
 * (helpers/heartsFixtures) through the mocked `loadGame`.
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, dealGame, setRng } from "../../game/hearts/engine";
import { loadGame, saveGame } from "../../game/hearts/storage";
import { savePlayerNames } from "../../game/hearts/playerNames";
import type { HeartsState } from "../../game/hearts/types";
import { playedCount } from "../../test-utils/mockScreenDeps";
import { heartsCard, heartsDealing, heartsPlay, moonHaul } from "./helpers/heartsFixtures";

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadFinishedGameId: jest.fn().mockResolvedValue(null),
  saveFinishedGameId: jest.fn().mockResolvedValue(undefined),
}));
// Only the storage ends are replaced: the real validateName runs on a save.
jest.mock("../../game/hearts/playerNames", () => ({
  ...jest.requireActual("../../game/hearts/playerNames"),
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: mockGoBack,
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    {
      // The screen's focus effect, run as a plain mount effect: its cleanup is the blur.
      useFocusEffect: (effect: () => void | (() => void)) => {
        const { useEffect } = jest.requireActual<typeof import("react")>("react");
        useEffect(effect, [effect]);
      },
    }
  )
);

// Sounds by name, so a test can tell which one played.
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const played = (name: string) => playedCount(mockPlayed, name);

jest.useFakeTimers();

async function mountOn(state: HeartsState | null) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const api = await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
  // The load has landed once it was asked for and the screen shows its result: a
  // game on the table (the picker is gone), or the picker for no saved game.
  await waitFor(() => expect(loadGame).toHaveBeenCalled());
  await waitFor(() =>
    state === null
      ? expect(api.getByTestId("hearts-start-game")).toBeTruthy()
      : expect(api.queryByTestId("hearts-start-game")).toBeNull()
  );
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** Advances in `step` ms slices, letting the AI loop's next `delay` start between them. */
async function advanceSteps(total: number, step: number) {
  for (let elapsed = 0; elapsed < total; elapsed += step) await advance(step);
}

type Api = Awaited<ReturnType<typeof mountOn>>;

/**
 * Renders the screen again. The overlays write their opacity in an effect and
 * read it in the next render, so a state read after an event needs one more.
 */
function refresh(api: Api) {
  return api.rerender(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

/** Presses the element with this label; `hidden` reaches one a modal on top has hidden. */
async function press(api: Api, label: string | RegExp, { hidden = false } = {}) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label, { includeHiddenElements: hidden }));
  });
}

beforeEach(() => {
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  mockGoBack.mockClear();
  (loadGame as jest.Mock).mockClear();
  (saveGame as jest.Mock).mockClear();
  (savePlayerNames as jest.Mock).mockClear();
});

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("passing", () => {
  it("hands the three chosen cards over when Confirm is pressed, and play begins", async () => {
    const api = await mountOn(dealGame());
    expect(api.getByText("0 of 3 selected")).toBeTruthy();
    expect(api.getByLabelText(/^Confirm/).props.accessibilityState.disabled).toBe(true);

    for (const i of [0, 1, 2]) {
      await act(async () => {
        await fireEvent.press(api.getByTestId(`hearts-hand-card-${i}`));
      });
    }
    expect(api.getByText("3 of 3 selected")).toBeTruthy();

    await press(api, /^Confirm/);

    expect(api.queryByText(/of 3 selected/)).toBeNull();
    expect(api.queryByLabelText(/^Confirm/)).toBeNull();
    expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
  });
});

describe("between hands", () => {
  it("shows the scorecard, and Next Hand deals the next one and saves it", async () => {
    const api = await mountOn(heartsDealing());
    expect(api.getByText("Hand Complete")).toBeTruthy();
    expect(api.queryByText(/shot the moon! \+26/)).toBeNull();

    await press(api, "Next Hand");

    expect(api.queryByText("Hand Complete")).toBeNull();
    // Hand 2 passes right.
    expect(api.getByText(/pass right/i)).toBeTruthy();
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({ handNumber: 2 }));
  });

  it("names who shot the moon", async () => {
    const wonCards = [[], moonHaul(), [], []];
    const api = await mountOn(heartsDealing({ wonCards }));
    expect(api.getByText("West shot the moon! +26 to all others.")).toBeTruthy();
  });
});

describe("a trick completed by the human", () => {
  // Seat 1 led 5♦, 2 played 9♦, 3 played 7♦; the human's 10♦ takes it.
  const trickToComplete = () =>
    heartsPlay({
      currentLeaderIndex: 1,
      currentPlayerIndex: 0,
      currentTrick: [
        { playerIndex: 1, card: heartsCard("diamonds", 5) },
        { playerIndex: 2, card: heartsCard("diamonds", 9) },
        { playerIndex: 3, card: heartsCard("diamonds", 7) },
      ],
      playerHands: [
        [heartsCard("diamonds", 10), heartsCard("diamonds", 3), heartsCard("clubs", 4)],
        [heartsCard("diamonds", 2), heartsCard("clubs", 6)],
        [heartsCard("diamonds", 4), heartsCard("clubs", 8)],
        [heartsCard("diamonds", 6), heartsCard("clubs", 9)],
      ],
    });

  it("ignores taps until the take-away animation ends, then plays the trick-won sound", async () => {
    const api = await mountOn(trickToComplete());
    await press(api, /^10 of Diamonds/);
    expect(api.getByLabelText("Your hand, 2 cards")).toBeTruthy();
    expect(played("hearts.cardPlay")).toBe(1);
    expect(played("hearts.trickWon")).toBe(0);

    // A tap while the trick is still on the table is dropped.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 2 cards")).toBeTruthy();
    expect(played("hearts.cardPlay")).toBe(1);

    await advance(3000);
    expect(played("hearts.trickWon")).toBe(1);

    // The winner leads again.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });
});

describe("a trick completed by the AI", () => {
  // The human led 10♦; the AIs must follow with a lower diamond, so the human wins.
  const humanLeads = () =>
    heartsPlay({
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 10) }],
      playerHands: [
        [heartsCard("diamonds", 3), heartsCard("clubs", 4)],
        [heartsCard("diamonds", 2), heartsCard("diamonds", 6)],
        [heartsCard("diamonds", 5), heartsCard("diamonds", 8)],
        [heartsCard("diamonds", 4), heartsCard("diamonds", 9)],
      ],
    });

  it("waits for the animation, then hands the turn back to the human", async () => {
    const api = await mountOn(humanLeads());
    await advanceSteps(1300, 400); // three AI plays, 400 ms apart
    expect(played("hearts.cardPlay")).toBe(3);
    expect(played("hearts.trickWon")).toBe(0);
    await advance(3000);
    expect(played("hearts.trickWon")).toBe(1);

    // The human, who took the trick, leads the next one.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });

  it("stops quietly when the screen closes mid-animation", async () => {
    const api = await mountOn(humanLeads());
    await advanceSteps(1300, 400);
    await api.unmount();
    await advance(5000);
    expect(played("hearts.trickWon")).toBe(0);
  });
});

describe("event overlays", () => {
  const withEvents = (events: HeartsState["events"]) =>
    heartsPlay({ events, playerHands: [[heartsCard("clubs", 4)], [], [], []] });

  it("hearts broken: sounds, shows the overlay, then hides it", async () => {
    const api = await mountOn(withEvents([{ type: "heartsBroken" }]));
    expect(played("hearts.heartsBroken")).toBe(1);
    await refresh(api);
    expect(api.getByLabelText("Hearts broken")).toHaveStyle({ opacity: 1 });
    await advance(3500);
    await refresh(api);
    await refresh(api);
    expect(api.getByLabelText("Hearts broken")).toHaveStyle({ opacity: 0 });
  });

  it("the human shooting the moon sounds and names them, then hides the overlay", async () => {
    const api = await mountOn(withEvents([{ type: "moonShot", shooter: 0 }]));
    expect(played("hearts.moonShot")).toBe(1);
    await refresh(api);
    expect(api.getByLabelText("You shot the moon!")).toHaveStyle({ opacity: 1 });
    await advance(2300);
    await refresh(api);
    await refresh(api);
    expect(api.getByLabelText("You shot the moon!")).toHaveStyle({ opacity: 0 });
  });

  it("an AI shooting the moon names them without the human's sound", async () => {
    const api = await mountOn(withEvents([{ type: "moonShot", shooter: 2 }]));
    expect(played("hearts.moonShot")).toBe(0);
    await refresh(api);
    expect(api.getByLabelText("North shot the moon!")).toHaveStyle({ opacity: 1 });
  });

  it("the Queen of Spades taken: names who took it, then hides the overlay", async () => {
    const api = await mountOn(withEvents([{ type: "queenOfSpades", takerSeat: 1 }]));
    await refresh(api);
    expect(api.getByLabelText("West takes the Queen of Spades!")).toHaveStyle({ opacity: 1 });
    await advance(1100);
    await refresh(api);
    await refresh(api);
    expect(api.getByLabelText("West takes the Queen of Spades!")).toHaveStyle({ opacity: 0 });
  });

  it("the Queen of Spades played by an AI sounds once", async () => {
    await mountOn(withEvents([{ type: "queenOfSpadesPlayed" }]));
    expect(played("hearts.queenOfSpades")).toBe(1);
  });

  it("the Queen of Spades played by the human sounds once, not twice", async () => {
    const api = await mountOn(
      heartsPlay({
        playerHands: [[heartsCard("spades", 12), heartsCard("clubs", 4)], [], [], []],
        currentTrick: [],
      })
    );
    await press(api, /^Q of Spades/);
    expect(played("hearts.queenOfSpades")).toBe(1);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });
});

describe("leaving the table", () => {
  it("saves the game with its play time when the screen loses focus", async () => {
    const api = await mountOn(heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] }));
    (saveGame as jest.Mock).mockClear();
    await api.unmount();
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(saveGame).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "playing", accumulatedMs: expect.any(Number) })
    );
  });

  it("does not save a finished game on blur", async () => {
    const api = await mountOn(
      heartsPlay({
        phase: "game_over",
        isComplete: true,
        winnerIndex: 0,
        scoreHistory: [[5, 5, 5, 5]],
      })
    );
    (saveGame as jest.Mock).mockClear();
    await api.unmount();
    expect(saveGame).not.toHaveBeenCalled();
  });

  it("goes back from the pre-game picker and from a game", async () => {
    const pre = await mountOn(null);
    await press(pre, "Go back to home screen");
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await pre.unmount();

    const inGame = await mountOn(
      heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] })
    );
    await press(inGame, "Go back to home screen");
    expect(mockGoBack).toHaveBeenCalledTimes(2);
  });

  it("starts a game from the pre-game picker's New Game", async () => {
    const api = await mountOn(null);
    await press(api, "More options");
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    await press(api, "Start New");
    expect(api.queryByTestId("hearts-start-game")).toBeNull();
    expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
  });
});

describe("player names", () => {
  const inGame = () => heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] });

  async function openRename(api: Api) {
    await press(api, "More options");
    await act(async () => {
      await fireEvent.press(api.getByText("Edit Names"));
    });
  }

  it("saves the edited names, falling back to the default for a blank one", async () => {
    const api = await mountOn(inGame());
    await openRename(api);
    await act(async () => {
      await fireEvent.changeText(api.getByLabelText("Player 2 (default: West)"), "Zed");
      await fireEvent.changeText(api.getByLabelText("Player 3 (default: North)"), "   ");
    });
    await press(api, "Save");

    expect(savePlayerNames).toHaveBeenCalledWith(["You", "Zed", "North", "East"]);
    expect(api.queryByText("Player Names")).toBeNull();
    expect(api.getByText("Zed")).toBeTruthy();
  });

  it("keeps the old names when the edit is cancelled", async () => {
    const api = await mountOn(inGame());
    await openRename(api);
    await act(async () => {
      await fireEvent.changeText(api.getByLabelText("Player 2 (default: West)"), "Zed");
    });
    await press(api, "Cancel");

    expect(savePlayerNames).not.toHaveBeenCalled();
    expect(api.queryByText("Player Names")).toBeNull();
    // Reopening starts from the saved names, not the abandoned draft.
    await openRename(api);
    expect(api.getByLabelText("Player 2 (default: West)")).toHaveDisplayValue("West");
  });
});

describe("debug panel (dev builds)", () => {
  // Trick 13: the human led 5♥ and the AIs follow with their last diamonds.
  const finalTrick = () =>
    heartsPlay({
      handNumber: 1,
      passDirection: "none",
      tricksPlayedInHand: 12,
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ playerIndex: 0, card: heartsCard("hearts", 5) }],
      playerHands: [
        [],
        [heartsCard("diamonds", 7)],
        [heartsCard("diamonds", 8)],
        [heartsCard("diamonds", 9)],
      ],
    });

  it("toggles from the DBG button", async () => {
    const api = await mountOn(finalTrick());
    // The panel is a modal: once it is open, the table behind it is hidden from queries.
    const behind = { includeHiddenElements: true };
    expect(api.getByText("DBG ▴")).toBeTruthy();
    await press(api, "Toggle Hearts debugger panel");
    expect(api.getByText("DBG ▾", behind)).toBeTruthy();
    expect(api.getByText(/Hearts Debugger/)).toBeTruthy();
    await press(api, "Close debugger");
    expect(api.getByText("DBG ▴", behind)).toBeTruthy();
  });

  it("logs a finished hand with its trick, and keeps the notes typed against it", async () => {
    const api = await mountOn(finalTrick());
    await advance(2000);
    await waitFor(() => expect(api.getByText("Hand Complete")).toBeTruthy());

    // The hand-end card is a modal, so the panel opens behind it as far as queries go.
    const any = { includeHiddenElements: true };
    await press(api, "Toggle Hearts debugger panel", { hidden: true });
    expect(api.getByText("Hearts Debugger — 1 hand", any)).toBeTruthy();
    expect(api.getByText("Hand 1 — No Pass", any)).toBeTruthy();
    expect(api.getByText("Tricks (1)", any)).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(
        api.getByPlaceholderText("Observations about this hand...", any),
        "AI dumped a diamond"
      );
    });
    expect(api.getByPlaceholderText("Observations about this hand...", any)).toHaveDisplayValue(
      "AI dumped a diamond"
    );
  });
});
