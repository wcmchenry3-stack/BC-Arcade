/**
 * Daily Word replay recording on the screen (#3287, owner decision #3368): a
 * game is ONE `guess_submitted` event holding every scored guess, recorded when
 * the game ends (win, loss or abandon) and saved in the call that completes the
 * session. The game rebuilds from that event alone (the golden replay); leaving
 * a puzzle with guesses records it; a restored board logs all its rows; Play
 * Again starts a clean count on the new game; nothing is written while a puzzle
 * is being played, so a background can never leave a partial row. (The kill switch is tested on the recorder: replay.test.ts,
 * replay.bench.test.ts.)
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import DailyWordScreen from "../DailyWordScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { ApiError } from "../../game/_shared/httpClient";
import { rebuild } from "../../game/daily_word/replay";
import { scoreGuess } from "../../game/daily_word/localScoring";
import type { DailyWordState } from "../../game/daily_word/types";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ popToTop: jest.fn(), navigate: jest.fn() }), {
    actual: true,
    useRoute: () => ({ name: "DailyWord" }),
  })
);
jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());
jest.mock("../../game/daily_word/api", () => ({
  dailyWordApi: { getToday: jest.fn(), submitGuess: jest.fn(), getAnswer: jest.fn() },
}));
jest.mock("../../game/daily_word/storage", () => ({
  loadState: jest.fn(),
  saveState: jest.fn(),
  clearState: jest.fn(),
  pruneStates: jest.fn(),
  saveTodayMeta: jest.fn().mockResolvedValue(undefined),
  loadTodayMeta: jest.fn().mockResolvedValue(null),
}));

type Saved = { type: string; data: Record<string, unknown> };
const mockEnqueueEvents = jest.fn() as unknown as jest.Mock<undefined, [string, Saved[]]>;
const mockStartGame = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    resumeGame: jest.fn(() => null),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
  });
});

jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
  NotificationFeedbackType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

const { dailyWordApi } = jest.requireMock("../../game/daily_word/api") as {
  dailyWordApi: { getToday: jest.Mock; submitGuess: jest.Mock; getAnswer: jest.Mock };
};
const storage = jest.requireMock("../../game/daily_word/storage") as {
  loadState: jest.Mock;
  saveState: jest.Mock;
  clearState: jest.Mock;
  pruneStates: jest.Mock;
};

const ANSWER = "slate";
const PUZZLE = { puzzle_id: "2026-05-03:en", word_length: 5 };
const PUZZLE_META = { puzzle_id: PUZZLE.puzzle_id, word_length: 5, language: "en" };

const emptyRow = () => ({
  tiles: Array.from({ length: 5 }, () => ({ letter: "", status: "empty" as const })),
  submitted: false,
});
const wrongRow = (word: string) => ({
  tiles: word.split("").map((letter) => ({ letter, status: "absent" as const })),
  submitted: true,
});

/** A board in progress: `guessed` words already submitted. */
function boardWith(guessed: string[]): DailyWordState {
  return {
    _v: 1,
    puzzle_id: PUZZLE.puzzle_id,
    word_length: 5,
    language: "en",
    rows: Array.from({ length: 6 }, (_, i) => (guessed[i] ? wrongRow(guessed[i]!) : emptyRow())),
    current_row: guessed.length,
    keyboard_state: {},
    is_complete: false,
    won: false,
    completed_at: null,
  };
}

/** The server: scores a guess against the answer, refuses "zzzzz" as not a word. */
function serverScores() {
  dailyWordApi.submitGuess.mockImplementation(async (_puzzle: string, word: string) => {
    if (word === "zzzzz") throw new ApiError("not_a_word", 422);
    return { tiles: scoreGuess(ANSWER, word) };
  });
}

async function mount({ strict = false } = {}) {
  const tree = (
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
  const view = await render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  await screen.findByTestId("tile-0-0");
  return view;
}

const key = (k: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(`daily-word-key-${k}`));
  });

let enters = 0;
/** Types a word and presses Enter, past onSubmit's 500 ms debounce. */
async function guess(word: string) {
  for (const ch of word) await key(ch);
  const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5000 * (enters += 1));
  try {
    await key("enter");
  } finally {
    spy.mockRestore();
  }
}

/** Erases the typed row (a refused guess stays on its row). */
async function clearRow(length = 5) {
  for (let i = 0; i < length; i += 1) await key("delete");
}

beforeEach(() => {
  jest.clearAllMocks();
  enters = 0;
  mockStartGame.mockReset();
  mockStartGame.mockReturnValueOnce("game-1").mockReturnValueOnce("game-2");
  dailyWordApi.getToday.mockResolvedValue(PUZZLE);
  dailyWordApi.getAnswer.mockResolvedValue({ answer: ANSWER });
  storage.loadState.mockResolvedValue(null);
  storage.saveState.mockResolvedValue(undefined);
  storage.clearState.mockResolvedValue(undefined);
  storage.pruneStates.mockResolvedValue(undefined);
  serverScores();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Every event saved so far, in order, with the game it was saved to. */
function saved(): (Saved & { game: string })[] {
  return mockEnqueueEvents.mock.calls.flatMap((c) => c[1].map((e) => ({ ...e, game: c[0] })));
}

describe("DailyWordScreen — replay recording (#3287, #3368)", () => {
  it("records a finished game as one event, and the game rebuilds from it alone", async () => {
    await mount();
    await guess("zzzzz"); // not a word: refused, no row spent
    await clearRow();
    await guess("crane"); // row 1
    await guess("crane"); // already on the board: refused locally
    await clearRow();
    await guess("least"); // row 2
    await guess("stale"); // row 3
    // Nothing is written while the puzzle is being played.
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await guess(ANSWER); // row 4: the win

    await waitFor(() => expect(saved()).toHaveLength(1));
    const [event] = saved();
    expect(event!.type).toBe("guess_submitted");
    expect(event!.game).toBe("game-1");
    expect(event!.data).toEqual({
      v: 1,
      unit: 1,
      t_ms: expect.any(Number),
      g: ["crane", "least", "stale", ANSWER],
      t: [
        ...["crane", "least", "stale"].map((w) =>
          scoreGuess(ANSWER, w)
            .map((t) => ({ correct: "c", present: "p", absent: "a" })[t.status as string])
            .join("")
        ),
        "ccccc",
      ],
      rj: 2,
    });
    // Saved ahead of game_ended: the event is in the queue before the game completes.
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );

    // The golden replay: rebuild the board from the event alone and compare it
    // with the board the screen ended on (the last one it saved).
    const finalBoard = storage.saveState.mock.calls.at(-1)![0] as DailyWordState;
    const rebuilt = rebuild(saved(), PUZZLE_META);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.state.rows).toEqual(finalBoard.rows);
    expect(rebuilt.state.keyboard_state).toEqual(finalBoard.keyboard_state);
    expect(rebuilt.state.current_row).toBe(finalBoard.current_row);
    expect([rebuilt.state.is_complete, rebuilt.state.won]).toEqual([true, true]);
    expect(rebuilt.refusals).toBe(2);
    // What DailyWordProgress holds is the scored guesses, in order.
    const posted = dailyWordApi.submitGuess.mock.calls
      .map((c) => c[1] as string)
      .filter((w) => w !== "zzzzz");
    expect(posted).toEqual(event!.data.g);
  }, 30_000);

  it("under React.StrictMode (effects run twice) a game is still recorded once", async () => {
    await mount({ strict: true });
    await guess("crane");
    await guess(ANSWER);
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]!.data.g).toEqual(["crane", ANSWER]);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("a close-out from the server's 403, then leaving, records the game once", async () => {
    const view = await mount();
    await guess("crane");
    // the server already has the puzzle solved (a lost response): the board is closed out
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("already_solved", 403));
    await guess("least");
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]!.data.g).toEqual(["crane"]);
    await act(async () => {
      view.unmount();
    });
    expect(saved()).toHaveLength(1);
  }, 30_000);

  it("a puzzle left with scored guesses is recorded as it is abandoned, before the game ends", async () => {
    const view = await mount();
    await guess("crane");
    await guess("least");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
    expect(saved().map((e) => [e.game, e.data.g])).toEqual([["game-1", ["crane", "least"]]]);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
  });

  it("a puzzle left with no scored guess records nothing, whatever was refused", async () => {
    const view = await mount();
    await guess("zzzzz");
    await act(async () => {
      view.unmount();
    });
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("a restored board logs all its rows, the earlier session's included", async () => {
    storage.loadState.mockResolvedValue(boardWith(["crane", "least"]));
    await mount();
    await guess(ANSWER);
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]!.data.g).toEqual(["crane", "least", ANSWER]);
    expect(saved()[0]!.data.unit).toBe(1);
  });

  it("Play Again starts clean: a refusal on the new puzzle is counted on the new game", async () => {
    await mount();
    await guess(ANSWER); // game 1: won at once
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]!.data).not.toHaveProperty("rj");

    // Once the result card and its countdown are up, jump the clock past midnight
    // so Play Again shows, then load the next puzzle.
    await screen.findByText("You Win!");
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation(() => realNow() + 25 * 60 * 60 * 1000);
    await waitFor(() => expect(screen.getByRole("button", { name: "Play Again" })).toBeTruthy(), {
      timeout: 4000,
    });
    dailyWordApi.getToday.mockResolvedValue({ puzzle_id: "2026-05-04:en", word_length: 5 });
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Play Again" }));
    });
    await waitFor(() => expect(screen.queryByText("You Win!")).toBeNull());
    // the clock is real again, so the guess helper's own clock mocking stays sound
    (Date.now as jest.Mock).mockRestore();

    await guess("zzzzz"); // refused on the new puzzle
    await clearRow();
    await guess(ANSWER); // won on the new puzzle
    await waitFor(() => expect(saved()).toHaveLength(2));
    const [, second] = saved();
    expect(second!.game).toBe("game-2");
    expect(second!.data).toEqual(expect.objectContaining({ g: [ANSWER], rj: 1, unit: 1 }));
    expect(mockStartGame).toHaveBeenCalledTimes(2);
  }, 30_000);
});
