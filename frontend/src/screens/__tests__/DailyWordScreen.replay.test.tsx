/**
 * Daily Word replay recording on the screen (#3287, epic #3273): every guess
 * attempt of a finished puzzle is in the event log, in order; the game rebuilds
 * from the saved events alone (the golden replay); a refusal made before the
 * session opens is not lost; a background saves at once; a restored board
 * continues the unit numbering; and the kill switch turns it all off.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

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
const mockStartGame = jest.fn(() => "game-1");
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    resumeGame: jest.fn(() => null),
    enqueueEvents: lazy(() => mockEnqueueEvents),
  });
});

// The kill switch (#3279 will drive it from the server): a test flips it per game.
const mockRecordingEnabled = jest.fn((_gameType: string) => true);
jest.mock("../../game/_shared/eventQueueConfig", () => ({
  ...jest.requireActual("../../game/_shared/eventQueueConfig"),
  isRecordingEnabled: (gameType: string) => mockRecordingEnabled(gameType),
}));

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

async function mount() {
  const view = await render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
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

let appStateListeners: ((state: string) => void)[];

beforeEach(() => {
  jest.clearAllMocks();
  enters = 0;
  mockRecordingEnabled.mockImplementation(() => true);
  dailyWordApi.getToday.mockResolvedValue(PUZZLE);
  dailyWordApi.getAnswer.mockResolvedValue({ answer: ANSWER });
  storage.loadState.mockResolvedValue(null);
  storage.saveState.mockResolvedValue(undefined);
  storage.clearState.mockResolvedValue(undefined);
  storage.pruneStates.mockResolvedValue(undefined);
  serverScores();
  appStateListeners = [];
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_event: string, handler: (state: string) => void) => {
      appStateListeners.push(handler);
      return { remove: jest.fn() };
    }
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const background = () =>
  act(async () => {
    appStateListeners.forEach((h) => h("background"));
  });

/** The idle moment never comes: only a background (a synchronous flush) can save a closed unit. */
function neverIdle() {
  const g = globalThis as { requestIdleCallback?: unknown };
  const before = g.requestIdleCallback;
  g.requestIdleCallback = jest.fn();
  return () => {
    g.requestIdleCallback = before;
  };
}

/** Every event saved so far, in order. */
function saved(): Saved[] {
  return mockEnqueueEvents.mock.calls.flatMap((c) => c[1]);
}

describe("DailyWordScreen — replay recording (#3287)", () => {
  it("records every guess of a finished puzzle in order, and the game rebuilds from them alone", async () => {
    await mount();
    await guess("zzzzz"); // not a word: refused, no row spent
    await clearRow();
    await guess("crane"); // row 1
    await guess("crane"); // already on the board: refused locally
    await clearRow();
    await guess("least"); // row 2
    await guess("stale"); // row 3
    await guess(ANSWER); // row 4: the win

    // The win completes the session, which saves everything before game_ended.
    await waitFor(() => expect(saved().length).toBe(6));
    const events = saved();
    expect(events.every((e) => e.type === "guess_submitted")).toBe(true);
    expect(events.map((e) => e.data.g)).toEqual([
      "zzzzz",
      "crane",
      "crane",
      "least",
      "stale",
      ANSWER,
    ]);
    expect(events.map((e) => e.data.rej ?? null)).toEqual(["nw", null, "dup", null, null, null]);
    // The unit is the row being filled; a refusal shares the row it was made on.
    expect(events.map((e) => [e.data.unit, e.data.n])).toEqual([
      [1, 1],
      [1, 1],
      [2, 2],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(events.map((e) => e.data.v)).toEqual([1, 1, 1, 1, 1, 1]);
    // The result string of each scored guess, one letter per tile.
    expect(events.map((e) => e.data.t ?? null)).toEqual([
      null,
      resultOf("crane"),
      null,
      resultOf("least"),
      resultOf("stale"),
      "ccccc",
    ]);
    // Time moves forward.
    const times = events.map((e) => e.data.t_ms as number);
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    // The golden replay: rebuild the board from the events alone and compare
    // it with the board the screen ended on (the last one it saved).
    const finalBoard = storage.saveState.mock.calls.at(-1)![0] as DailyWordState;
    const rebuilt = rebuild(events, PUZZLE_META);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.state.rows).toEqual(finalBoard.rows);
    expect(rebuilt.state.keyboard_state).toEqual(finalBoard.keyboard_state);
    expect(rebuilt.state.current_row).toBe(finalBoard.current_row);
    expect([rebuilt.state.is_complete, rebuilt.state.won]).toEqual([true, true]);
    expect(rebuilt.refused).toEqual([
      { n: 1, g: "zzzzz", rej: "nw" },
      { n: 2, g: "crane", rej: "dup" },
    ]);
    // What DailyWordProgress holds is the scored guesses, in order.
    const posted = dailyWordApi.submitGuess.mock.calls.map((c) => c[1] as string);
    expect(posted.filter((w) => w !== "zzzzz")).toEqual(
      events.filter((e) => e.data.t).map((e) => e.data.g)
    );
  });

  it("a refusal made before the session opens is not lost: it is saved with the first scored guess", async () => {
    const restore = neverIdle();
    await mount();
    await guess("zzzzz");
    // No game session yet: nothing to save to, and nothing dropped.
    expect(mockStartGame).not.toHaveBeenCalled();
    await background();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();

    await clearRow();
    await guess("crane");
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    // The idle save has not run; the background saves both now, in order.
    await background();
    expect(saved().map((e) => [e.data.g, e.data.rej ?? null])).toEqual([
      ["zzzzz", "nw"],
      ["crane", null],
    ]);
    expect(mockEnqueueEvents.mock.calls.every((c) => c[0] === "game-1")).toBe(true);
    restore();
  });

  it("saves at once when the app goes to the background, not at the next idle moment", async () => {
    const restore = neverIdle();
    await mount();
    await guess("crane");
    // The guess is waiting for its idle save.
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await background();
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(saved()[0]!.data).toEqual(expect.objectContaining({ g: "crane", n: 1, unit: 1 }));
    restore();
  });

  it("a restored board continues the numbering from its rows", async () => {
    const restore = neverIdle();
    storage.loadState.mockResolvedValue(boardWith(["crane", "least"]));
    await mount();
    await guess("stale");
    await background();
    expect(saved().map((e) => [e.data.unit, e.data.n, e.data.g])).toEqual([[3, 3, "stale"]]);
    restore();
  });

  it("the kill switch off: nothing is recorded or saved, and the game plays on", async () => {
    mockRecordingEnabled.mockImplementation(() => false);
    await mount();
    await guess("zzzzz");
    await clearRow();
    await guess("crane");
    await background();
    await guess("stale");
    await background();
    expect(mockRecordingEnabled).toHaveBeenCalledWith("daily_word");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    // The game itself carried on: two rows are on the board.
    expect(screen.getByTestId("tile-1-0")).toHaveTextContent("S");
  });
});

const PUZZLE_META = { puzzle_id: PUZZLE.puzzle_id, word_length: 5, language: "en" };

/** The result string the server's scoring gives `word` against the answer. */
function resultOf(word: string): string {
  return scoreGuess(ANSWER, word)
    .map((t) => ({ correct: "c", present: "p", absent: "a" })[t.status as string])
    .join("");
}
