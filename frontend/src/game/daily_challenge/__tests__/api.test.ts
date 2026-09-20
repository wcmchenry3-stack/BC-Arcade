const mockRequest = jest.fn();
jest.mock("../../_shared/httpClient", () => ({
  createGameClient: () => (path: string) => mockRequest(path),
}));

import { dailyChallengeApi } from "../api";

const today = {
  challenge_id: "2026-09-27",
  goals: [
    { id: "g1", game_type: "solitaire", kind: "complete" },
    { id: "g2", game_type: "twenty48", kind: "score_at_least", target: 2000 },
  ],
};

function respond(todayBody: unknown, statusBody: unknown) {
  mockRequest.mockImplementation(async (path: string) =>
    path.startsWith("/daily-challenge/today") ? todayBody : statusBody
  );
}

beforeEach(() => {
  mockRequest.mockReset();
});

describe("dailyChallengeApi.getDailyChallenge", () => {
  it("passes the timezone offset to both endpoints", async () => {
    respond(today, { challenge_id: "2026-09-27", completed_goal_ids: [] });
    await dailyChallengeApi.getDailyChallenge(-300);
    expect(mockRequest).toHaveBeenCalledWith("/daily-challenge/today?tz_offset_minutes=-300");
    expect(mockRequest).toHaveBeenCalledWith("/daily-challenge/status?tz_offset_minutes=-300");
  });

  it("merges the definition with the caller's progress into the UI model", async () => {
    respond(today, { challenge_id: "2026-09-27", completed_goal_ids: ["g2"] });
    expect(await dailyChallengeApi.getDailyChallenge(0)).toEqual({
      challengeId: "2026-09-27",
      goals: [
        { id: "g1", gameSlug: "solitaire", kind: "complete", target: null, completed: false },
        {
          id: "g2",
          gameSlug: "twenty48",
          kind: "score_at_least",
          target: 2000,
          completed: true,
        },
      ],
    });
  });

  it("ignores progress that belongs to a different day's challenge", async () => {
    // The day rolled over between the two requests.
    respond(today, { challenge_id: "2026-09-26", completed_goal_ids: ["g1", "g2"] });
    const result = await dailyChallengeApi.getDailyChallenge(0);
    expect(result.goals.every((goal) => !goal.completed)).toBe(true);
  });

  it("rejects when either request fails", async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path.startsWith("/daily-challenge/status")) throw new Error("HTTP 500");
      return today;
    });
    await expect(dailyChallengeApi.getDailyChallenge(0)).rejects.toThrow("HTTP 500");
  });
});
