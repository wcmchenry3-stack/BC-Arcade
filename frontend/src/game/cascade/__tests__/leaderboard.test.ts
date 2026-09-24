import { cascadeLeaderboard } from "../leaderboard";
import { registerCascadeScoreHandler } from "../scoreSync";
import { cascadeApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import { flushQueuedGames } from "../../_shared/flushQueuedGames";
import { ApiError } from "../../_shared/httpClient";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  cascadeApi: { submitPlayerName: jest.fn(), getLeaderboard: jest.fn() },
}));
jest.mock("../../_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

const submitPlayerName = cascadeApi.submitPlayerName as jest.Mock;
const flushGames = flushQueuedGames as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitPlayerName.mockResolvedValue({ player_name: "Riley", score: 100, rank: 2 });
});

describe("cascadeLeaderboard.submit (#2515)", () => {
  it("uploads the queued game before attaching the name", async () => {
    const order: string[] = [];
    flushGames.mockImplementationOnce(async () => {
      order.push("flushGames");
    });
    submitPlayerName.mockImplementationOnce(async () => {
      order.push("submitName");
      return { player_name: "Riley", score: 100, rank: 2 };
    });

    await expect(cascadeLeaderboard.submit("Riley", { gameId: "g-1" })).resolves.toBe(2);
    expect(order).toEqual(["flushGames", "submitName"]);
    expect(submitPlayerName).toHaveBeenCalledWith("g-1", "Riley");
  });

  it("still retries if the completion hasn't landed after the flush", async () => {
    jest.useFakeTimers();
    try {
      submitPlayerName
        .mockRejectedValueOnce(new ApiError("Game has no final score.", 400))
        .mockResolvedValueOnce({ player_name: "Riley", score: 100, rank: 5 });
      const result = cascadeLeaderboard.submit("Riley", { gameId: "g-1" });
      await jest.runAllTimersAsync();
      await expect(result).resolves.toBe(5);
      expect(submitPlayerName).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues the payload shape the Cascade queue handler reads", () => {
    expect(cascadeLeaderboard.queuePayload("Riley", { gameId: "g-1" })).toEqual({
      game_id: "g-1",
      player_name: "Riley",
    });
  });
});

describe("Cascade queue handler", () => {
  it("uploads queued games before attaching the name", async () => {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerCascadeScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "cascade")?.[1];
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
      game_type: "cascade",
      payload: { game_id: "g-1", player_name: "Riley" },
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission);

    expect(order).toEqual(["flushGames", "submitName"]);
    register.mockRestore();
  });
});
