import { heartsLeaderboard, heartsLeaderboardScore } from "../leaderboard";
import { registerHeartsScoreHandler } from "../scoreSync";
import { heartsApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  heartsApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

const submitScore = heartsApi.submitScore as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitScore.mockResolvedValue({ player_name: "Riley", score: 640, rank: 3 });
});

describe("heartsLeaderboard (#2506)", () => {
  it("posts the name and score and resolves to the rank", async () => {
    await expect(heartsLeaderboard.submit("Riley", { score: 640 })).resolves.toBe(3);
    expect(submitScore).toHaveBeenCalledWith("Riley", 640);
  });

  it("queues the payload shape the Hearts queue handler reads", () => {
    expect(heartsLeaderboard.queuePayload("Riley", { score: 640 })).toEqual({
      player_name: "Riley",
      score: 640,
    });
  });
});

describe("Hearts queue handler", () => {
  function registeredHandler() {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerHeartsScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "hearts")?.[1];
    register.mockRestore();
    expect(handler).toBeDefined();
    return handler!;
  }

  function item(payload: Record<string, unknown>): PendingSubmission {
    return {
      id: "q-1",
      game_type: "hearts",
      payload,
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission;
  }

  it("submits a queued score", async () => {
    await registeredHandler()(item(heartsLeaderboard.queuePayload("Riley", { score: 640 })));
    expect(submitScore).toHaveBeenCalledWith("Riley", 640);
  });

  it("drops a malformed payload without submitting", async () => {
    await expect(registeredHandler()(item({ bad: "payload" }))).resolves.toBeUndefined();
    expect(submitScore).not.toHaveBeenCalled();
  });

  it("throws on a failed submit so the item stays queued", async () => {
    submitScore.mockRejectedValueOnce(new Error("network"));
    await expect(registeredHandler()(item({ player_name: "Riley", score: 640 }))).rejects.toThrow(
      "network"
    );
  });
});

describe("heartsLeaderboardScore", () => {
  it("scores 100 minus the player's points, never below zero", () => {
    expect(heartsLeaderboardScore(46)).toBe(54);
    expect(heartsLeaderboardScore(0)).toBe(100);
    expect(heartsLeaderboardScore(118)).toBe(0);
  });
});
