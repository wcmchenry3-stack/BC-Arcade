import { solitaireLeaderboard } from "../leaderboard";
import { registerSolitaireScoreHandler } from "../scoreSync";
import { solitaireApi } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  solitaireApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

const submitScore = solitaireApi.submitScore as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  submitScore.mockResolvedValue({ player_name: "Riley", score: 640, rank: 3 });
});

describe("solitaireLeaderboard (#2509)", () => {
  it("posts the name and score and resolves to the rank", async () => {
    await expect(solitaireLeaderboard.submit("Riley", { score: 640 })).resolves.toBe(3);
    expect(submitScore).toHaveBeenCalledWith("Riley", 640);
  });

  it("queues the payload shape the Solitaire queue handler reads", () => {
    expect(solitaireLeaderboard.queuePayload("Riley", { score: 640 })).toEqual({
      player_name: "Riley",
      score: 640,
    });
  });
});

describe("Solitaire queue handler", () => {
  function registeredHandler() {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerSolitaireScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "solitaire")?.[1];
    register.mockRestore();
    expect(handler).toBeDefined();
    return handler!;
  }

  function item(payload: Record<string, unknown>): PendingSubmission {
    return {
      id: "q-1",
      game_type: "solitaire",
      payload,
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission;
  }

  it("submits a queued score", async () => {
    await registeredHandler()(item(solitaireLeaderboard.queuePayload("Riley", { score: 640 })));
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
