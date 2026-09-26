const mockRequest = jest.fn().mockResolvedValue({});
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient:
    () =>
    (...args: unknown[]) =>
      mockRequest(...args),
}));

import { statsApi } from "../stats";

describe("statsApi.getMyStats", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockRequest.mockClear();
  });

  it("sends the device's UTC offset in minutes east of UTC, so the streak counts local days", async () => {
    // JS reports minutes WEST of UTC: UTC-5 -> 300, UTC+5:30 -> -330.
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(300);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenCalledWith("/stats/me?tz_offset_minutes=-300");

    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenLastCalledWith("/stats/me?tz_offset_minutes=330");
  });

  it("sends 0 (not -0) for a UTC device", async () => {
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenCalledWith("/stats/me?tz_offset_minutes=0");
  });
});

describe("statsApi.getGameRank (#2677)", () => {
  afterEach(() => mockRequest.mockClear());

  it("GETs the game's rank", async () => {
    const body = { rank: 1, is_best: true, ranked: true, reason: null };
    mockRequest.mockResolvedValueOnce(body);
    await expect(statsApi.getGameRank("abc-123")).resolves.toEqual(body);
    expect(mockRequest).toHaveBeenCalledWith("/games/abc-123/rank");
  });
});

describe("statsApi.getLeaderboard (#2625)", () => {
  afterEach(() => mockRequest.mockClear());

  it("GETs a board without partitions", async () => {
    const body = { game_type: "sort", partition: {}, label_key: "level", entries: [] };
    mockRequest.mockResolvedValueOnce(body);
    await expect(statsApi.getLeaderboard("sort")).resolves.toEqual(body);
    expect(mockRequest).toHaveBeenCalledWith("/games/leaderboard/sort");
  });

  it("sends the partition as query params", async () => {
    mockRequest.mockResolvedValueOnce({});
    await statsApi.getLeaderboard("sudoku", { difficulty: "hard", variant: "mini" });
    expect(mockRequest).toHaveBeenCalledWith(
      "/games/leaderboard/sudoku?difficulty=hard&variant=mini"
    );
  });

  it("sends the top N as `limit` after the partition (#2633)", async () => {
    mockRequest.mockResolvedValueOnce({});
    await statsApi.getLeaderboard("sudoku", { difficulty: "easy" }, { limit: 50 });
    expect(mockRequest).toHaveBeenCalledWith("/games/leaderboard/sudoku?difficulty=easy&limit=50");
    await statsApi.getLeaderboard("freecell", {}, { limit: 50 });
    expect(mockRequest).toHaveBeenLastCalledWith("/games/leaderboard/freecell?limit=50");
  });
});
