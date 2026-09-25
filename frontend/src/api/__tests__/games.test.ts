const mockRequest = jest.fn().mockResolvedValue({
  rank: 1,
  is_best: true,
  ranked: true,
  reason: null,
});
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient:
    () =>
    (...args: unknown[]) =>
      mockRequest(...args),
}));

import { gamesApi } from "../games";

describe("gamesApi (#2677)", () => {
  beforeEach(() => mockRequest.mockClear());

  it("GETs the game's rank", async () => {
    await expect(gamesApi.getRank("abc-123")).resolves.toEqual({
      rank: 1,
      is_best: true,
      ranked: true,
      reason: null,
    });
    expect(mockRequest).toHaveBeenCalledWith("/games/abc-123/rank");
  });
});
