/**
 * useDailyWordSubmit with replay recording (#3287): the hook records each
 * attempt, and a recorder that throws never stops the guess being played.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useDailyWordSubmit } from "../useDailyWordSubmit";
import { initialState, setCurrentRowLetter } from "../../../game/daily_word/engine";
import { createGuessReplay, type GuessReplay } from "../../../game/daily_word/replay";
import { ApiError } from "../../../game/_shared/httpClient";

jest.mock("../../../game/daily_word/api", () => ({
  dailyWordApi: { getToday: jest.fn(), submitGuess: jest.fn(), getAnswer: jest.fn() },
}));
jest.mock("../../../game/daily_word/storage", () => ({
  saveState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
}));

const { dailyWordApi } = jest.requireMock("../../../game/daily_word/api") as {
  dailyWordApi: { submitGuess: jest.Mock };
};

const PUZZLE = "2026-05-03:en";
const board = (word: string) =>
  [...word].reduce(setCurrentRowLetter, initialState(PUZZLE, 5, "en"));
const tiles = (word: string) => [...word].map((letter) => ({ letter, status: "absent" as const }));

async function setup(word: string, replay: GuessReplay) {
  const stateRef = { current: board(word) as ReturnType<typeof board> | null };
  const sync = {
    start: jest.fn(),
    markStarted: jest.fn(),
    complete: jest.fn().mockReturnValue(null),
    getGameId: jest.fn().mockReturnValue(null),
  };
  const handlers = {
    tzOffset: 0,
    setState: jest.fn(),
    showToast: jest.fn(),
    setFlippingRowIndex: jest.fn(),
    setRevealPending: jest.fn(),
    setAnswer: jest.fn(),
    startCountdown: jest.fn(),
    playWin: jest.fn(),
    resetToToday: jest.fn().mockResolvedValue("ok"),
    replay,
  };
  const hook = await renderHook(() => useDailyWordSubmit(stateRef, sync, handlers));
  return { sync, handlers, submit: () => act(async () => hook.result.current.submit()) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("useDailyWordSubmit — replay", () => {
  it("records the game as it finishes, with the session open, and counts a refusal", async () => {
    const replay = { refused: jest.fn(), finish: jest.fn() };
    // a win on the first guess finishes the game
    dailyWordApi.submitGuess.mockResolvedValueOnce({
      tiles: [..."crane"].map((letter) => ({ letter, status: "correct" as const })),
    });
    const win = await setup("crane", replay);
    await win.submit();
    expect(replay.finish).toHaveBeenCalledTimes(1);
    const finished = replay.finish.mock.calls[0]![0];
    expect([finished.won, finished.is_complete, finished.current_row]).toEqual([true, true, 1]);
    // the session was opened before the event was recorded, and recorded before it completed
    expect(win.sync.start.mock.invocationCallOrder[0]).toBeLessThan(
      replay.finish.mock.invocationCallOrder[0]!
    );
    expect(replay.finish.mock.invocationCallOrder[0]).toBeLessThan(
      win.sync.complete.mock.invocationCallOrder[0]!
    );

    dailyWordApi.submitGuess.mockRejectedValueOnce(new ApiError("not_a_word", 422));
    const bad = await setup("zzzzz", replay);
    await bad.submit();
    expect(replay.refused).toHaveBeenCalledWith(PUZZLE);
    expect(replay.finish).toHaveBeenCalledTimes(1);
  });

  it("a scored guess that does not end the game records nothing yet", async () => {
    const replay = { refused: jest.fn(), finish: jest.fn() };
    dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tiles("crane") });
    const { submit } = await setup("crane", replay);
    await submit();
    expect(replay.finish).not.toHaveBeenCalled();
    expect(replay.refused).not.toHaveBeenCalled();
  });

  it("a recorder that throws does not stop the guess: the board still advances", async () => {
    const boom = () => {
      throw new Error("recorder broke");
    };
    const replay = createGuessReplay({ beginUnit: boom, record: boom, closeUnit: boom });
    dailyWordApi.submitGuess.mockResolvedValueOnce({
      tiles: [..."crane"].map((letter) => ({ letter, status: "correct" as const })),
    });
    const { sync, handlers, submit } = await setup("crane", replay);
    await submit();
    expect(handlers.setState).toHaveBeenCalledTimes(1);
    expect(handlers.setFlippingRowIndex).toHaveBeenCalledWith(0);
    expect(sync.complete).toHaveBeenCalled();
    expect(handlers.showToast).not.toHaveBeenCalled();
  });
});
