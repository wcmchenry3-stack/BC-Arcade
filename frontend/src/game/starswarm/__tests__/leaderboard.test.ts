import AsyncStorage from "@react-native-async-storage/async-storage";
import { starSwarmLeaderboard } from "../leaderboard";
import { registerStarSwarmScoreHandler } from "../scoreSync";
import { loadBestScore, saveBestScore } from "../bestScore";
import { starSwarmApi, type LeaderboardEntry } from "../api";
import { scoreQueue } from "../../_shared/scoreQueue";
import type { PendingSubmission } from "../../_shared/types";

jest.mock("../api", () => ({
  starSwarmApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

const submitScore = starSwarmApi.submitScore as jest.Mock;

function entry(over: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    player_id: "Someone",
    score: 100,
    wave_reached: 3,
    difficulty_tier: "Ensign",
    timestamp: "",
    rank: 1,
    ...over,
  };
}

const RUN = { score: 4200, wave: 7, difficulty: "Commander" };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("starSwarmLeaderboard", () => {
  it("submits under the display name and resolves to the server's rank for this run", async () => {
    submitScore.mockResolvedValue({ scores: [], rank: 3 });
    await expect(starSwarmLeaderboard.submit("Riley", RUN)).resolves.toBe(3);
    expect(submitScore).toHaveBeenCalledWith("Riley", 4200, 7, "Commander");
  });

  // #2580 review: an identical earlier run sits in `scores` too — only the
  // server's rank says where this run landed.
  it("ignores a matching row in the list and trusts the server's rank", async () => {
    submitScore.mockResolvedValue({
      scores: [
        entry({
          player_id: "Riley",
          score: 4200,
          wave_reached: 7,
          difficulty_tier: "Commander",
          rank: 10,
        }),
      ],
      rank: null,
    });
    await expect(starSwarmLeaderboard.submit("Riley", RUN)).resolves.toBeNull();
  });

  it("queues the payload shape the Star Swarm queue handler reads", () => {
    expect(starSwarmLeaderboard.queuePayload("Riley", RUN)).toEqual({
      player_id: "Riley",
      score: 4200,
      wave_reached: 7,
      difficulty_tier: "Commander",
    });
  });
});

describe("Star Swarm queue handler", () => {
  function registeredHandler() {
    const register = jest.spyOn(scoreQueue, "registerHandler");
    registerStarSwarmScoreHandler();
    const handler = register.mock.calls.find(([type]) => type === "starswarm")?.[1];
    register.mockRestore();
    expect(handler).toBeDefined();
    return handler!;
  }

  function item(payload: Record<string, unknown>): PendingSubmission {
    return {
      id: "q-1",
      game_type: "starswarm",
      payload,
      played_at: new Date().toISOString(),
      attempts: 0,
    } as PendingSubmission;
  }

  it("submits a queued run", async () => {
    submitScore.mockResolvedValue({ scores: [] });
    await registeredHandler()(item(starSwarmLeaderboard.queuePayload("Riley", RUN)));
    expect(submitScore).toHaveBeenCalledWith("Riley", 4200, 7, "Commander");
  });

  it("drops a malformed payload without submitting", async () => {
    await registeredHandler()(item({ player_id: "Riley" }));
    expect(submitScore).not.toHaveBeenCalled();
  });

  it("throws on a failed submit so the item stays queued", async () => {
    submitScore.mockRejectedValueOnce(new Error("network"));
    await expect(
      registeredHandler()(item(starSwarmLeaderboard.queuePayload("Riley", RUN)))
    ).rejects.toThrow("network");
  });
});

describe("best score storage", () => {
  it("is 0 with nothing saved, and keeps a saved best", async () => {
    await expect(loadBestScore()).resolves.toBe(0);
    await saveBestScore(4200);
    await expect(loadBestScore()).resolves.toBe(4200);
  });

  it("treats a corrupt value as no best", async () => {
    await AsyncStorage.setItem("starswarm.bestScore", "not a number");
    await expect(loadBestScore()).resolves.toBe(0);
  });
});
