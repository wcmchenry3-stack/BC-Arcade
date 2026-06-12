import { freecellApi } from "../api";

describe("freecellApi — endpoints", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  function respondWith<T>(data: T, ok = true) {
    mockFetch.mockResolvedValueOnce({
      ok,
      statusText: "Bad Request",
      json: () => Promise.resolve(data),
    } as Response);
  }

  it("submitScore POSTs { player_id, move_count } to /freecell/score", async () => {
    respondWith({ player_id: "Alice", move_count: 52, rank: 1 });
    await freecellApi.submitScore("Alice", 52);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/freecell/score"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ player_id: "Alice", move_count: 52 }),
      })
    );
  });

  it("submitScore returns the ScoreEntry from the response", async () => {
    respondWith({ player_id: "Alice", move_count: 52, rank: 4 });
    const entry = await freecellApi.submitScore("Alice", 52);
    expect(entry).toEqual({ player_id: "Alice", move_count: 52, rank: 4 });
  });

  it("getLeaderboard GETs /freecell/leaderboard", async () => {
    respondWith({ scores: [] });
    await freecellApi.getLeaderboard();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/freecell/leaderboard"),
      expect.any(Object)
    );
  });
});
