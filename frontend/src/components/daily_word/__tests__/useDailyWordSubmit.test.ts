import { act, renderHook } from "@testing-library/react-native";

import {
  useDailyWordSubmit,
  type DailyWordSubmitHandlers,
  type DailyWordSubmitSync,
} from "../useDailyWordSubmit";
import {
  applyServerResult,
  initialState,
  setCurrentRowLetter,
} from "../../../game/daily_word/engine";
import type { DailyWordState, TileStatus } from "../../../game/daily_word/types";
import { ApiError } from "../../../game/_shared/httpClient";

jest.mock("../../../game/daily_word/api", () => ({
  dailyWordApi: {
    getToday: jest.fn(),
    submitGuess: jest.fn(),
    getAnswer: jest.fn(),
  },
}));

jest.mock("../../../game/daily_word/storage", () => ({
  saveState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
}));

const { dailyWordApi } = jest.requireMock("../../../game/daily_word/api") as {
  dailyWordApi: { submitGuess: jest.Mock; getAnswer: jest.Mock };
};
const Haptics = jest.requireMock("expo-haptics") as { impactAsync: jest.Mock };
const storage = jest.requireMock("../../../game/daily_word/storage") as {
  saveState: jest.Mock;
};

const PUZZLE = "2026-05-03:en";
/** 5 tiles × 100 ms stagger + 2 × 150 ms half-flip. */
const FLIP_MS = 800;

function typed(state: DailyWordState, word: string): DailyWordState {
  return [...word].reduce(setCurrentRowLetter, state);
}

function tiles(word: string, status: TileStatus) {
  return [...word].map((letter) => ({ letter, status }));
}

/** A board with `word` typed into the first row. */
function freshBoard(word = "crane"): DailyWordState {
  return typed(initialState(PUZZLE, 5, "en"), word);
}

/** A board with one submitted guess and `word` typed into the second row. */
function playedBoard(word = "slate"): DailyWordState {
  const first = applyServerResult(freshBoard("crane"), tiles("crane", "absent"));
  return typed(first, word);
}

function makeSync(gameId: string | null = null) {
  return {
    start: jest.fn(),
    markStarted: jest.fn(),
    complete: jest.fn().mockReturnValue(null),
    getGameId: jest.fn().mockReturnValue(gameId),
  } satisfies DailyWordSubmitSync;
}

function makeHandlers(reset: "ok" | "same" | "failed" = "ok") {
  return {
    tzOffset: 0,
    setState: jest.fn(),
    showToast: jest.fn(),
    setFlippingRowIndex: jest.fn(),
    setRevealPending: jest.fn(),
    setAnswer: jest.fn(),
    startCountdown: jest.fn(),
    playWin: jest.fn(),
    resetToToday: jest.fn().mockResolvedValue(reset),
  } satisfies DailyWordSubmitHandlers;
}

async function setup(board: DailyWordState, opts: { reset?: "ok" | "same" | "failed" } = {}) {
  const stateRef = { current: board as DailyWordState | null };
  const sync = makeSync();
  const handlers = makeHandlers(opts.reset);
  const hook = await renderHook(() => useDailyWordSubmit(stateRef, sync, handlers));
  const submit = () => act(async () => hook.result.current.submit());
  return { stateRef, sync, handlers, hook, submit };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("useDailyWordSubmit — local checks", () => {
  it("toasts a short guess without calling the server", async () => {
    const { handlers, submit } = await setup(freshBoard("cra"));
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Not enough letters");
    expect(dailyWordApi.submitGuess).not.toHaveBeenCalled();
  });

  it("drops a second Enter inside the debounce window", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tiles("crane", "absent") });
    const { submit } = await setup(freshBoard());
    await submit();
    await submit();
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);
  });
});

describe("useDailyWordSubmit — success", () => {
  it("applies a non-final guess, opens the session and flips the row", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: tiles("crane", "absent"),
      guesses_used: 1,
    });
    const { sync, handlers, hook, submit } = await setup(freshBoard());
    await submit();

    expect(dailyWordApi.submitGuess).toHaveBeenCalledWith(PUZZLE, "crane", 0);
    expect(sync.start).toHaveBeenCalledWith(
      { puzzle_id: PUZZLE },
      { puzzle_id: PUZZLE, language: "en" }
    );
    expect(sync.markStarted).toHaveBeenCalled();
    expect(sync.complete).not.toHaveBeenCalled();
    const next = handlers.setState.mock.calls[0][0] as DailyWordState;
    expect(next.current_row).toBe(1);
    expect(next.guesses_used).toBe(1);
    expect(next.is_complete).toBe(false);
    expect(handlers.setFlippingRowIndex).toHaveBeenLastCalledWith(0);
    expect(handlers.setRevealPending).not.toHaveBeenCalled();
    expect(hook.result.current.submitting).toBe(false);

    await act(async () => jest.advanceTimersByTime(FLIP_MS));
    expect(handlers.setFlippingRowIndex).toHaveBeenLastCalledWith(null);
    expect(handlers.startCountdown).not.toHaveBeenCalled();
    expect(handlers.playWin).not.toHaveBeenCalled();
  });

  it("completes a winning guess and reveals the card after the flip", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tiles("crane", "correct") });
    const { sync, handlers, submit } = await setup(freshBoard());
    await submit();

    expect(sync.complete).toHaveBeenCalledWith(
      expect.objectContaining({ finalScore: null, outcome: "win" }),
      expect.objectContaining({ won: true })
    );
    expect(handlers.setRevealPending).toHaveBeenLastCalledWith(true);
    expect((handlers.setState.mock.calls[0][0] as DailyWordState).is_complete).toBe(true);
    expect(handlers.playWin).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(FLIP_MS));
    expect(handlers.setRevealPending).toHaveBeenLastCalledWith(false);
    expect(handlers.playWin).toHaveBeenCalledTimes(1);
    expect(handlers.startCountdown).toHaveBeenCalledTimes(1);
    expect(dailyWordApi.getAnswer).not.toHaveBeenCalled();
  });
});

describe("useDailyWordSubmit — final row loss", () => {
  it("holds the card until getAnswer resolves, then releases it", async () => {
    let resolveAnswer: (v: { answer: string }) => void = () => {};
    dailyWordApi.getAnswer.mockReturnValue(
      new Promise((resolve) => {
        resolveAnswer = resolve;
      })
    );
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tiles("crane", "absent") });
    // Five wrong rows already submitted; the sixth is typed.
    let board = initialState(PUZZLE, 5, "en");
    for (const w of ["slate", "pious", "mound", "fight", "badge"]) {
      board = applyServerResult(typed(board, w), tiles(w, "absent"));
    }
    board = typed(board, "crane");
    const { handlers, submit } = await setup(board);
    await submit();

    expect(handlers.setRevealPending.mock.calls).toEqual([[true]]);
    expect(handlers.setState.mock.calls[0][0]).toMatchObject({ is_complete: true, won: false });

    // Flip over: the answer fetch is in flight, the card is still held.
    await act(async () => jest.advanceTimersByTime(FLIP_MS));
    expect(dailyWordApi.getAnswer).toHaveBeenCalledWith(PUZZLE);
    expect(handlers.setRevealPending).not.toHaveBeenCalledWith(false);
    expect(handlers.startCountdown).not.toHaveBeenCalled();

    await act(async () => resolveAnswer({ answer: "pious" }));
    expect(handlers.setAnswer).toHaveBeenCalledWith("PIOUS");
    expect(handlers.setRevealPending.mock.calls).toEqual([[true], [false]]);
    expect(handlers.startCountdown).toHaveBeenCalledTimes(1);
    expect(handlers.playWin).not.toHaveBeenCalled();
  });
});

describe("useDailyWordSubmit — leaving mid-guess", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("a 200 after unmount changes nothing", async () => {
    const d = deferred<unknown>();
    dailyWordApi.submitGuess.mockReturnValue(d.promise);
    const { sync, handlers, hook } = await setup(freshBoard());
    const pending = hook.result.current.submit();
    await hook.unmount();
    Haptics.impactAsync.mockClear();
    await act(async () => d.resolve({ tiles: tiles("crane", "correct") }));
    await pending;

    expect(handlers.setState).not.toHaveBeenCalled();
    expect(handlers.setFlippingRowIndex).not.toHaveBeenCalled();
    expect(handlers.setRevealPending).not.toHaveBeenCalled();
    expect(sync.start).not.toHaveBeenCalled();
    expect(sync.markStarted).not.toHaveBeenCalled();
    expect(sync.complete).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(FLIP_MS));
    expect(handlers.startCountdown).not.toHaveBeenCalled();
  });

  it("a 403 loss after unmount changes nothing", async () => {
    const d = deferred<unknown>();
    dailyWordApi.submitGuess.mockReturnValue(d.promise);
    const { sync, handlers, hook } = await setup(playedBoard());
    const pending = hook.result.current.submit();
    await hook.unmount();
    Haptics.impactAsync.mockClear();
    await act(async () => d.reject(new ApiError("no_guesses_remaining", 403)));
    await pending;

    expect(handlers.setState).not.toHaveBeenCalled();
    expect(handlers.setRevealPending).not.toHaveBeenCalled();
    expect(handlers.setAnswer).not.toHaveBeenCalled();
    expect(handlers.startCountdown).not.toHaveBeenCalled();
    expect(sync.complete).not.toHaveBeenCalled();
    expect(storage.saveState).not.toHaveBeenCalled();
    expect(dailyWordApi.getAnswer).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});

describe("useDailyWordSubmit — other failures", () => {
  it("a plain network error shows the couldNotSubmit toast", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new Error("Network request failed"));
    const { handlers, hook, submit } = await setup(freshBoard());
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Could not submit your guess");
    expect(handlers.setState).not.toHaveBeenCalled();
    expect(hook.result.current.submitting).toBe(false);
  });

  it("rejects a word already on the board without a request", async () => {
    const { handlers, submit } = await setup(playedBoard("crane"));
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Already guessed");
    expect(Haptics.impactAsync).toHaveBeenCalledWith("Heavy");
    expect(dailyWordApi.submitGuess).not.toHaveBeenCalled();
    expect(handlers.setState).not.toHaveBeenCalled();
  });

  it("resets submitting when the success handler throws", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tiles("crane", "absent") });
    const { handlers, hook, submit } = await setup(freshBoard());
    handlers.setState.mockImplementation(() => {
      throw new Error("render failed");
    });
    await submit();
    // The throw is routed through recovery as a failed submit.
    expect(handlers.showToast).toHaveBeenCalledWith("Could not submit your guess");
    expect(hook.result.current.submitting).toBe(false);
  });
});

describe("useDailyWordSubmit — 422 recovery", () => {
  it.each([
    ["not_a_word", "Not in word list"],
    ["wrong_guess_length", "Guess length doesn't match today's word"],
    ["something_else", "Could not submit your guess"],
  ])("%s shows a toast and leaves the board alone", async (code, message) => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError(code, 422));
    const { sync, handlers, submit } = await setup(freshBoard());
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith(message);
    expect(handlers.setState).not.toHaveBeenCalled();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it("stale_puzzle_id reloads today's puzzle", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("stale_puzzle_id", 422));
    const { handlers, submit } = await setup(freshBoard(), { reset: "ok" });
    await submit();
    expect(handlers.resetToToday).toHaveBeenCalledTimes(1);
    expect(handlers.showToast).toHaveBeenCalledWith("New puzzle available — loading today's word");
  });

  it("stale_puzzle_id says so when the reload fails", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("stale_puzzle_id", 422));
    const { handlers, submit } = await setup(freshBoard(), { reset: "failed" });
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Could not load today's puzzle");
  });
});

describe("useDailyWordSubmit — 429 recovery", () => {
  it("shows the rate-limit toast", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("rate_limited", 429));
    const { handlers, hook, submit } = await setup(freshBoard());
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Too many guesses — try again later");
    expect(handlers.setState).not.toHaveBeenCalled();
    expect(hook.result.current.submitting).toBe(false);
  });
});

describe("useDailyWordSubmit — 403 recovery", () => {
  it("already_solved closes a played board out as a win", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(
      new ApiError("already_solved", 403, { guesses_used: 3 })
    );
    const { sync, handlers, submit } = await setup(playedBoard());
    await submit();

    const finished = handlers.setState.mock.calls[0][0] as DailyWordState;
    expect(finished).toMatchObject({ is_complete: true, won: true, guesses_used: 3 });
    expect(storage.saveState).toHaveBeenCalledWith(finished);
    expect(sync.start).toHaveBeenCalled();
    expect(sync.complete).toHaveBeenCalledWith(
      expect.objectContaining({ finalScore: null, outcome: "win" }),
      expect.objectContaining({ won: true })
    );
    // A win shows its card at once: nothing holds it back.
    expect(handlers.setRevealPending).not.toHaveBeenCalledWith(true);
    expect(handlers.playWin).toHaveBeenCalledTimes(1);
    expect(handlers.startCountdown).toHaveBeenCalledTimes(1);
    expect(dailyWordApi.getAnswer).not.toHaveBeenCalled();
  });

  it("no_guesses_remaining closes the board out as a loss and reveals the answer", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("no_guesses_remaining", 403));
    dailyWordApi.getAnswer.mockResolvedValue({ answer: "pious" });
    const { sync, handlers, submit } = await setup(playedBoard());
    await submit();

    expect(handlers.setState.mock.calls[0][0]).toMatchObject({ is_complete: true, won: false });
    expect(sync.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "loss" }),
      expect.objectContaining({ won: false })
    );
    expect(dailyWordApi.getAnswer).toHaveBeenCalledWith(PUZZLE);
    expect(handlers.setAnswer).toHaveBeenCalledWith("PIOUS");
    // Held back while the answer loaded, then released.
    expect(handlers.setRevealPending.mock.calls).toEqual([[true], [false]]);
    expect(handlers.playWin).not.toHaveBeenCalled();
    expect(handlers.startCountdown).toHaveBeenCalledTimes(1);
  });

  it("still reveals the loss card when the answer fetch fails", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("no_guesses_remaining", 403));
    dailyWordApi.getAnswer.mockRejectedValue(new Error("offline"));
    const { handlers, submit } = await setup(playedBoard());
    await submit();
    expect(handlers.setAnswer).not.toHaveBeenCalled();
    expect(handlers.setRevealPending).toHaveBeenLastCalledWith(false);
    expect(handlers.startCountdown).toHaveBeenCalledTimes(1);
  });

  it("does not report a session or play the fanfare for a wiped board", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("already_solved", 403));
    const { sync, handlers, submit } = await setup(freshBoard());
    await submit();
    expect(handlers.setState.mock.calls[0][0]).toMatchObject({ is_complete: true, won: true });
    expect(sync.start).not.toHaveBeenCalled();
    expect(sync.complete).not.toHaveBeenCalled();
    expect(handlers.playWin).not.toHaveBeenCalled();
  });

  it("treats any other 403 as a failed submit", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("forbidden", 403));
    const { handlers, submit } = await setup(playedBoard());
    await submit();
    expect(handlers.showToast).toHaveBeenCalledWith("Could not submit your guess");
    expect(handlers.setState).not.toHaveBeenCalled();
  });
});
