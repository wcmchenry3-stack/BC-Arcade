import { sortLeaderboard } from "../leaderboard";
import { registerSortScoreHandler } from "../scoreSync";
import { sortApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  sortApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

const submitScore = sortApi.submitScore as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitScore.mockResolvedValue({ player_name: "Riley", level_reached: 7, rank: 3 });
});

describe("sortLeaderboard (#2512)", () => {
  it("posts the name and level reached and resolves to the rank", async () => {
    await expect(sortLeaderboard.submit("Riley", { level: 7 })).resolves.toBe(3);
    expect(submitScore).toHaveBeenCalledWith("Riley", 7);
  });

  it("queues the payload shape the Sort queue handler reads", () => {
    expect(sortLeaderboard.queuePayload("Riley", { level: 7 })).toEqual({
      player_name: "Riley",
      level_reached: 7,
    });
  });
});

describe("Sort queue handler", () => {
  function registeredHandler() {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerSortScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "sort")?.[1];
    register.mockRestore();
    expect(handler).toBeDefined();
    return handler!;
  }

  function item(payload: Record<string, unknown>): PendingSubmission {
    return {
      id: "q-1",
      game_type: "sort",
      payload,
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission;
  }

  it("submits a queued score", async () => {
    await registeredHandler()(item(sortLeaderboard.queuePayload("Riley", { level: 7 })));
    expect(submitScore).toHaveBeenCalledWith("Riley", 7);
  });

  it("drops a malformed payload without submitting", async () => {
    await expect(registeredHandler()(item({ bad: "payload" }))).resolves.toBeUndefined();
    expect(submitScore).not.toHaveBeenCalled();
  });

  it("throws on a failed submit so the item stays queued", async () => {
    submitScore.mockRejectedValueOnce(new Error("network"));
    await expect(
      registeredHandler()(item({ player_name: "Riley", level_reached: 7 }))
    ).rejects.toThrow("network");
  });
});
