/**
 * SudokuScreen — replay recording (#3288, epic #3273): the puzzle in
 * `game_started`, every entry in memory until a chunk is full, the app going to
 * the background, a game resumed after a kill, and the kill switch.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import SudokuScreen from "../SudokuScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { enterDigit, loadPuzzle, selectCell, toggleNotesMode } from "../../game/sudoku/engine";
import { loadGame, saveGame } from "../../game/sudoku/storage";
import { GameRecorder } from "../../game/_shared/gameRecorder";
import { resetSentryThrottle } from "../../game/_shared/sentryThrottle";
import * as Sentry from "@sentry/react-native";
import { ENTRIES_PER_CHUNK, MAX_REPLAY_ROWS } from "../../game/sudoku/replay";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => () => {}),
  }))
);

type Saved = { type: string; data: Record<string, unknown> };
const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvents = jest.fn<undefined, [string, Saved[]]>();
const mockCompleteGame = jest.fn();
const mockMarkStarted = jest.fn();
const mockDiscardGame = jest.fn();
const mockResumeGame = jest.fn<string | null, [string, Record<string, unknown> | undefined]>();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
    markStarted: lazy(() => mockMarkStarted),
    discardGame: lazy(() => mockDiscardGame),
    resumeGame: lazy(() => mockResumeGame),
  });
});
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({
    getGameRank: () => Promise.resolve({ ranked: true, rank: 3, is_best: true, reason: null }),
  })
);
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSentryThrottle();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-123");
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockMarkStarted.mockReset();
  mockDiscardGame.mockReset();
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue(null);
});

const entriesSaved = () =>
  mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    events.filter((e) => e.type === "entries").map((e) => ({ gameId, ...e.data }))
  ) as { gameId: string; i: number; unit: number; e: number[][] }[];

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SudokuScreen />
    </ThemeProvider>
  );
}

type Rendered = Awaited<ReturnType<typeof renderScreen>>;

async function startEasy(): Promise<Rendered> {
  const rendered = await renderScreen();
  await waitFor(() => rendered.getByLabelText(/start/i));
  // A fixed puzzle (#3423): Start picks one at random, and in about 1 in 500
  // easy puzzles a digit the tests press is already placed 9 times, which
  // disables its number-pad key and turns the press into a no-op (no entry).
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  try {
    await fireEvent.press(rendered.getByLabelText(/start/i));
  } finally {
    random.mockRestore();
  }
  return rendered;
}

const emptyCells = (r: Rendered) =>
  r.getAllByRole("button").filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));

async function pressDigit(r: Rendered, d: number) {
  await act(async () => {
    await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${d}`, "i")));
  });
}

/** Select the n-th empty cell and press digit `d` (placed, or a note in notes mode). */
async function enter(r: Rendered, n: number, d: number) {
  await act(async () => {
    await fireEvent.press(emptyCells(r)[n]!);
  });
  await pressDigit(r, d);
}

function spyAppState() {
  const spy = jest.spyOn(AppState, "addEventListener");
  return {
    spy,
    go: async (status: AppStateStatus) => {
      await act(async () => {
        for (const [type, listener] of spy.mock.calls) {
          if (type === "change") (listener as (s: AppStateStatus) => void)(status);
        }
      });
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SudokuScreen — replay recording (#3288)", () => {
  it("records the givens once, in game_started, and keeps them out of the metadata", async () => {
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    const [type, metadata, eventData] = mockStartGame.mock.calls[0]!;
    expect(type).toBe("sudoku");
    // the metadata is the backend's SudokuMetadata (extra="forbid"): no puzzle
    expect(metadata).toEqual({ difficulty: "easy", variant: "classic" });
    expect(eventData).toEqual({
      difficulty: "easy",
      variant: "classic",
      puzzle: expect.stringMatching(/^[0-9]{81}$/),
    });
  });

  it("keeps entries in memory while playing: no queue save until a chunk is full or the player leaves", async () => {
    const rendered = await startEasy();
    for (let n = 0; n < 6; n++) await enter(rendered, n, 1 + (n % 9));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50)); // any idle task would have run
    });
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("hands the chunk in progress to the queue the moment the app goes to the background, before any idle moment", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await enter(rendered, 1, 2);
    await enter(rendered, 2, 3);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();

    await app.go("background"); // synchronous: no waiting for an idle task
    const saved = entriesSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.gameId).toBe("game-123");
    expect(saved[0]!.i).toBe(0);
    expect(saved[0]!.unit).toBe(1);
    expect(saved[0]!.e).toHaveLength(3);
    for (const entry of saved[0]!.e) expect(entry[0]).toBe(0); // digits placed, in order

    // play goes on: the next entries are the next ones, in the same unit
    await enter(rendered, 3, 4);
    await app.go("background");
    const after = entriesSaved();
    expect(after.map((s) => [s.i, s.unit, s.e.length])).toEqual([
      [0, 1, 3],
      [3, 1, 1],
    ]);
    await rendered.unmount();
  });

  it("by the time the app is in the background every entry so far has been handed to the queue", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    const played = [
      [0, 5],
      [1, 6],
      [2, 7],
      [3, 8],
    ];
    for (const [n, d] of played) await enter(rendered, n!, d!);
    await app.go("background");
    // the enqueue calls above were synchronous; what the store does with them after is not asserted here
    expect(entriesSaved().flatMap((s) => s.e)).toHaveLength(played.length);
  });

  it("hands a full chunk to the queue at the recorder's next idle moment, with no flush needed", async () => {
    const rendered = await startEasy();
    // notes are entries too: ENTRIES_PER_CHUNK of them fill a chunk
    await act(async () => {
      await fireEvent.press(rendered.getAllByLabelText(/pencil/i)[0]!);
    });
    await act(async () => {
      await fireEvent.press(emptyCells(rendered)[0]!);
    });
    for (let n = 0; n < ENTRIES_PER_CHUNK; n++) await pressDigit(rendered, 1 + (n % 3));
    // the recorder saves a closed unit at its next idle moment
    await waitFor(() => expect(entriesSaved()).toHaveLength(1), { timeout: 5000 });
    const [chunk] = entriesSaved();
    expect(chunk!.i).toBe(0);
    expect(chunk!.e).toHaveLength(ENTRIES_PER_CHUNK);
    expect(chunk!.e.every((entry) => entry[0] === 1)).toBe(true); // all notes
  });

  it("leaving the game hands the partial chunk to the queue ahead of the session's end", async () => {
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await enter(rendered, 1, 2);
    mockCompleteGame.mockClear();
    await rendered.unmount();
    const saved = entriesSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.e).toHaveLength(2);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
  });

  it("saves the entry count with the game", async () => {
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await enter(rendered, 1, 2);
    await waitFor(async () => expect((await loadGame())?.entryCount).toBe(2));
    await rendered.unmount();
  });

  it("numbers a resumed game's entries and units from its saved count, not from 1", async () => {
    const saved = { ...loadPuzzle("easy", "classic", () => 0), entryCount: 40 };
    await saveGame(saved);
    mockResumeGame.mockReturnValue("orphan-1");
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 1);
    await enter(rendered, 1, 2);
    await app.go("background");
    const events = entriesSaved();
    expect(events).toHaveLength(1);
    expect(events[0]!.gameId).toBe("orphan-1");
    expect(events[0]!.i).toBe(40);
    expect(events[0]!.unit).toBe(2); // entries 32..63 are chunk 2, and the first 8 were saved before
    await waitFor(async () => expect((await loadGame())?.entryCount).toBe(42));
    await rendered.unmount();
  });

  it("a restored game with moves whose session could not be resumed records nothing, and keeps no count", async () => {
    const base = loadPuzzle("easy", "classic", () => 0);
    const cell = base.puzzle.indexOf("0");
    const played = enterDigit(selectCell(base, Math.floor(cell / 9), cell % 9), 1);
    await saveGame({ ...played, entryCount: 5 });
    mockResumeGame.mockReturnValue(null); // the killed process's session is gone
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await enter(rendered, 1, 3);
    await app.go("background");
    expect(mockStartGame).toHaveBeenCalledTimes(1); // the game itself is still tracked
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await waitFor(async () => expect((await loadGame())?.entryCount).toBeUndefined());
    await rendered.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("a save from before recording (moves, no entryCount) records nothing even when its session resumes", async () => {
    const base = loadPuzzle("easy", "classic", () => 0);
    const cell = base.puzzle.indexOf("0");
    await saveGame(enterDigit(selectCell(base, Math.floor(cell / 9), cell % 9), 1));
    mockResumeGame.mockReturnValue("orphan-legacy"); // its game_started has no puzzle
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await app.go("background");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await rendered.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect((await loadGame())?.entryCount).toBeUndefined();
  });

  it("a restored game with no moves records from the first entry", async () => {
    await saveGame(loadPuzzle("easy", "classic", () => 0));
    mockResumeGame.mockReturnValue(null);
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await app.go("background");
    const events = entriesSaved();
    expect(events).toHaveLength(1);
    expect(events[0]!.i).toBe(0);
    expect(mockStartGame.mock.calls[0]![2]).toMatchObject({ puzzle: expect.any(String) });
    await rendered.unmount();
  });

  it("erase and undo change the grid but do not open the sync session", async () => {
    const base = loadPuzzle("easy", "classic", () => 0);
    const cell = base.puzzle.indexOf("0");
    const label = `Cell row ${Math.floor(cell / 9) + 1}, column ${(cell % 9) + 1}, `;
    await saveGame({
      ...enterDigit(selectCell(base, Math.floor(cell / 9), cell % 9), 1),
      entryCount: 1,
    });
    mockResumeGame.mockReturnValue(null);
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    expect(rendered.getByLabelText(`${label}1`)).toBeTruthy();
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText(/erase/i));
    });
    expect(rendered.getByLabelText(`${label}empty`)).toBeTruthy(); // the erase changed the grid
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText(/undo/i));
    });
    expect(rendered.getByLabelText(`${label}1`)).toBeTruthy(); // and the undo put it back
    expect(mockStartGame).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it("a restore with everything undone but a count, and no session to resume, records nothing", async () => {
    // entryCount > 0 yet no moves left on the board: the new session would start mid-record
    await saveGame({ ...loadPuzzle("easy", "classic", () => 0), entryCount: 7 });
    mockResumeGame.mockReturnValue(null);
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await app.go("background");
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await rendered.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("digit, digit, undo, digit: i runs 0..3, the ops follow, and the count is 4 (undo keeps the count)", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await enter(rendered, 1, 2);
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText(/undo/i));
    });
    await enter(rendered, 2, 3);
    await app.go("background");
    const events = entriesSaved();
    expect(events).toHaveLength(1);
    expect(events[0]!.i).toBe(0);
    expect(events[0]!.e.map((e) => e[0])).toEqual([0, 0, 3, 0]);
    expect(events[0]!.e[2]).toEqual([3]);
    await waitFor(async () => expect((await loadGame())?.entryCount).toBe(4));
    await rendered.unmount();
  });

  it("an app that only becomes inactive hands nothing over; going to the background does", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await app.go("inactive");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await app.go("background");
    expect(entriesSaved()).toHaveLength(1);
    await rendered.unmount();
  });

  it("a resumed game that already used its rows records nothing more (replayRows restored)", async () => {
    await saveGame({
      ...loadPuzzle("easy", "classic", () => 0),
      entryCount: 10,
      replayRows: MAX_REPLAY_ROWS,
    });
    mockResumeGame.mockReturnValue("orphan-full");
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await app.go("background");
    await rendered.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("a resumed game with rows left records, and its next row is counted from the saved ones", async () => {
    await saveGame({
      ...loadPuzzle("easy", "classic", () => 0),
      entryCount: 10,
      replayRows: MAX_REPLAY_ROWS - 1,
    });
    mockResumeGame.mockReturnValue("orphan-one-left");
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 0, 2);
    await app.go("background"); // the last row
    await enter(rendered, 1, 3);
    await app.go("background"); // over the limit
    expect(entriesSaved().map((e) => e.i)).toEqual([10]);
    await rendered.unmount();
  });

  it("a save from before recording with only pencil notes records nothing", async () => {
    const base = loadPuzzle("easy", "classic", () => 0);
    const cell = base.puzzle.indexOf("0");
    await saveGame(
      enterDigit(toggleNotesMode(selectCell(base, Math.floor(cell / 9), cell % 9)), 4)
    );
    mockResumeGame.mockReturnValue("orphan-notes");
    const app = spyAppState();
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    await enter(rendered, 1, 2);
    await app.go("background");
    await rendered.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("background, kill and resume with one action per launch stays within the row limit", async () => {
    const app = spyAppState();
    // launch 1: a fresh puzzle, notes mode on, a cell selected (both are saved with the game)
    let rendered = await startEasy();
    await act(async () => {
      await fireEvent.press(rendered.getAllByLabelText(/pencil/i)[0]!);
    });
    await act(async () => {
      await fireEvent.press(emptyCells(rendered)[0]!);
    });
    const launches = MAX_REPLAY_ROWS + 6;
    for (let n = 0; n < launches; n++) {
      if (n > 0) {
        mockResumeGame.mockReturnValue("orphan-launches");
        rendered = await renderScreen();
        await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
      }
      await pressDigit(rendered, 1 + (n % 9)); // one action
      await app.go("background"); // hands the row over; the process is then killed
      await waitFor(async () => expect((await loadGame())?.entryCount).toBe(n + 1));
      await rendered.unmount();
      app.spy.mockClear();
    }
    const rows = entriesSaved();
    expect(rows).toHaveLength(MAX_REPLAY_ROWS);
    expect(rows.map((r) => r.i)).toEqual(Array.from({ length: MAX_REPLAY_ROWS }, (_, k) => k));
    expect((await loadGame())?.replayRows).toBe(MAX_REPLAY_ROWS);
  }, 180_000);

  it("stops recording at the row limit and keeps the row count with the game", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    // notes on one cell: one entry, one background, one tiny row each time
    await act(async () => {
      await fireEvent.press(rendered.getAllByLabelText(/pencil/i)[0]!);
    });
    await act(async () => {
      await fireEvent.press(emptyCells(rendered)[0]!);
    });
    for (let n = 0; n < MAX_REPLAY_ROWS + 5; n++) {
      await pressDigit(rendered, 1 + (n % 9));
      await app.go("background");
    }
    expect(entriesSaved()).toHaveLength(MAX_REPLAY_ROWS);
    await waitFor(async () => expect((await loadGame())?.replayRows).toBe(MAX_REPLAY_ROWS));
    await rendered.unmount();
  }, 60_000);

  it("two taps batched under StrictMode (updaters run twice) are recorded once each", async () => {
    const app = spyAppState();
    const rendered = await render(
      <React.StrictMode>
        <ThemeProvider>
          <SudokuScreen />
        </ThemeProvider>
      </React.StrictMode>
    );
    await waitFor(() => rendered.getByLabelText(/start/i));
    await fireEvent.press(rendered.getByLabelText(/start/i));
    const cell = emptyCells(rendered)[0]!;
    // one act: the presses are batched, so React queues both digit updaters
    await act(async () => {
      fireEvent.press(cell);
      fireEvent.press(rendered.getByLabelText(/enter digit 1/i));
      fireEvent.press(rendered.getByLabelText(/enter digit 2/i));
    });
    await app.go("background");
    const events = entriesSaved();
    expect(events).toHaveLength(1);
    expect(events[0]!.i).toBe(0);
    expect(events[0]!.e.map((e) => [e[0], e[2]])).toEqual([
      [0, 1],
      [0, 2],
    ]);
    await waitFor(async () => expect((await loadGame())?.entryCount).toBe(2));
    await rendered.unmount();
  });

  it("a new puzzle counts from its first entry and its givens are its own", async () => {
    const app = spyAppState();
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await app.go("background");
    expect(entriesSaved().map((s) => s.i)).toEqual([0]);
    mockStartGame.mockReturnValue("game-456");
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(rendered.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText("Start New"));
    });
    await act(async () => {
      await fireEvent.press(rendered.getByText("Quick Restart"));
    });
    await enter(rendered, 0, 1);
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(2));
    await app.go("background");
    const events = entriesSaved();
    expect(events.map((s) => [s.gameId, s.i])).toEqual([
      ["game-123", 0],
      ["game-456", 0],
    ]);
    await rendered.unmount();
  });

  it("a recorder that throws never breaks play: the game goes on and the failure is reported once", async () => {
    const boom = jest.spyOn(GameRecorder.prototype, "record").mockImplementation(() => {
      throw new Error("boom");
    });
    const captured = jest.spyOn(Sentry, "captureMessage");
    const app = spyAppState();
    const rendered = await startEasy();
    await enter(rendered, 0, 1);
    await app.go("background"); // hands the chunk to the recorder: record() throws
    await enter(rendered, 1, 2); // the screen still takes input
    await app.go("background");
    expect(boom).toHaveBeenCalled();
    const reports = captured.mock.calls.filter(([m]) => /replay recording failed/.test(m));
    expect(reports).toHaveLength(1); // throttled: one per hour
    // the cells took the digits
    expect(
      rendered
        .getAllByRole("button")
        .filter((n) => /, [1-9]$/.test(String(n.props.accessibilityLabel ?? ""))).length
    ).toBeGreaterThan(0);
    await waitFor(async () => expect((await loadGame())?.entryCount).toBe(2));
    await rendered.unmount();
  });
});
