const mockRequest = jest.fn();
jest.mock("../../_shared/httpClient", () => ({
  createGameClient: () => (path: string) => mockRequest(path),
}));

import { dailyChallengeApi } from "../api";

const STATUS_PATH = "/daily-challenge/status";
const TODAY_PATH = "/daily-challenge/today";

// The free slate `/today` describes.
const today = {
  challenge_id: "2026-09-27",
  template_id: "t-free",
  goals: [
    { id: "daily_word:completed", game_type: "daily_word", kind: "completed", target: null },
    {
      id: "solitaire:moves_at_least:10",
      game_type: "solitaire",
      kind: "moves_at_least",
      target: 10,
    },
    {
      id: "twenty48:final_score_at_least:2500",
      game_type: "twenty48",
      kind: "final_score_at_least",
      target: 2500,
    },
  ],
  resets_at: "2026-09-28T00:00:00Z",
};

// A different slate `/status` may describe for a premium session.
const status = {
  challenge_id: "2026-09-27",
  template_id: "t-premium",
  goals: [
    {
      id: "daily_word:won",
      game_type: "daily_word",
      kind: "won",
      target: null,
      completed: true,
      best_score: null,
    },
    {
      id: "mahjong:won_duration_ms_at_most:480000",
      game_type: "mahjong",
      kind: "won_duration_ms_at_most",
      target: 480000,
      completed: false,
      best_score: null,
    },
    {
      id: "twenty48:final_score_at_least:500",
      game_type: "twenty48",
      kind: "final_score_at_least",
      target: 500,
      completed: false,
      best_score: 320,
    },
  ],
  resets_at: "2026-09-28T00:00:00Z",
  completed_goals: 1,
  total_goals: 3,
  completed: false,
};

function respond(handlers: { today?: unknown; status?: unknown }) {
  mockRequest.mockImplementation(async (path: string) => {
    const body = path.startsWith(STATUS_PATH) ? handlers.status : handlers.today;
    if (body instanceof Error) throw body;
    return body;
  });
}

beforeEach(() => {
  mockRequest.mockReset();
});

describe("dailyChallengeApi.getDailyChallenge — /status is the source of truth", () => {
  it("passes the timezone offset to /status", async () => {
    respond({ status });
    await dailyChallengeApi.getDailyChallenge(-300);
    expect(mockRequest).toHaveBeenCalledWith(`${STATUS_PATH}?tz_offset_minutes=-300`);
  });

  it("builds goals and completion from /status, with the per-game kind and target", async () => {
    respond({ status });
    expect(await dailyChallengeApi.getDailyChallenge(0)).toEqual({
      challengeId: "2026-09-27",
      goals: [
        {
          id: "daily_word:won",
          gameSlug: "daily_word",
          kind: "won",
          target: null,
          completed: true,
        },
        {
          id: "mahjong:won_duration_ms_at_most:480000",
          gameSlug: "mahjong",
          kind: "won_duration_ms_at_most",
          target: 480000,
          completed: false,
        },
        {
          id: "twenty48:final_score_at_least:500",
          gameSlug: "twenty48",
          kind: "final_score_at_least",
          target: 500,
          completed: false,
        },
      ],
    });
  });

  it("does not use /today's goals when /status answers — a premium slate differs from the free one", async () => {
    respond({ today, status });
    const result = await dailyChallengeApi.getDailyChallenge(0);
    expect(result.goals.map((goal) => goal.id)).toEqual(status.goals.map((goal) => goal.id));
    expect(mockRequest).not.toHaveBeenCalledWith(expect.stringContaining(TODAY_PATH));
  });

  it("reports the challenge day /status reports", async () => {
    respond({ status: { ...status, challenge_id: "2026-09-26" } });
    expect((await dailyChallengeApi.getDailyChallenge(0)).challengeId).toBe("2026-09-26");
  });

  it("normalises a missing target to null", async () => {
    const noTarget = { id: "daily_word:completed", game_type: "daily_word", kind: "completed" };
    respond({ status: { ...status, goals: [{ ...noTarget, completed: false }] } });
    const result = await dailyChallengeApi.getDailyChallenge(0);
    expect(result.goals[0]?.target).toBeNull();
  });
});

describe("dailyChallengeApi.getDailyChallenge — /today fallback", () => {
  it("falls back to the free slate, all goals not done, when /status fails", async () => {
    respond({ today, status: new Error("HTTP 500") });
    const result = await dailyChallengeApi.getDailyChallenge(120);
    expect(mockRequest).toHaveBeenCalledWith(`${TODAY_PATH}?tz_offset_minutes=120`);
    expect(result.challengeId).toBe("2026-09-27");
    expect(result.goals.map((goal) => goal.id)).toEqual(today.goals.map((goal) => goal.id));
    expect(result.goals.every((goal) => !goal.completed)).toBe(true);
    expect(result.goals[1]).toMatchObject({
      gameSlug: "solitaire",
      kind: "moves_at_least",
      target: 10,
    });
  });

  it("falls back when /status is not the shape this build expects (older backend)", async () => {
    respond({ today, status: { challenge_id: "2026-09-27", completed_goal_ids: [] } });
    const result = await dailyChallengeApi.getDailyChallenge(0);
    expect(result.goals).toHaveLength(today.goals.length);
  });

  it("rejects, with the fallback's error, when both requests fail", async () => {
    respond({ today: new Error("fallback failed"), status: new Error("HTTP 500") });
    await expect(dailyChallengeApi.getDailyChallenge(0)).rejects.toThrow("fallback failed");
  });
});
