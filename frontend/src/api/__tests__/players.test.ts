const mockRequest = jest.fn().mockResolvedValue({ display_name: null });
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient:
    () =>
    (...args: unknown[]) =>
      mockRequest(...args),
}));

import { playersApi } from "../players";

describe("playersApi (#2624)", () => {
  beforeEach(() => mockRequest.mockClear());

  it("GETs the caller's name", async () => {
    await playersApi.getMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me");
  });

  it("PUTs the name as display_name", async () => {
    await playersApi.putMe("Riley");
    expect(mockRequest).toHaveBeenCalledWith("/players/me", {
      method: "PUT",
      body: JSON.stringify({ display_name: "Riley" }),
    });
  });

  it("DELETEs the name", async () => {
    await playersApi.deleteMe();
    expect(mockRequest).toHaveBeenCalledWith("/players/me", { method: "DELETE" });
  });
});
