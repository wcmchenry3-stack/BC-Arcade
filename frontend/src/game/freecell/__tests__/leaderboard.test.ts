import { freecellLeaderboard } from "../leaderboard";
import { registerFreeCellScoreHandler } from "../scoreSync";
import { freecellApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  freecellApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

const submitScore = freecellApi.submitScore as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitScore.mockResolvedValue({ player_id: "Riley", move_count: 88, rank: 3 });
});

describe("freecellLeaderboard (#2508)", () => {
  it("posts the name and move count and resolves to the rank", async () => {
    await expect(freecellLeaderboard.submit("Riley", { moves: 88 })).resolves.toBe(3);
    expect(submitScore).toHaveBeenCalledWith("Riley", 88);
  });

  it("queues the payload shape the FreeCell queue handler reads", () => {
    expect(freecellLeaderboard.queuePayload("Riley", { moves: 88 })).toEqual({
      player_id: "Riley",
      move_count: 88,
    });
  });
});

describe("FreeCell queue handler", () => {
  function registeredHandler() {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerFreeCellScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "freecell")?.[1];
    register.mockRestore();
    expect(handler).toBeDefined();
    return handler!;
  }

  function item(payload: Record<string, unknown>): PendingSubmission {
    return {
      id: "q-1",
      game_type: "freecell",
      payload,
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission;
  }

  it("submits a queued score", async () => {
    await registeredHandler()(item(freecellLeaderboard.queuePayload("Riley", { moves: 88 })));
    expect(submitScore).toHaveBeenCalledWith("Riley", 88);
  });

  it("drops a malformed payload without submitting", async () => {
    await expect(registeredHandler()(item({ bad: "payload" }))).resolves.toBeUndefined();
    expect(submitScore).not.toHaveBeenCalled();
  });

  it("throws on a failed submit so the item stays queued", async () => {
    submitScore.mockRejectedValueOnce(new Error("network"));
    await expect(registeredHandler()(item({ player_id: "Riley", move_count: 88 }))).rejects.toThrow(
      "network"
    );
  });
});
