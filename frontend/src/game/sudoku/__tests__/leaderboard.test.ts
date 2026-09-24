import { sudokuLeaderboard } from "../leaderboard";
import { registerSudokuScoreHandler } from "../scoreSync";
import { sudokuApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import { flushQueuedGames } from "../../_shared/flushQueuedGames";
import { ApiError } from "../../_shared/httpClient";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  sudokuApi: { submitPlayerName: jest.fn(), getLeaderboard: jest.fn() },
}));
jest.mock("../../_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

const submitPlayerName = sudokuApi.submitPlayerName as jest.Mock;
const flushGames = flushQueuedGames as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitPlayerName.mockResolvedValue({ player_name: "Riley", score: 100, rank: 2 });
});

describe("sudokuLeaderboard.submit (#2530 review)", () => {
  it("uploads the queued game before attaching the name", async () => {
    const order: string[] = [];
    flushGames.mockImplementationOnce(async () => {
      order.push("flushGames");
    });
    submitPlayerName.mockImplementationOnce(async () => {
      order.push("submitName");
      return { player_name: "Riley", score: 100, rank: 2 };
    });

    await expect(sudokuLeaderboard.submit("Riley", { gameId: "g-1" })).resolves.toBe(2);
    expect(order).toEqual(["flushGames", "submitName"]);
    expect(submitPlayerName).toHaveBeenCalledWith("g-1", "Riley");
  });

  it("still retries if the completion hasn't landed after the flush", async () => {
    jest.useFakeTimers();
    try {
      submitPlayerName
        .mockRejectedValueOnce(new ApiError("Game has no final score.", 400))
        .mockResolvedValueOnce({ player_name: "Riley", score: 100, rank: 5 });
      const result = sudokuLeaderboard.submit("Riley", { gameId: "g-1" });
      await jest.runAllTimersAsync();
      await expect(result).resolves.toBe(5);
      expect(submitPlayerName).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues the payload shape the Sudoku queue handler reads", () => {
    expect(sudokuLeaderboard.queuePayload("Riley", { gameId: "g-1" })).toEqual({
      game_id: "g-1",
      player_name: "Riley",
    });
  });
});

describe("Sudoku queue handler", () => {
  it("uploads queued games before attaching the name", async () => {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerSudokuScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "sudoku")?.[1];
    expect(handler).toBeDefined();

    const order: string[] = [];
    flushGames.mockImplementationOnce(async () => {
      order.push("flushGames");
    });
    submitPlayerName.mockImplementationOnce(async () => {
      order.push("submitName");
    });

    await handler!({
      id: "q-1",
      game_type: "sudoku",
      payload: { game_id: "g-1", player_name: "Riley" },
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission);

    expect(order).toEqual(["flushGames", "submitName"]);
    register.mockRestore();
  });
});
