const mockRequest = jest.fn().mockResolvedValue({ display_name: null });
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient:
    () =>
    (...args: unknown[]) =>
      mockRequest(...args),
}));

import { playersApi } from "../players";

describe("playersApi (#2624, #2778)", () => {
  beforeEach(() => mockRequest.mockClear());

  it("GETs the caller's name", async () => {
    await playersApi.getMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me");
  });

  it("joins with a bodiless PUT: no name text is ever sent", async () => {
    await playersApi.putMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me", { method: "PUT" });
  });

  it("rerolls with a bodiless POST", async () => {
    await playersApi.rerollMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me/reroll", { method: "POST" });
  });

  it("DELETEs to leave", async () => {
    await playersApi.deleteMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me", { method: "DELETE" });
  });
});
